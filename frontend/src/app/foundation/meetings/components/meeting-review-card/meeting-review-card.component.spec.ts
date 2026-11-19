import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes } from '../../meeting-fixtures.testing';
import type { MeetingMinutesDto, MeetingSuggestionDto } from '../../services/meeting.service';
import { MeetingReviewCardComponent } from './meeting-review-card.component';

// ACC-316 PR 7c-1 — the Review card: in review and after, who answered, the
// open suggestions and the date; whole-minutes suggestions with Mark applied and
// Decline only for whoever may apply suggestions.
describe('MeetingReviewCardComponent (ACC-316 PR 7c-1)', () => {
  const suggestion = (over: Partial<MeetingSuggestionDto> = {}): MeetingSuggestionDto => ({
    id: 's-1',
    round: 1,
    agendaItemId: null,
    author: { id: 'u-3', name: 'Dr. Sara Al-Qahtani' },
    text: 'Add the apologies received.',
    status: 'OPEN',
    reply: null,
    createdAt: '2027-03-19T08:00:00.000Z',
    decidedAt: null,
    ...over,
  });
  const inReview = (over: Partial<MeetingMinutesDto['review']> = {}, may: Partial<MeetingMinutesDto['may']> = {}) =>
    aMinutes({
      phase: 'review',
      review: {
        round: 1,
        reviewBy: '2027-03-25',
        datePassed: false,
        closed: false,
        reviewers: [
          { userId: 'u-1', name: 'Dr. Nora Al-Otaibi', answered: true },
          { userId: 'u-2', name: 'Huda Al-Harbi', answered: false },
        ],
        suggestions: [suggestion(), suggestion({ id: 's-2', agendaItemId: 'i-1' })],
        changes: [],
        mine: null,
        ...over,
      },
      may: { ...aMinutes().may, applySuggestions: false, ...may },
    });

  function create(minutes: MeetingMinutesDto) {
    TestBed.configureTestingModule({ imports: [MeetingReviewCardComponent], providers: [provideNoopAnimations(), provideTranslateService({ lang: 'en' }), provideFormatTesting(), providePrimeNG({})] });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    const fixture = TestBed.createComponent(MeetingReviewCardComponent);
    fixture.componentRef.setInput('minutes', minutes);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('is not drawn in the draft', () => {
    expect(create(aMinutes()).el.querySelector('[data-testid="meeting-review-card"]')).toBeNull();
  });

  it('counts who answered, who has not, the open suggestions, and the closing date', () => {
    const { el } = create(inReview());
    expect(el.querySelector('[data-testid="meeting-review-summary"]')?.textContent?.trim()).toBe('1 answered · 1 no answer yet · 2 suggestions open · Review closes 25 Mar 2027');
    expect(el.querySelector('[data-reviewer="u-2"]')?.textContent).toContain('No answer yet');
  });

  it('lists only the whole-minutes suggestions (an item\'s sit under the item), without actions for a reader', () => {
    const { el } = create(inReview());
    expect(el.querySelector('[data-suggestion="s-1"]')).not.toBeNull();
    expect(el.querySelector('[data-suggestion="s-2"]')).toBeNull();
    expect(el.querySelector('[data-suggestion-apply="s-1"]')).toBeNull();
    expect(el.querySelector('[data-suggestion-decline="s-1"]')).toBeNull();
  });

  it('whoever may apply suggestions gets Mark applied and Decline on an open one', () => {
    const { el, c } = create(inReview({}, { applySuggestions: true }));
    const apply = jasmine.createSpy('apply');
    const decline = jasmine.createSpy('decline');
    c.apply.subscribe(apply);
    c.decline.subscribe(decline);
    el.querySelector<HTMLElement>('[data-suggestion-apply="s-1"] button')!.click();
    el.querySelector<HTMLElement>('[data-suggestion-decline="s-1"] button')!.click();
    expect(apply.calls.mostRecent().args[0].id).toBe('s-1');
    expect(decline.calls.mostRecent().args[0].id).toBe('s-1');
  });

  it('a decided suggestion shows its status and reply, and no action', () => {
    const { el } = create(inReview({ suggestions: [suggestion({ status: 'DECLINED', reply: 'Already recorded.' })] }, { applySuggestions: true }));
    expect(el.querySelector('[data-suggestion="s-1"]')?.textContent).toContain('Declined');
    expect(el.querySelector('[data-suggestion="s-1"]')?.textContent).toContain('Reply: Already recorded.');
    expect(el.querySelector('[data-suggestion-apply="s-1"]')).toBeNull();
  });
});
