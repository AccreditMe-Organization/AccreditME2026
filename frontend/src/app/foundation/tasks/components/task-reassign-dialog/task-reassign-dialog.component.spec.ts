import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { ITaskDto } from '../../services/task.service';
import { TaskReassignDialogComponent, TaskRejection } from './task-reassign-dialog.component';

// ACC-163 — the reassign dialog, extracted from Unassigned tasks so the
// committee record can host it for a rejected task's creator (Q4). What was
// proven there is proven here now: the exact ReassignTaskDto shape and the
// form's validation. Added: the rejection it acts on is stated, the people
// list is fetched once, and a caller without users:view is told rather than
// shown an empty picker.

const TASK = { id: 'task-1', title: 'Review incident report' } as ITaskDto;
const USERS_URL = `${environment.apiUrl}/users?status=ACTIVE&pageSize=200`;
const REASSIGN_URL = `${environment.apiUrl}/tasks/task-1/reassign`;

@Component({
  standalone: true,
  imports: [TaskReassignDialogComponent],
  template: `
    <app-task-reassign-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      [rejection]="rejection()"
      (reassigned)="reassignedCount = reassignedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly rejection = signal<TaskRejection | null>(null);
  readonly task = TASK;
  reassignedCount = 0;
}

describe('TaskReassignDialogComponent (ACC-163)', () => {
  let http: HttpTestingController;

  function setup(options: { rejection?: TaskRejection; usersStatus?: number } = {}) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
      ],
    });
    TestBed.inject(TranslateService).setTranslation(
      'en',
      {
        task: {
          reassignNamed: 'Reassign “{{title}}”',
          rejectedByNamed: 'Rejected by {{name}}: {{reason}}',
          assigneesUnavailable: 'People unavailable',
          status: { rejected: 'Rejected' },
        },
      },
      true,
    );
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    if (options.rejection) fixture.componentInstance.rejection.set(options.rejection);
    fixture.detectChanges();

    const users = http.expectOne(USERS_URL);
    if (options.usersStatus) {
      users.flush({ message: 'Required permission: users:view' }, { status: options.usersStatus, statusText: 'Forbidden' });
    } else {
      users.flush({ data: [{ id: 'user-a', name: 'User A' }], total: 1, page: 1, pageSize: 200 });
    }
    fixture.detectChanges();

    const dialog = fixture.debugElement.query(By.directive(TaskReassignDialogComponent))
      .componentInstance as TaskReassignDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('sends the exact ReassignTaskDto shape, then tells the host and closes', () => {
    const { fixture, dialog } = setup();

    dialog.form.setValue({ newAssigneeUserIds: ['user-a'], reason: '  Covering for absence ' });
    dialog.submit();

    const req = http.expectOne(REASSIGN_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ newAssigneeUserIds: ['user-a'], reason: 'Covering for absence' });
    req.flush({ ...TASK, status: 'PENDING' });

    expect(fixture.componentInstance.reassignedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('does not submit without assignees and a reason', () => {
    const { dialog } = setup();

    dialog.submit();

    expect(dialog.form.invalid).toBe(true);
    expect(dialog.showErrors()).toBe(true);
    http.expectNone(REASSIGN_URL);
  });

  it('names the task in its header', () => {
    setup();

    expect(document.body.textContent).toContain('Reassign “Review incident report”');
  });

  it('states the rejection it acts on — who handed it back, and why', () => {
    setup({ rejection: { byName: 'Sarah', reason: 'This belongs to Pharmacy' } });

    expect(document.body.textContent).toContain('Rejected by Sarah: This belongs to Pharmacy');
  });

  // The people list needs users:view (a known limitation, SYSTEM-REFERENCE
  // §3.6). Without it the dialog says so and cannot send, rather than offering
  // an empty picker that looks like "nobody to choose".
  it('tells a caller without users:view that people are unavailable, and does not send', () => {
    const { dialog } = setup({ usersStatus: 403 });

    expect(dialog.usersRefused()).toBe(true);
    expect(document.body.textContent).toContain('People unavailable');
    dialog.form.setValue({ newAssigneeUserIds: ['user-a'], reason: 'x' });
    dialog.submit();
    http.expectNone(REASSIGN_URL);
  });

  it('fetches the people list once, however often it opens', () => {
    const { fixture } = setup();

    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();

    http.expectNone(USERS_URL);
  });
});
