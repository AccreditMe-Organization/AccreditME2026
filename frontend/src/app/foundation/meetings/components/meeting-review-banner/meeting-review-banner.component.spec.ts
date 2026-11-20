import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes, aMinutesItem } from '../../meeting-fixtures.testing';
import { MeetingService, type MeetingMinutesDto } from '../../services/meeting.service';
import { MeetingReviewBannerComponent } from './meeting-review-banner.component';

// ACC-316 PR 7c-1 — the review banner: shown exactly on the server's may.review,
// No corrections in one press, the person's own answer, and this round's changes.
describe('MeetingReviewBannerComponent (ACC-316 PR 7c-1)', () => {
  let noCorrections: jasmine.Spy;
  const inReview = (over: Partial<MeetingMinutesDto> = {}) =>
    aMinutes({
      phase: 'review',
      items: [aMinutesItem({ id: 'i-2', order: 2 })],
      review: { round: 1, reviewBy: '2027-03-25', datePassed: false, closed: false, reviewers: [], suggestions: [], changes: [], mine: null },
      may: { ...aMinutes().may, recordAttendance: false, recordMinutes: false, distribute: false, review: true },
      ...over,
    });

  function create(minutes: MeetingMinutesDto) {
    noCorrections = jasmine.createSpy('noCorrections').and.returnValue(of(undefined));
    TestBed.configureTestingModule({
      imports: [MeetingReviewBannerComponent],
      providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({}), { provide: MeetingService, useValue: { noCorrections } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingReviewBannerComponent);
    fixture.componentRef.setInput('meetingId', 'm-1');
    fixture.componentRef.setInput('minutes', minutes);
    fixture.componentRef.setInput('scheduledAt', '2027-03-18T07:00:00.000Z');
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('is not drawn without may.review, whatever the phase', () => {
    const { el } = create(inReview({ may: { ...inReview().may, review: false } }));
    expect(el.querySelector('[data-testid="meeting-review-banner"]')).toBeNull();
  });

  it('says the date, and No corrections answers in one press', () => {
    const { el, c } = create(inReview());
    const answered = jasmine.createSpy('answered');
    c.answered.subscribe(answered);
    expect(el.querySelector('[data-testid="meeting-review-banner"] h2')?.textContent).toContain('Review the minutes by 25 Mar 2027');
    el.querySelector<HTMLElement>('[data-testid="meeting-review-no-corrections"] button')!.click();
    expect(noCorrections).toHaveBeenCalledOnceWith('m-1');
    expect(answered).toHaveBeenCalledTimes(1);
  });

  it('after "No corrections" it says so and offers only Suggest, which the server allows', () => {
    const { el } = create(inReview({ review: { ...inReview().review, mine: 'NO_CORRECTIONS' } }));
    expect(el.querySelector('[data-testid="meeting-review-mine"]')?.textContent?.trim()).toBe('You answered: no corrections.');
    expect(el.querySelector('[data-testid="meeting-review-no-corrections"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-review-suggest"]')).not.toBeNull();
  });

  it('after a suggestion it says so and does not offer "No corrections", which the server would refuse (P220)', () => {
    const { el } = create(inReview({ review: { ...inReview().review, mine: 'SUGGESTED' } }));
    expect(el.querySelector('[data-testid="meeting-review-mine"]')?.textContent?.trim()).toBe(en.meeting.review.mine.SUGGESTED);
    expect(el.querySelector('[data-testid="meeting-review-no-corrections"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-review-suggest"]')).not.toBeNull();
  });

  it("names this round's changes by item, and not an earlier round's", () => {
    const { el } = create(
      inReview({
        review: {
          ...inReview().review,
          round: 2,
          changes: [
            { round: 2, agendaItemId: 'i-2', what: 'DECISION' },
            { round: 1, agendaItemId: 'i-2', what: 'DISCUSSION' },
          ],
        },
      }),
    );
    expect(el.querySelector('[data-testid="meeting-review-changes"]')?.textContent?.trim()).toBe('Changed during review: item 2, decision');
  });

  it('a refusal is said from its code, with nothing to press', () => {
    const { el, fixture } = create(inReview());
    noCorrections.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { code: 'MEETING_NOT_REVIEWER' } })));
    el.querySelector<HTMLElement>('[data-testid="meeting-review-no-corrections"] button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-review-error"]')?.textContent?.trim()).toBe(en.meeting.refusal.notReviewer);
    expect(el.querySelector('[data-testid="meeting-review-reload"]')).toBeNull();
    expect(el.querySelector('[data-testid="meeting-review-retry"]')).toBeNull();
  });

  it('"No corrections" on a stale banner (a suggestion was sent meanwhile) offers Reload (P227)', () => {
    const { el, fixture } = create(inReview());
    noCorrections.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_REVIEW_SUGGESTED' } })));
    el.querySelector<HTMLElement>('[data-testid="meeting-review-no-corrections"] button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-review-error"]')?.textContent).toContain(en.meeting.refusal.reviewSuggested);
    expect(el.querySelector('[data-testid="meeting-review-reload"]')).not.toBeNull();
  });

  it('the server not reached: Retry, which sends "No corrections" again (P227)', () => {
    const { el, fixture, c } = create(inReview());
    const answered = jasmine.createSpy('answered');
    c.answered.subscribe(answered);
    noCorrections.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
    el.querySelector<HTMLElement>('[data-testid="meeting-review-no-corrections"] button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-review-reload"]')).toBeNull();
    noCorrections.and.returnValue(of(undefined));
    el.querySelector<HTMLElement>('[data-testid="meeting-review-retry"] button')!.click();
    fixture.detectChanges();
    expect(noCorrections).toHaveBeenCalledTimes(2);
    expect(answered).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="meeting-review-error"]')).toBeNull();
  });

  it('a stale refusal offers Reload, which asks the page to read the meeting (P220)', () => {
    const { el, fixture, c } = create(inReview());
    const reload = jasmine.createSpy('reload');
    c.reload.subscribe(reload);
    noCorrections.and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_CHANGED' } })));
    el.querySelector<HTMLElement>('[data-testid="meeting-review-no-corrections"] button')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="meeting-review-error"]')?.textContent).toContain(en.meeting.refusal.changed);
    el.querySelector<HTMLElement>('[data-testid="meeting-review-reload"] button')!.click();
    fixture.detectChanges();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(el.querySelector('[data-testid="meeting-review-error"]')).toBeNull();
  });
});
