import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { isTaskOverdue, taskDueSummary } from './task-due-summary';

// ACC-94 — the Committee record's task summary. It read "overdue 0d" for any
// task less than a day late: whole days, floored. Against the real en.json and
// ar.json, in the tenant zone (Riyadh by default in TestFormatContext).
describe('taskDueSummary (ACC-94)', () => {
  const now = new Date('2026-09-15T12:00:00Z');
  const hoursBefore = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();

  let format: FormatService;
  let translate: TranslateService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting()] });
    loadTranslationsForTest({ en, ar });
    translate = TestBed.inject(TranslateService);
    translate.use('en');
    format = TestBed.inject(FormatService);
  });

  const summary = (dueAt: string | null, status = 'PENDING') => taskDueSummary({ dueAt, status }, format, translate, now);

  it('reads a task five hours late as "Overdue 5 hours", never "overdue 0d"', () => {
    expect(summary(hoursBefore(5.5))).toBe('Overdue 5 hours');
  });

  it('uses minutes, hours or days by how late the task is', () => {
    expect(summary(hoursBefore(0.005))).toBe('Overdue less than a minute');
    expect(summary(hoursBefore(0.5))).toBe('Overdue 30 minutes');
    expect(summary(hoursBefore(30))).toBe('Overdue 30 hours');
    expect(summary(hoursBefore(24 * 6 + 3))).toBe('Overdue 6 days');
  });

  it('writes the Arabic with the correct plural, including the dual', () => {
    translate.use('ar');
    expect(summary(hoursBefore(2))).toBe('متأخرة: ساعتان');
    expect(summary(hoursBefore(5))).toBe('متأخرة: 5 ساعات');
    expect(summary(hoursBefore(24 * 11))).toBe('متأخرة: 11 يومًا');
  });

  it('shows the due date and time when the task is not yet due', () => {
    expect(summary('2026-09-16T05:00:00Z')).toBe('16 Sep 2026, 08:00');
  });

  it('is not overdue once completed or cancelled, and shows — with no due date', () => {
    expect(isTaskOverdue({ dueAt: hoursBefore(48), status: 'COMPLETED' }, now)).toBe(false);
    expect(summary(hoursBefore(48), 'CANCELLED')).toBe('13 Sep 2026, 15:00');
    expect(summary(null)).toBe('—');
  });
});
