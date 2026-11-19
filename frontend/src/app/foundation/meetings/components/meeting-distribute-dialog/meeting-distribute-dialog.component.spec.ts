import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingDistributeDialogComponent } from './meeting-distribute-dialog.component';

// ACC-316 PR 7b — Distribute Minutes?: the server's default review date, sent
// only when the person changes it; who is asked to review; and, while attendance
// is incomplete, who is missing and no Distribute.
describe('MeetingDistributeDialogComponent (ACC-316 PR 7b)', () => {
  let distribute: jasmine.Spy;
  const READY = aMinutes({
    attendance: [anAttendanceRow({ attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-2', userId: 'u-2', name: 'Huda', attendance: 'PRESENT' }), anAttendanceRow({ attendeeId: 'a-3', userId: 'u-3', name: 'Saad', attendance: 'ABSENT' })],
    distribute: { ready: true, blockedBy: null, defaultReviewBy: '2027-03-25' },
  });

  function create(minutes: MeetingMinutesDto = READY) {
    distribute = jasmine.createSpy('distribute').and.returnValue(of(undefined));
    TestBed.configureTestingModule({
      imports: [MeetingDistributeDialogComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), ConfirmationService, { provide: MeetingService, useValue: { distribute } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingDistributeDialogComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('minutes', minutes);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
    const done = jasmine.createSpy('done');
    fixture.componentInstance.distributed.subscribe(done);
    return { fixture, c: fixture.componentInstance, done };
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  it("opens on the server's default date and sends none when it isn't changed", () => {
    const { c, done } = create();
    expect(c.day()).toEqual(new Date(2027, 2, 25));
    expect(c.dayText()).toContain('25 March 2027');
    c.submit();
    expect(distribute).toHaveBeenCalledOnceWith('m-1', undefined);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('a date the person picks is sent as yyyy-MM-dd', () => {
    const { c } = create();
    c.pickDay(new Date(2027, 2, 29));
    c.submit();
    expect(distribute).toHaveBeenCalledOnceWith('m-1', '2027-03-29');
  });

  it('says how many present members are asked to review', () => {
    const { c } = create();
    expect(c.reviewers()).toBe('Asked to review: 2 present members');
  });

  it('while attendance is incomplete, it names who is missing and offers no Distribute', () => {
    const { fixture, c } = create(aMinutes());
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="distribute-blocked"]')?.textContent).toContain('Dr. Nora Al-Otaibi');
    expect(document.querySelector('[data-testid="distribute-submit"]')).toBeNull();
    expect(c.blocked()).not.toBeNull();
  });

  it('a refusal is said from its code', () => {
    const { c } = create();
    distribute.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_REVIEW_DATE_INVALID' } })));
    c.submit();
    expect(c.error()).toBe('meeting.refusal.reviewDateInvalid');
  });

  it('votes above the members present hold Distribute, naming the item and its numbers (P206)', () => {
    const { fixture } = create(
      aMinutes({ distribute: { ready: false, blockedBy: { code: 'MEETING_VOTES_EXCEED_PRESENT', items: [{ agendaItemId: 'i-1', title: 'Hand hygiene', total: 6, present: 4 }] }, defaultReviewBy: '2027-03-25' } }),
    );
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="distribute-votes-above"]')?.textContent).toContain('Hand hygiene: 6 votes, 4 present members');
    expect(document.querySelector('[data-testid="distribute-submit"]')).toBeNull();
  });

  it('MEETING_VOTES_EXCEED_PRESENT from the press shows no placeholder, and asks the page to read the minutes again (P211)', () => {
    const { c, fixture } = create();
    const refresh = jasmine.createSpy('refresh');
    c.refreshMinutes.subscribe(refresh);
    distribute.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_VOTES_EXCEED_PRESENT', items: [{ agendaItemId: 'i-1', title: 'Hand hygiene', total: 6, present: 4 }] } })));
    c.submit();
    fixture.detectChanges();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.p-dialog')?.textContent ?? '').not.toContain('{{');
    expect(c.error()).toBe('meeting.distribute.blockedNow');
  });
});
