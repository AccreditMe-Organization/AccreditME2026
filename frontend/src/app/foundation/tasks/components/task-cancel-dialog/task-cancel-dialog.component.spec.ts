import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { ITaskDto } from '../../services/task.service';
import { TaskCancelDialogComponent } from './task-cancel-dialog.component';

// ACC-174 — the creator cancels a task, with a reason the assignees read.

const API = `${environment.apiUrl}/tasks`;
const TASK = { id: 'task-1', title: 'Collect the audit sample' } as ITaskDto;

@Component({
  standalone: true,
  imports: [TaskCancelDialogComponent],
  template: `
    <app-task-cancel-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      (cancelledTask)="cancelledCount = cancelledCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly task = TASK;
  cancelledCount = 0;
}

describe('TaskCancelDialogComponent (ACC-174)', () => {
  let http: HttpTestingController;

  function setup(language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskCancelDialogComponent))
      .componentInstance as TaskCancelDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it('cancels with the trimmed reason, then tells the host and closes', () => {
    const { fixture, dialog } = setup();
    dialog.form.controls.reason.setValue('  The audit was postponed  ');
    dialog.submit();

    const req = http.expectOne(`${API}/task-1/cancel`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'The audit was postponed' });
    req.flush({});
    expect(fixture.componentInstance.cancelledCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('refuses to cancel without a reason, and says so', () => {
    const { dialog } = setup();
    dialog.form.controls.reason.setValue('   ');
    dialog.submit();
    expect(dialog.form.controls.reason.hasError('required')).toBe(true);
    expect(dialog.showErrors()).toBe(true);
    http.expectNone(`${API}/task-1/cancel`);
  });

  it("shows the server's refusal — a workflow step's task, say", () => {
    const { dialog } = setup();
    dialog.form.controls.reason.setValue('Not needed');
    dialog.submit();
    http
      .expectOne(`${API}/task-1/cancel`)
      .flush({ message: 'This task belongs to a workflow step' }, { status: 409, statusText: 'Conflict' });
    expect(dialog.error()).toBe('This task belongs to a workflow step');
  });

  it('names the task, and who reads the reason, in Arabic', () => {
    setup('ar');
    expect(document.body.textContent).toContain('إلغاء «Collect the audit sample»');
    expect(document.body.textContent).toContain('يقرأ هذا من يعملون على المهمة.');
  });
});
