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
import { TaskReopenDialogComponent } from './task-reopen-dialog.component';
import { InlineCalendarComponent } from '../../../../shared/components/inline-calendar/inline-calendar.component';

// ACC-174 — the creator reopens a completed task, with a reason and an optional
// EARLIER due date; the calendar stops at the restarted SLA's limit.

const API = `${environment.apiUrl}/tasks`;
const DAY = 24 * 60 * 60 * 1000;
const dayFromNow = (days: number) => {
  const at = new Date(Date.now() + days * DAY);
  at.setHours(0, 0, 0, 0);
  return at;
};

const TASK = { id: 'task-1', title: 'Collect the audit sample', priority: 'MEDIUM', status: 'COMPLETED' } as ITaskDto;
const LIMIT = new Date(Date.now() + 5 * DAY);
const W = (at: Date) => ({ dueAt: at.toISOString(), limitAt: at.toISOString() });
const PREVIEW = { CRITICAL: W(new Date()), HIGH: W(new Date()), MEDIUM: W(LIMIT), LOW: W(new Date()) };

@Component({
  standalone: true,
  imports: [TaskReopenDialogComponent],
  template: `
    <app-task-reopen-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      (reopened)="reopenedCount = reopenedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly task = TASK;
  reopenedCount = 0;
}

describe('TaskReopenDialogComponent (ACC-174)', () => {
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
    http.match(`${environment.apiUrl}/working-calendar`).forEach((r) =>
      r.flush({ timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
    );
    http.match((r) => r.url.startsWith(`${environment.apiUrl}/working-calendar/holidays`)).forEach((r) => r.flush([]));
    // The RESTARTED window — from now, behind the reopen entitlement.
    const preview = http.expectOne((r) => r.url === `${API}/task-1/sla-preview`);
    expect(preview.request.params.get('restart')).toBe('true');
    preview.flush(PREVIEW);
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskReopenDialogComponent))
      .componentInstance as TaskReopenDialogComponent;
    return { fixture, dialog };
  }

  afterEach(() => http.verify());

  it("reads the limit for the task's priority, and says the default due date", () => {
    const { dialog } = setup();
    expect(dialog.limit()).toEqual(LIMIT);
    expect(dialog.dueHint()).toContain('Leave it empty and it is due');
  });

  it('reopens with the reason alone — the SLA gives the due date', () => {
    const { fixture, dialog } = setup();
    dialog.form.controls.reason.setValue('  The photo is of the wrong ward  ');
    dialog.submit();

    const req = http.expectOne(`${API}/task-1/reopen`);
    expect(req.request.body).toEqual({ reason: 'The photo is of the wrong ward' });
    req.flush({});
    expect(fixture.componentInstance.reopenedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('sends an earlier due date, at the picked time', () => {
    const { dialog } = setup();
    const day = dayFromNow(2);
    dialog.onDayPicked(day);
    dialog.form.controls.time.setValue('10:30');
    dialog.form.controls.reason.setValue('Evidence missing');
    dialog.submit();

    const expected = new Date(day);
    expected.setHours(10, 30, 0, 0);
    expect(http.expectOne(`${API}/task-1/reopen`).request.body).toEqual({
      reason: 'Evidence missing',
      dueDate: expected.toISOString(),
    });
  });

  it('refuses a date past the limit, and one in the past', () => {
    const { dialog } = setup();
    dialog.form.controls.reason.setValue('x');
    dialog.onDayPicked(dayFromNow(9));
    dialog.submit();
    expect(dialog.form.controls.date.hasError('afterLimit')).toBe(true);

    dialog.onDayPicked(dayFromNow(-1));
    dialog.submit();
    expect(dialog.form.controls.date.hasError('past')).toBe(true);
    http.expectNone(`${API}/task-1/reopen`);
  });

  it('needs a reason', () => {
    const { dialog } = setup();
    dialog.submit();
    expect(dialog.form.controls.reason.hasError('required')).toBe(true);
    http.expectNone(`${API}/task-1/reopen`);
  });

  it('the calendar stops at the limit', () => {
    const { fixture, dialog } = setup();
    dialog.openDateView();
    fixture.detectChanges();
    const calendar = fixture.debugElement.query(By.directive(InlineCalendarComponent))
      .componentInstance as InlineCalendarComponent;
    expect(calendar.maxDate()).toEqual(LIMIT);
    expect(document.body.querySelector('#taskReopenReason')).toBeNull();
  });

  it('names the task in Arabic', () => {
    setup('ar');
    expect(document.body.textContent).toContain('إعادة فتح «Collect the audit sample»');
  });
});
