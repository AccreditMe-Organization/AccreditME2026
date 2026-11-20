import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingClashDto, type MeetingSeriesDateDto, type MeetingSeriesPreviewDto } from '../../services/meeting.service';
import { MeetingRepeatStepComponent } from '../meeting-repeat-step/meeting-repeat-step.component';
import { MeetingScheduleDialogComponent, type ScheduleOwner } from './meeting-schedule-dialog.component';

// ACC-316 PR 8a — Schedule meeting's clash line (step 1) and Repeat (step 2),
// with Ahmad's answers of 20 Nov (Q5–Q7) and lane B's (Q6): the screen asks
// the server for every date, move and clash and works none of them out.

/** Thursday 31 December 2026, 10:00 in the tenant's zone (UTC here). */
const FIRST = new Date(2026, 11, 31);
const COMMITTEE: ScheduleOwner = { kind: 'COMMITTEE', id: 'c-1', name: 'Infection Prevention & Control', frequency: 'QUARTERLY' };
const UNIT: ScheduleOwner = { kind: 'UNIT', id: 'u-1', name: 'Pharmacy' };

const date = (index: number, day: string, overrides: Partial<MeetingSeriesDateDto> = {}): MeetingSeriesDateDto => ({
  index,
  patternDay: day,
  day,
  startsAt: `${day}T10:00:00.000Z`,
  title: `Infection Prevention & Control · ${day.slice(0, 7)}`,
  moved: null,
  ...overrides,
});
const none = (startsAt: string): MeetingClashDto => ({ startsAt, invitees: 9, people: [] });
const busy = (startsAt: string): MeetingClashDto => ({
  startsAt,
  invitees: 9,
  people: [
    { userId: 'u-omar', name: 'Omar Haddad', meetings: [{ id: 'm-x', title: 'Antimicrobial Stewardship · March 2027', startsAt: '2027-03-25T09:30:00.000Z', durationMinutes: 90 }] },
    { userId: 'u-yousef', name: 'Dr. Yousef Barakat', meetings: [{ id: null, title: null, startsAt: '2027-03-25T11:00:00.000Z', durationMinutes: 60 }] },
  ],
});

