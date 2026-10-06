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
import { ITaskDto, TaskRequestType } from '../../services/task.service';
import { TaskRequestDialogComponent } from './task-request-dialog.component';

// ACC-173 — asking for more time or a hold. The dates follow New task's
// convention: a picked day (and, for more time, a time) read in the browser's
// zone, sent as an instant; a hold ends at the START of working hours.

const API = `${environment.apiUrl}/tasks`;
const DAY = 24 * 60 * 60 * 1000;

const TASK = {
  id: 'task-1',
  title: 'Collect the audit sample',
  dueAt: new Date(Date.now() + 2 * DAY).toISOString(),
} as ITaskDto;

@Component({
  standalone: true,
  imports: [TaskRequestDialogComponent],
  template: `
    <app-task-request-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task"
      [type]="type()"
      (requested)="requestedCount = requestedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly type = signal<TaskRequestType>('EXTENSION');
  readonly task = TASK;
  requestedCount = 0;
}

describe('TaskRequestDialogComponent (ACC-173)', () => {
  let http: HttpTestingController;

  function setup(type: TaskRequestType, language: 'en' | 'ar' = 'en') {
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
    fixture.componentInstance.type.set(type);
    fixture.detectChanges();
    http.match(`${environment.apiUrl}/working-calendar`).forEach((r) =>
      r.flush({ timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
    );
    http.match((r) => r.url.startsWith(`${environment.apiUrl}/working-calendar/holidays`)).forEach((r) => r.flush([]));
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskRequestDialogComponent))
      .componentInstance as TaskRequestDialogComponent;
    return { fixture, dialog };
  }

  const dayFromNow = (days: number) => {
    const at = new Date(Date.now() + days * DAY);
    at.setHours(0, 0, 0, 0);
    return at;
  };

  afterEach(() => http.verify());

  it('sends more time as the picked day at the picked time, in the reader\'s zone', () => {
    const { fixture, dialog } = setup('EXTENSION');
    const day = dayFromNow(5);

    dialog.onDayPicked(day);
    dialog.form.controls.time.setValue('13:30');
    dialog.form.controls.reason.setValue('  Waiting on the lab  ');
    dialog.submit();

    const expected = new Date(day);
    expected.setHours(13, 30, 0, 0);
    const req = http.expectOne(`${API}/task-1/requests`);
    expect(req.request.body).toEqual({
      type: 'EXTENSION',
      requestedDueAt: expected.toISOString(),
      reason: 'Waiting on the lab',
    });
    req.flush({ id: 'req-1' });
    expect(fixture.componentInstance.requestedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('defaults the time to the task\'s current due time', () => {
    const { dialog } = setup('EXTENSION');
    const due = new Date(TASK.dueAt!);
    const hh = `${due.getHours()}`.padStart(2, '0');
    const mm = `${due.getMinutes()}`.padStart(2, '0');
    expect(dialog.form.controls.time.value).toBe(`${hh}:${mm}`);
  });

  it('sends a hold as the start of working hours on the picked day', () => {
    const { dialog } = setup('ON_HOLD');
    const day = dayFromNow(10);

    dialog.onDayPicked(day);
    dialog.form.controls.reason.setValue('Supplier closed');
    dialog.submit();

    const expected = new Date(day);
    expected.setHours(8, 0, 0, 0);
    expect(http.expectOne(`${API}/task-1/requests`).request.body).toEqual({
      type: 'ON_HOLD',
      holdUntil: expected.toISOString(),
      reason: 'Supplier closed',
    });
  });

  it('refuses a new due date that is not after the current one, and says so', () => {
    const { dialog } = setup('EXTENSION');
    dialog.onDayPicked(dayFromNow(1));
    dialog.form.controls.time.setValue('09:00');
    dialog.form.controls.reason.setValue('x');
    dialog.submit();

    expect(dialog.form.controls.date.hasError('notAfterDue')).toBe(true);
    expect(dialog.showErrors()).toBe(true);
    http.expectNone(`${API}/task-1/requests`);
  });

  it('refuses a hold beyond 90 days', () => {
    const { dialog } = setup('ON_HOLD');
    dialog.onDayPicked(dayFromNow(92));
    dialog.form.controls.reason.setValue('x');
    dialog.submit();

    expect(dialog.form.controls.date.hasError('tooLong')).toBe(true);
    http.expectNone(`${API}/task-1/requests`);
  });

  it('needs a date and a reason', () => {
    const { dialog } = setup('ON_HOLD');
    dialog.form.controls.reason.setValue('   ');
    dialog.submit();

    expect(dialog.form.controls.date.hasError('required')).toBe(true);
    expect(dialog.form.controls.reason.hasError('required')).toBe(true);
    http.expectNone(`${API}/task-1/requests`);
  });

  it('the calendar replaces the fields, and picking a day brings them back', () => {
    const { fixture, dialog } = setup('ON_HOLD');
    dialog.openDateView();
    fixture.detectChanges();
    expect(document.body.querySelector('am-inline-calendar')).not.toBeNull();
    expect(document.body.querySelector('#taskRequestReason')).toBeNull();

    dialog.onDayPicked(dayFromNow(3));
    fixture.detectChanges();
    expect(document.body.querySelector('am-inline-calendar')).toBeNull();
    expect(document.body.querySelector('#taskRequestReason')).not.toBeNull();
  });

  // ACC-174 — the opening effect read the calendar signal, so the calendar
  // ARRIVING re-ran it and reset the form: a reason typed while the calendar
  // was still loading vanished. Here the calendar arrives after the typing.
  it('keeps a reason typed before the working calendar arrives', () => {
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
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.type.set('ON_HOLD');
    fixture.detectChanges();
    const dialog = fixture.debugElement.query(By.directive(TaskRequestDialogComponent))
      .componentInstance as TaskRequestDialogComponent;

    dialog.form.controls.reason.setValue('Supplier closed until Sunday');
    dialog.form.controls.reason.markAsDirty();

    http.match(`${environment.apiUrl}/working-calendar`).forEach((r) =>
      r.flush({ timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
    );
    http.match((r) => r.url.startsWith(`${environment.apiUrl}/working-calendar/holidays`)).forEach((r) => r.flush([]));
    fixture.detectChanges();

    expect(dialog.form.controls.reason.value).toBe('Supplier closed until Sunday');
    expect(dialog.form.dirty).toBe(true);
  });

  it('names the task in its header, in Arabic', () => {
    setup('ON_HOLD', 'ar');
    expect(document.body.textContent).toContain('طلب إيقاف «Collect the audit sample» مؤقتًا');
  });
});
