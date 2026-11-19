import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { LanguageService } from '../../../../core/services/language.service';
import { aMinutes, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingAttendanceComponent } from './meeting-attendance.component';

// ACC-316 PR 7b — Attendance: saved on each tap, a "Saved" tick on the row, the
// quorum line counting members only, Mark all present, arrow keys in reading
// direction, and before the start a sentence saying when it opens.
describe('MeetingAttendanceComponent (ACC-316 PR 7b)', () => {
  preserveDocumentLanguage();
  let record: jasmine.Spy;

  function create(minutes: MeetingMinutesDto = aMinutes(), scheduledAt = '2020-01-01T08:00:00.000Z', lang: 'en' | 'ar' = 'en') {
    record = jasmine.createSpy('record').and.callFake((_id: string, rows: { attendeeId: string; attendance: string }[]) =>
      of({ ...minutes, attendance: minutes.attendance.map((r) => ({ ...r, attendance: (rows.find((x) => x.attendeeId === r.attendeeId)?.attendance as never) ?? r.attendance })) }),
    );
    TestBed.configureTestingModule({
      imports: [MeetingAttendanceComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), { provide: MeetingService, useValue: { recordAttendance: record } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    if (lang === 'ar') TestBed.inject(LanguageService).use('ar');
    const fixture = TestBed.createComponent(MeetingAttendanceComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('minutes', minutes);
    fixture.componentRef.setInput('scheduledAt', scheduledAt);
    fixture.detectChanges();
    const changes: MeetingMinutesDto[] = [];
    fixture.componentInstance.minutesChange.subscribe((m) => changes.push(m));
    return { fixture, el: fixture.nativeElement as HTMLElement, changes };
  }

  const segment = (el: HTMLElement, row: string, value: string) => el.querySelector<HTMLButtonElement>(`[data-attendance-row="${row}"] [data-attendance="${value}"]`)!;

  it('a tap records that one row, at once, and the row says it was saved', () => {
    const { el, fixture, changes } = create();
    segment(el, 'a-1', 'PRESENT').click();
    fixture.detectChanges();
    expect(record).toHaveBeenCalledOnceWith('m-1', [{ attendeeId: 'a-1', attendance: 'PRESENT' }]);
    expect(changes.length).toBe(1);
    expect(el.querySelector('[data-attendance-row="a-1"] [data-attendance-saved]')).not.toBeNull();
    expect(el.querySelector('[data-attendance-row="a-2"] [data-attendance-saved]')).toBeNull();
  });

  it('the segments are a radiogroup: the recorded one is checked, and is the one tab stop', () => {
    const minutes = aMinutes({ attendance: [anAttendanceRow({ attendance: 'APOLOGIES' })] });
    const { el } = create(minutes);
    expect(el.querySelector('[data-attendance-row="a-1"] [role="radiogroup"]')).not.toBeNull();
    expect(segment(el, 'a-1', 'APOLOGIES').getAttribute('aria-checked')).toBe('true');
    expect(segment(el, 'a-1', 'PRESENT').getAttribute('aria-checked')).toBe('false');
    expect(segment(el, 'a-1', 'APOLOGIES').tabIndex).toBe(0);
    expect(segment(el, 'a-1', 'PRESENT').tabIndex).toBe(-1);
  });

  it('ArrowRight moves to the next choice in English and records it', () => {
    const { el } = create();
    segment(el, 'a-1', 'PRESENT').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(record).toHaveBeenCalledOnceWith('m-1', [{ attendeeId: 'a-1', attendance: 'APOLOGIES' }]);
  });

  it('in Arabic, ArrowLeft moves to the next choice (reading direction)', () => {
    const { el } = create(aMinutes(), undefined, 'ar');
    segment(el, 'a-1', 'PRESENT').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(record).toHaveBeenCalledOnceWith('m-1', [{ attendeeId: 'a-1', attendance: 'APOLOGIES' }]);
  });

  it('Mark all present records everyone not yet present, in one write', () => {
    const minutes = aMinutes({ attendance: [anAttendanceRow({ attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda' }), anAttendanceRow({ attendeeId: 'a-3', kind: 'ORG_GUEST', userId: 'u-3', name: 'Saad', seat: null })] });
    const { el } = create(minutes);
    el.querySelector<HTMLElement>('[data-testid="meeting-attendance-all"] button')!.click();
    expect(record).toHaveBeenCalledOnceWith('m-1', [
      { attendeeId: 'a-2', attendance: 'PRESENT' },
      { attendeeId: 'a-3', attendance: 'PRESENT' },
    ]);
  });

  it('the quorum line counts members only, and says how many more are needed', () => {
    const minutes = aMinutes({ quorum: { quorum: 2, presentMembers: 1, met: false } });
    const { el } = create(minutes);
    const line = el.querySelector('[data-testid="meeting-attendance-quorum"]')!;
    expect(line.textContent?.trim()).toBe('✗ Quorum not met · 1 of 2 present, quorum 2 · 1 more needed');
    expect(line.classList).toContain('am-att__quorum--short');
  });

  it('met, the line says so', () => {
    const { el } = create(aMinutes({ quorum: { quorum: 2, presentMembers: 2, met: true } }));
    expect(el.querySelector('[data-testid="meeting-attendance-quorum"]')?.textContent?.trim()).toBe('✓ Quorum met · 2 of 2 present, quorum 2');
  });

  it("someone who answered Can't attend shows it until something is recorded", () => {
    const { el } = create(aMinutes({ attendance: [anAttendanceRow({ suggested: 'APOLOGIES' })] }));
    expect(el.querySelector('[data-attendance-row="a-1"] [data-attendance-suggested]')).not.toBeNull();
  });

  it('a refusal is said on the row, from its code', () => {
    const { el, fixture } = create();
    record.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_NOT_STARTED' } })));
    segment(el, 'a-2', 'ABSENT').click();
    fixture.detectChanges();
    expect(el.querySelector('[data-attendance-row="a-2"] [data-attendance-error]')?.textContent?.trim()).toBe(en.meeting.refusal.notStarted);
  });

  it('without the right to record, no segments: each row reads what was recorded', () => {
    const minutes = aMinutes({ attendance: [anAttendanceRow({ attendance: 'ABSENT' }), anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda' })], may: { ...aMinutes().may, recordAttendance: false } });
    const { el } = create(minutes);
    expect(el.querySelector('[role="radiogroup"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-attendance-all"]')).toBeNull();
    expect(el.querySelector('[data-attendance-row="a-1"] [data-attendance-value]')?.textContent?.trim()).toBe('Absent');
    expect(el.querySelector('[data-attendance-row="a-2"] [data-attendance-value]')?.textContent?.trim()).toBe('Not recorded');
  });

  it('before the start, in the draft, it says when attendance opens', () => {
    const minutes = aMinutes({ may: { ...aMinutes().may, recordAttendance: false } });
    const { el } = create(minutes, '2099-01-01T08:00:00.000Z');
    expect(el.querySelector('[data-testid="meeting-attendance-opens"]')?.textContent).toContain('Attendance opens at the meeting');
  });
});
