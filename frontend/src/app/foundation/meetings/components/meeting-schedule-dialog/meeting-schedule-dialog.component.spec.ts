import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { FormatService } from '../../../../core/formatting';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingDto } from '../../services/meeting.service';
import { MeetingScheduleDialogComponent } from './meeting-schedule-dialog.component';

// ACC-316 PR 6 review (P184) — Schedule meeting: the start is the TENANT's
// wall clock; types that fail to load say so with Retry; and a press whose
// outcome is unknown never offers a plain retry that could schedule it twice.
describe('MeetingScheduleDialogComponent (ACC-316 PR 6)', () => {
  const TYPES = [{ id: 't-1', labelEn: 'Regular', labelAr: 'اعتيادي' }];
  let formChoices: () => Observable<{ types: typeof TYPES }>;
  let schedule: jasmine.Spy;

  function create() {
    TestBed.configureTestingModule({
      imports: [MeetingScheduleDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: MeetingService, useValue: { formChoices: () => formChoices(), schedule } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingScheduleDialogComponent);
    fixture.componentRef.setInput('visible', true);
    fixture.componentRef.setInput('owner', { kind: 'COMMITTEE', id: 'c-1', name: 'Pharmacy and Therapeutics Committee' });
    fixture.detectChanges();
    const c = fixture.componentInstance;
    const fill = (time = '10:00') => {
      c.form.patchValue({ title: 'Quarterly review', typeValueId: 't-1', durationMinutes: 60, time, location: 'Room 4' });
      c.pickDay(new Date(2027, 2, 18));
    };
    return { fixture, c, fill };
  }

  beforeEach(() => {
    formChoices = () => of({ types: TYPES });
    schedule = jasmine.createSpy('schedule').and.returnValue(of(aMeeting()));
  });
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it("sends the start as the TENANT's 10:00, not the browser's", () => {
    const browser = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const tenant = browser === 'America/New_York' ? 'Asia/Tokyo' : 'America/New_York';
    const { c, fill } = create();
    TestBed.inject(TestFormatContext).zone.set(tenant);
    fill('10:00');
    c.submit();
    const at = new Date(schedule.calls.mostRecent().args[0].scheduledAt);
    expect(TestBed.inject(FormatService).wallClock(at)).toEqual({ year: 2027, month: 3, day: 18, hour: 10, minute: 0 });
    expect(at.getTime()).withContext('not the browser 10:00').not.toBe(new Date(2027, 2, 18, 10, 0).getTime());
  });

  describe('meeting types that fail to load', () => {
    it('say so with Retry, in place of an empty Type list, and Retry loads them', () => {
      formChoices = () => throwError(() => new HttpErrorResponse({ status: 500 }));
      const { fixture, c } = create();
      expect(c.typesState()).toBe('error');
      expect(document.querySelector('[data-testid="schedule-types-error"]')?.textContent).toContain(en.meeting.schedule.typesError);
      formChoices = () => of({ types: TYPES });
      document.querySelector<HTMLButtonElement>('[data-testid="schedule-types-retry"] button')!.click();
      fixture.detectChanges();
      expect(c.typesState()).toBe('ready');
      expect(document.querySelector('[data-testid="schedule-types-error"]')).toBeNull();
      expect(c.typeOptions().map((o) => o.value)).toEqual(['t-1']);
    });
  });

  describe('a press whose outcome is unknown', () => {
    for (const status of [0, 504, 500]) {
      it(`(${status}) says it may have been scheduled, asks the opener to read its list, and offers Close only`, () => {
        schedule.and.returnValue(throwError(() => new HttpErrorResponse({ status })));
        const { fixture, c, fill } = create();
        const reread = jasmine.createSpy('maybeScheduled');
        c.maybeScheduled.subscribe(reread);
        fill();
        c.submit();
        fixture.detectChanges();
        expect(c.uncertain()).toBeTrue();
        expect(c.error()).toBe('meeting.schedule.maybeScheduled');
        expect(reread).toHaveBeenCalledTimes(1);
        expect(document.querySelector('[data-testid="schedule-submit"]')).withContext('no plain retry').toBeNull();
        expect(document.querySelector('[data-testid="schedule-close"]')).not.toBeNull();
        c.submit();
        expect(schedule).toHaveBeenCalledTimes(1);
      });
    }

    it('a refusal is not unknown: nothing was written, so it is said and Schedule stays', () => {
      schedule.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_TIME_IN_PAST' } })));
      const { fixture, c, fill } = create();
      fill();
      c.submit();
      fixture.detectChanges();
      expect(c.uncertain()).toBeFalse();
      expect(c.error()).toBe('meeting.refusal.timeInPast');
      expect(document.querySelector('[data-testid="schedule-submit"]')).not.toBeNull();
    });
  });

  // P189 j — the earliest day is today's, read again each time the dialog opens:
  // a page left open past midnight must not offer yesterday.
  describe('the earliest day', () => {
    afterEach(() => jasmine.clock().uninstall());

    it('is read again when the dialog opens, not once when it was made', () => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date('2027-03-17T12:00:00Z'));
      const { fixture, c } = create();
      const day = () => [c.minDay().getFullYear(), c.minDay().getMonth(), c.minDay().getDate()];
      expect(day()).toEqual([2027, 2, 17]);
      fixture.componentRef.setInput('visible', false);
      fixture.detectChanges();
      jasmine.clock().mockDate(new Date('2027-03-18T12:00:00Z'));
      fixture.componentRef.setInput('visible', true);
      fixture.detectChanges();
      expect(day()).toEqual([2027, 2, 18]);
    });
  });
});
