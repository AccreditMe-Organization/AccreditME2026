import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { ITaskDto } from '../../services/task.service';
import { TaskRejectDialogComponent } from './task-reject-dialog.component';

// ACC-163 — the reason is the whole point of a reject: it is what the task's
// creator reads before reassigning. So the tests that matter are that a reason
// is required (and whitespace is not one), that it is sent trimmed, that its
// length is capped where the server caps it, and that the host is told.

const TASK = { id: 'task-1', title: 'Collect the audit sample' } as ITaskDto;

@Component({
  standalone: true,
  imports: [TaskRejectDialogComponent],
  template: `
    <app-task-reject-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      (rejected)="rejectedCount = rejectedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly task = TASK;
  rejectedCount = 0;
}

describe('TaskRejectDialogComponent (ACC-163)', () => {
  let http: HttpTestingController;

  function setup() {
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
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskRejectDialogComponent))
      .componentInstance as TaskRejectDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('sends the reason, trimmed, and tells the host and closes on success', () => {
    const { fixture, dialog } = setup();

    dialog.form.setValue({ reason: '  This belongs to Pharmacy  ' });
    dialog.submit();

    const req = http.expectOne(`${environment.apiUrl}/tasks/task-1/reject`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'This belongs to Pharmacy' });
    req.flush({ ...TASK, status: 'REJECTED' });

    expect(fixture.componentInstance.rejectedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('does not send an empty reason, and reveals the error', () => {
    const { dialog } = setup();

    dialog.submit();

    expect(dialog.showErrors()).toBe(true);
    expect(dialog.form.controls.reason.hasError('required')).toBe(true);
    http.expectNone(`${environment.apiUrl}/tasks/task-1/reject`);
  });

  it('does not treat whitespace as a reason', () => {
    const { dialog } = setup();

    dialog.form.setValue({ reason: '    ' });
    dialog.submit();

    expect(dialog.form.controls.reason.hasError('required')).toBe(true);
    http.expectNone(`${environment.apiUrl}/tasks/task-1/reject`);
  });

  it('caps the reason at 1000 characters, as the server does', () => {
    const { dialog } = setup();

    dialog.form.setValue({ reason: 'x'.repeat(1000) });
    expect(dialog.form.valid).toBe(true);

    dialog.form.setValue({ reason: 'x'.repeat(1001) });
    dialog.submit();
    expect(dialog.form.controls.reason.hasError('maxlength')).toBe(true);
    http.expectNone(`${environment.apiUrl}/tasks/task-1/reject`);
  });

  it('keeps the dialog open and shows the server refusal', () => {
    const { fixture, dialog } = setup();

    dialog.form.setValue({ reason: 'Not mine' });
    dialog.submit();
    http
      .expectOne(`${environment.apiUrl}/tasks/task-1/reject`)
      .flush({ message: 'A completed task cannot be rejected' }, { status: 409, statusText: 'Conflict' });

    expect(dialog.error()).toBe('A completed task cannot be rejected');
    expect(fixture.componentInstance.visible()).toBe(true);
    expect(fixture.componentInstance.rejectedCount).toBe(0);
  });

  it('starts empty each time it opens, so a reason never carries to another task', () => {
    const { fixture, dialog } = setup();

    dialog.form.setValue({ reason: 'typed for the first task' });
    fixture.componentInstance.visible.set(false);
    fixture.detectChanges();
    fixture.componentInstance.visible.set(true);
    fixture.detectChanges();

    expect(dialog.form.getRawValue().reason).toBe('');
  });
});