describe('Schedule meeting — the clash line and Repeat (ACC-316 PR 8a)', () => {
  let clashes: jasmine.Spy;
  let seriesPreview: jasmine.Spy;
  let createSeries: jasmine.Spy;
  let schedule: jasmine.Spy;
  let preview: MeetingSeriesPreviewDto;

  function create(owner: ScheduleOwner = COMMITTEE, language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [MeetingScheduleDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        {
          provide: MeetingService,
          useValue: {
            formChoices: () => of({ types: [{ id: 't-1', labelEn: 'Review', labelAr: 'مراجعة' }] }),
            schedule,
            clashes,
            seriesPreview,
            createSeries,
            presenterCandidates: () => of({ items: [{ id: 'u-nora', name: 'Nora Al-Otaibi', unit: null, position: null }], total: 1, matching: 1 }),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(TestFormatContext).zone.set('UTC');
    const fixture = TestBed.createComponent(MeetingScheduleDialogComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('owner', owner);
    fixture.detectChanges();
    const c = fixture.componentInstance;
    const fill = () => {
      c.form.patchValue({ title: 'Infection Prevention & Control', typeValueId: 't-1', durationMinutes: 90, time: '10:00', location: 'Board room 1' });
      c.pickDay(FIRST);
      fixture.detectChanges();
    };
    const settle = () => {
      tick(300);
      fixture.detectChanges();
      tick(300);
      fixture.detectChanges();
    };
    const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = (id: string) => q(id)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const repeat = () => fixture.debugElement.query((d) => d.componentInstance instanceof MeetingRepeatStepComponent)?.componentInstance as MeetingRepeatStepComponent | undefined;
    return { fixture, c, fill, settle, q, text, repeat };
  }

  beforeEach(() => {
    preview = {
      dates: [date(1, '2026-12-31'), date(2, '2027-03-25'), date(3, '2027-06-24'), date(4, '2027-09-30'), date(5, '2027-12-30')],
      clashes: [none('a'), busy('b'), none('c'), none('d'), none('e')],
    };
    clashes = jasmine.createSpy('clashes').and.returnValue(of([busy('x')]));
    seriesPreview = jasmine.createSpy('seriesPreview').and.callFake(() => of(preview));
    createSeries = jasmine.createSpy('createSeries').and.returnValue(of({ seriesId: 's-1', meetingIds: ['m-first', 'm-2'] }));
    schedule = jasmine.createSpy('schedule').and.returnValue(of(aMeeting()));
  });
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  describe('step 1: the clash line', () => {
    it('once Starts and Duration are set, says how many of the invitees have another meeting then, and asks again when the time changes', fakeAsync(() => {
      const { c, fill, settle, q, text, fixture } = create();
      settle();
      expect(clashes).not.toHaveBeenCalled();
      fill();
      settle();
      expect(clashes).toHaveBeenCalledOnceWith({ committeeId: 'c-1', times: [{ startsAt: '2026-12-31T10:00:00.000Z', durationMinutes: 90 }] });
      expect(q('meeting-clash-line')!.querySelector('span')!.textContent!.trim()).toBe('2 of 9 invitees have another meeting then');
      expect(text('meeting-clash-toggle')).toBe('Show who');
      // Schedule and Next stay offered: a clash is a warning, never a gate.
      expect(document.querySelector<HTMLButtonElement>('[data-testid="schedule-next"] button')!.disabled).toBeFalse();
      c.form.controls.durationMinutes.setValue(60);
      fixture.detectChanges();
      settle();
      expect(clashes.calls.mostRecent().args[0].times).toEqual([{ startsAt: '2026-12-31T10:00:00.000Z', durationMinutes: 60 }]);
    }));

    it('Show who swaps the rows in for the body, with Starts and Duration kept; a meeting the person may not open is "another meeting"', fakeAsync(() => {
      const { fill, settle, q, text, fixture } = create();
      fill();
      settle();
      q('meeting-clash-toggle')!.click();
      fixture.detectChanges();
      expect(q('schedule-who-view')).not.toBeNull();
      expect(q('schedule-title')).withContext('the details are swapped out').toBeNull();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-clash-person]')).map((r) => r.innerText.replace(/\s+/g, ' ').trim());
      expect(rows).toEqual(['Omar Haddad Antimicrobial Stewardship · March 2027 09:30–11:00', 'Dr. Yousef Barakat another meeting 11:00–12:00']);
      expect(q('schedule-who-day')).withContext('Starts kept').not.toBeNull();
      expect(text('meeting-clash-toggle')).toBe('Hide');
      q('schedule-who-back')!.click();
      fixture.detectChanges();
      expect(q('schedule-title')).not.toBeNull();
    }));

    it('no clash: no line at all', fakeAsync(() => {
      clashes.and.returnValue(of([none('x')]));
      const { fill, settle, q } = create();
      fill();
      settle();
      expect(q('meeting-clash')).toBeNull();
    }));
  });

  describe('step 2: Repeat', () => {
    it('Next needs step 1 complete: its errors otherwise, and no step 2', fakeAsync(() => {
      const { c, q, fixture } = create();
      q('schedule-next')!.querySelector('button')!.click();
      fixture.detectChanges();
      tick();
      expect(c.step()).toBe(1);
      expect(c.showErrors()).toBeTrue();
    }));

    it("starts from the committee's frequency (Q6) and the first meeting's day, and asks the server for the dates", fakeAsync(() => {
      const { c, fill, settle, text, repeat } = create();
      fill();
      c.next();
      settle();
      const r = repeat()!;
      expect(c.step()).toBe(2);
      expect(r.repeats()).toBeTrue();
      // Thursday 31 December: the last Thursday of the month.
      expect(r.form.getRawValue()).toEqual(jasmine.objectContaining({ every: 'MONTH_3', weekday: 4, dayOfMonth: 31, ordinal: 'LAST' }));
      expect(text('repeat-hint')).toBe("From the committee's frequency, Quarterly → every 3 months · up to 12 months ahead");
      expect(seriesPreview).toHaveBeenCalledWith(
        jasmine.objectContaining({
          committeeId: 'c-1',
          subject: 'Infection Prevention & Control',
          startTime: '10:00',
          durationMinutes: 90,
          every: 'MONTH_3',
          onKind: 'ORDINAL_WEEKDAY',
          weekday: 4,
          ordinal: 'LAST',
          dayOfMonth: null,
          firstDate: '2026-12-31',
          count: 4,
          endsOn: null,
        }),
      );
      expect(text('repeat-readback')).toBe('Every 3 months, the last Thursday · Dec, Mar, Jun, Sep');
      expect(c.context()).toBe('◇ Infection Prevention & Control · first meeting 31 Dec 2026, 10:00');
    }));

    it('a day that is both the 4th and the last of its weekday in the month seeds "the last"', fakeAsync(() => {
      const { c, settle, repeat, fixture } = create();
      // Thursday 25 February 2027: the 4th Thursday, and the last (February has 28 days).
      c.form.patchValue({ title: 'Infection Prevention & Control', typeValueId: 't-1', durationMinutes: 90, time: '10:00', location: 'Board room 1' });
      c.pickDay(new Date(2027, 1, 25));
      fixture.detectChanges();
      c.next();
      settle();
      expect(repeat()!.form.getRawValue()).toEqual(jasmine.objectContaining({ weekday: 4, dayOfMonth: 25, ordinal: 'LAST' }));
      // Thursday 18 February 2027: the 3rd, not the last.
      c.back();
      c.pickDay(new Date(2027, 1, 18));
      fixture.detectChanges();
      c.next();
      settle();
      expect(repeat()!.form.controls.ordinal.value).toBe('THIRD');
    }));

    it('shows the first five dates with their titles and chips, and Schedule says how many meetings it will make', fakeAsync(() => {
      const { c, fill, settle, repeat, text } = create();
      fill();
      c.next();
      settle();
      const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-repeat-date]'));
      expect(rows.length).toBe(5);
      // One line per date: the date, its title, then its chips.
      expect(rows[1]!.innerText.replace(/\s+/g, ' ').trim()).toBe('Thu 25 Mar 2027 Infection Prevention & Control · 2027-03 Clash');
      expect(c.submitLabel()).toBe('Schedule 5 meetings');
      expect(repeat()!.count()).toBe(5);
      expect(text('repeat-later')).toBeNull();
    }));

    it('a Clash chip swaps in that date\'s people, and "← All dates" brings the dates back', fakeAsync(() => {
      const { c, fill, settle, q, text, fixture } = create();
      fill();
      c.next();
      settle();
      document.querySelector<HTMLButtonElement>('[data-repeat-date="2"] [data-chip="clash"]')!.click();
      fixture.detectChanges();
      expect(q('repeat-clash-view')).not.toBeNull();
      expect(text('meeting-clash-line')).toBe('Thu 25 Mar 2027, 10:00–11:30 · 2 of 9 invitees have another meeting then');
      q('repeat-clash-back')!.click();
      fixture.detectChanges();
      expect(document.querySelectorAll('[data-repeat-date]').length).toBe(5);
    }));

    it('past the fifth date: "n later dates · m moved · k have a clash · Show all" (Q7), which swaps in every date', fakeAsync(() => {
      preview = {
        dates: Array.from({ length: 12 }, (_, i) => date(i + 1, `2027-${String(i + 1).padStart(2, '0')}-28`, i === 7 ? { moved: 'NOT_WORKING_DAY', day: '2027-08-29', startsAt: '2027-08-29T10:00:00.000Z' } : {})),
        clashes: Array.from({ length: 12 }, (_, i) => (i === 9 || i === 10 ? busy('t') : none('t'))),
      };
      const { c, fill, settle, q, text, fixture } = create();
      fill();
      c.next();
      settle();
      expect(q('repeat-later')!.querySelector('span')!.textContent!.trim()).toBe('7 later dates · 1 moved · 2 have a clash');
      expect(text('repeat-show-all')).toBe('Show all');
      q('repeat-show-all')!.click();
      fixture.detectChanges();
      expect(document.querySelectorAll('[data-testid="repeat-all-dates"] [data-repeat-date]').length).toBe(12);
    }));

    it('a moved date says Moved and where; a shorter month\'s last day says so, neutrally', fakeAsync(() => {
      preview = {
        dates: [date(1, '2026-10-31', { day: '2026-11-01', moved: 'NOT_WORKING_DAY', startsAt: '2026-11-01T10:00:00.000Z' }), date(2, '2026-11-30')],
        clashes: [none('a'), none('b')],
      };
      const { c, fill, settle, repeat, fixture } = create();
      fill();
      c.next();
      settle();
      repeat()!.monthMode.set('DAY');
      repeat()!.form.controls.dayOfMonth.setValue(31);
      fixture.detectChanges();
      settle();
      const chips = (i: number) => Array.from(document.querySelectorAll(`[data-repeat-date="${i}"] [data-chip]`)).map((e) => e.getAttribute('data-chip'));
      expect(chips(1)).toEqual(['moved']);
      expect(document.querySelector('[data-repeat-date="1"]')!.textContent).toContain('→ Sun 1 Nov 2026');
      expect(chips(2)).toEqual(['short-month']);
      expect(document.querySelector('[data-repeat-date="2"] [data-chip="short-month"]')!.textContent!.trim()).toBe('No day 31 · last day');
    }));

    it('schedules the series as previewed and opens its first meeting', fakeAsync(() => {
      const { c, fill, settle } = create();
      const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      fill();
      c.next();
      settle();
      c.submit();
      tick();
      expect(createSeries).toHaveBeenCalledOnceWith(jasmine.objectContaining({ every: 'MONTH_3', count: 4, standingAgenda: [] }));
      expect(schedule).not.toHaveBeenCalled();
      expect(navigate).toHaveBeenCalledWith(['/meetings', 'm-first']);
    }));

    it("a unit, with no frequency, starts on Doesn't repeat: Schedule makes one meeting", fakeAsync(() => {
      const { c, fill, settle, repeat } = create(UNIT);
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      fill();
      c.next();
      settle();
      expect(repeat()!.repeats()).toBeFalse();
      expect(seriesPreview).not.toHaveBeenCalled();
      expect(c.submitLabel()).toBe('Schedule');
      c.submit();
      tick();
      expect(schedule).toHaveBeenCalledTimes(1);
      expect(createSeries).not.toHaveBeenCalled();
    }));

    it('Back keeps step 2\'s choices', fakeAsync(() => {
      const { c, fill, settle, repeat } = create();
      fill();
      c.next();
      settle();
      repeat()!.form.controls.every.setValue('MONTH_6');
      c.back();
      settle();
      c.next();
      settle();
      expect(repeat()!.form.controls.every.value).toBe('MONTH_6');
    }));

    it('the standing agenda (Q5): at most ten items, a presenter from the list, sent with the series', fakeAsync(() => {
      const { c, fill, settle, q, text, repeat, fixture } = create();
      spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
      fill();
      c.next();
      settle();
      expect(text('repeat-standing')).toBe('None · Add…');
      q('repeat-standing')!.click();
      fixture.detectChanges();
      const r = repeat()!;
      for (let i = 0; i < 10; i++) r.addItem();
      fixture.detectChanges();
      expect(document.querySelector<HTMLButtonElement>('[data-testid="repeat-standing-add"] button')!.disabled).toBeTrue();
      expect(text('repeat-standing-full')).toBe('At most 10 standing items.');
      r.addItem();
      expect(r.standing().length).withContext('never an eleventh').toBe(10);
      for (let i = 9; i >= 2; i--) r.removeItem(i);
      r.setTitle(0, 'Open actions');
      r.setTitle(1, 'Infection rates');
      r.openPresenter(1);
      r.onPresenter({ id: 'u-nora', name: 'Nora Al-Otaibi', unit: null, position: null });
      r.setDuration(1, 15);
      r.closeStanding();
      fixture.detectChanges();
      expect(text('repeat-standing')).toBe('2 items · Edit…');
      settle();
      c.submit();
      tick();
      expect(createSeries.calls.mostRecent().args[0].standingAgenda).toEqual([
        { title: 'Open actions', presenterUserId: null, durationMinutes: null },
        { title: 'Infection rates', presenterUserId: 'u-nora', durationMinutes: 15 },
      ]);
    }));

    it('a refusal while working out the dates is said from its code, with Retry', fakeAsync(() => {
      seriesPreview.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_SERIES_TOO_LONG' } })));
      const { c, fill, settle, text } = create();
      fill();
      c.next();
      settle();
      expect(text('repeat-dates-error')).toContain('A series ends at most 12 months ahead.');
    }));
  });
});
