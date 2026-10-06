import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { ITaskDto } from '../../services/task.service';
import { COMMITTEE_SCOPE } from '../task-assignee-picker/task-assignee-picker.component';
import { TaskReassignDialogComponent, TaskRejection } from './task-reassign-dialog.component';

// ACC-163 — the reassign dialog, extracted from Unassigned tasks so the
// committee record can host it for a rejected task's creator (Q4).
//
// ACC-167 — who the task goes to is now chosen with the assignment picker
// (unit, position, optional person; or a committee role), and sent as
// `assignTo`. The picker passes the task's id, and nothing here reads the
// tenant's user list: that is ACC-166's fix, and the test that proves it is
// "never asks for /users".

const TASK = {
  id: 'task-1',
  title: 'Review incident report',
  sourceType: 'DOCUMENT',
  sourceId: 'doc-1',
} as ITaskDto;
const COMMITTEE_TASK = { ...TASK, sourceType: 'COMMITTEE', sourceId: 'committee-1' } as ITaskDto;

const API = `${environment.apiUrl}/tasks`;
const REASSIGN_URL = `${API}/task-1/reassign`;

@Component({
  standalone: true,
  imports: [TaskReassignDialogComponent],
  template: `
    <app-task-reassign-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task()"
      [rejection]="rejection()"
      (reassigned)="reassignedCount = reassignedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly rejection = signal<TaskRejection | null>(null);
  readonly task = signal<ITaskDto>(TASK);
  reassignedCount = 0;
}

describe('TaskReassignDialogComponent (ACC-163, ACC-167)', () => {
  let http: HttpTestingController;

  function setup(
    options: { rejection?: TaskRejection; task?: ITaskDto; unitsStatus?: number; permissions?: string[] } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => (options.permissions ?? []).includes(p) },
        },
      ],
    });
    TestBed.inject(TranslateService).setTranslation(
      'en',
      {
        task: {
          reassignNamed: 'Reassign “{{title}}”',
          rejectedByNamed: 'Rejected by {{name}}: {{reason}}',
          status: { rejected: 'Rejected' },
          assign: { unavailable: 'You cannot choose who this task goes to.' },
        },
      },
      true,
    );
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    if (options.rejection) fixture.componentInstance.rejection.set(options.rejection);
    if (options.task) fixture.componentInstance.task.set(options.task);
    fixture.detectChanges();

    const units = http.expectOne((r) => r.url === `${API}/assignment/units`);
    expect(units.request.params.get('taskId')).toBe('task-1');
    if (options.unitsStatus) {
      units.flush({ message: 'Task not found' }, { status: options.unitsStatus, statusText: 'Not Found' });
    } else {
      units.flush([{ id: 'unit-1', parentId: null, nameEn: 'Pharmacy', nameAr: null }]);
    }
    fixture.detectChanges();

    const dialog = fixture.debugElement.query(By.directive(TaskReassignDialogComponent))
      .componentInstance as TaskReassignDialogComponent;
    return { fixture, dialog };
  }

  // Choosing a unit fetches its positions; choosing a position fetches its
  // holders. Both answered here, each asked with the task's id.
  function choosePosition(dialog: TaskReassignDialogComponent): void {
    dialog.form.controls.assignTo.controls.scope.setValue('unit-1');
    const positions = http.expectOne((r) => r.url === `${API}/assignment/positions`);
    expect(positions.request.params.get('orgUnitId')).toBe('unit-1');
    expect(positions.request.params.get('taskId')).toBe('task-1');
    positions.flush([{ id: 'pos-1', nameEn: 'Pharmacist', nameAr: null, isSingleAssignee: false, holderCount: 3 }]);

    dialog.form.controls.assignTo.controls.target.setValue('pos-1');
    http.expectOne((r) => r.url === `${API}/assignees`).flush([]);
  }

  afterEach(() => http.verify());

  it('sends assignTo and the trimmed reason, then tells the host and closes', () => {
    const { fixture, dialog } = setup();

    choosePosition(dialog);
    dialog.form.controls.reason.setValue('  Pharmacy owns this ');
    dialog.submit();

    const req = http.expectOne(REASSIGN_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      assignTo: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-1' },
      reason: 'Pharmacy owns this',
    });
    req.flush({ ...TASK, status: 'PENDING' });

    expect(fixture.componentInstance.reassignedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('sends the chosen person with the target', () => {
    const { dialog } = setup();

    choosePosition(dialog);
    dialog.form.controls.assignTo.controls.userId.setValue('user-a');
    dialog.form.controls.reason.setValue('Sarah has the context');
    dialog.submit();

    expect(http.expectOne(REASSIGN_URL).request.body.assignTo).toEqual({
      kind: 'POSITION',
      orgUnitId: 'unit-1',
      positionId: 'pos-1',
      userId: 'user-a',
    });
  });

  // A reassignment has to name somewhere: a unit alone is not a target.
  it('does not submit without a unit, a position and a reason', () => {
    const { dialog } = setup();

    dialog.submit();
    expect(dialog.form.invalid).toBe(true);
    expect(dialog.showErrors()).toBe(true);

    dialog.form.controls.assignTo.controls.scope.setValue('unit-1');
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([]);
    dialog.form.controls.reason.setValue('x');
    dialog.submit();

    expect(dialog.form.controls.assignTo.controls.target.hasError('required')).toBe(true);
    http.expectNone(REASSIGN_URL);
  });

  // ACC-166 — the dialog used to read /users, which needs users:view; a
  // creator without it could not reassign their own rejected task.
  it("never asks for the tenant's user list", () => {
    const { dialog } = setup();

    choosePosition(dialog);

    http.expectNone((r) => r.url.startsWith(`${environment.apiUrl}/users`));
  });

  it('tells a caller the picker refused, and does not send', () => {
    const { dialog } = setup({ unitsStatus: 404 });

    expect(document.body.textContent).toContain('You cannot choose who this task goes to.');
    dialog.form.controls.reason.setValue('x');
    dialog.submit();
    http.expectNone(REASSIGN_URL);
  });

  it("sends a committee role, on the task's own committee, for a committee task", () => {
    const { dialog } = setup({ task: COMMITTEE_TASK, permissions: ['committees:view'] });

    dialog.form.controls.assignTo.controls.scope.setValue(COMMITTEE_SCOPE);
    const roles = http.expectOne((r) => r.url === `${API}/assignment/committee-roles`);
    expect(roles.request.params.get('committeeId')).toBe('committee-1');
    roles.flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: 2 }]);
    dialog.form.controls.assignTo.controls.target.setValue('role-sec');
    http.expectOne((r) => r.url === `${API}/assignees/committee`).flush([]);
    dialog.form.controls.reason.setValue('The secretary keeps the minutes');
    dialog.submit();

    expect(http.expectOne(REASSIGN_URL).request.body.assignTo).toEqual({
      kind: 'COMMITTEE_ROLE',
      committeeId: 'committee-1',
      roleValueId: 'role-sec',
    });
  });

  it('names the task in its header', () => {
    setup();

    expect(document.body.textContent).toContain('Reassign “Review incident report”');
  });

  it('states the rejection it acts on — who handed it back, and why', () => {
    setup({ rejection: { byName: 'Sarah', reason: 'This belongs to Pharmacy' } });

    expect(document.body.textContent).toContain('Rejected by Sarah: This belongs to Pharmacy');
  });
});
