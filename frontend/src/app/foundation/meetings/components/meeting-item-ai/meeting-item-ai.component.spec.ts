import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { FormatService } from '../../../../core/formatting';
import { aMinutes, anAi, anAiAction, anAttendanceRow } from '../../meeting-fixtures.testing';
import { MeetingMinutesAi } from '../../meeting-minutes-ai';
import { MinutesWriteOrder } from '../../minutes-write-order';
import { MeetingService, type MeetingAiDto, type MeetingAiMinutesSuggestionDto } from '../../services/meeting.service';
import { MeetingItemAiComponent } from './meeting-item-ai.component';

const MINUTES_SUGG: MeetingAiMinutesSuggestionDto = {
  id: 'ai-min-1',
  agendaItemId: 'i-1',
  language: 'en',
  nothing: false,
  discussion: 'Compliance rose to 84% against a 90% target.',
  decisions: [{ text: 'Re-audit 4B and 6A in November.', votes: { for: 5, against: 2, abstain: 0 }, abovePresent: true }],
  replaces: { discussion: true, decisions: false },
};

// ACC-322 PR 2 — one item's AI suggestions: the minutes suggestion with its
// votes as stated and flagged (M6) and what Accept replaces (M5); the action
// suggestions with our code's reasons, Accept only when complete, and the
// inline Edit that accepts with what it chose.
describe('MeetingItemAiComponent (ACC-322 PR 2)', () => {
  preserveDocumentLanguage();
  let svc: Record<string, jasmine.Spy>;
  let fixture: ComponentFixture<MeetingItemAiComponent>;
  let el: HTMLElement;

  function create(ai: MeetingAiDto, language: 'en' | 'ar' = 'en') {
    svc = {
      ai: jasmine.createSpy('ai').and.returnValue(of(ai)),
      acceptAi: jasmine.createSpy('acceptAi').and.returnValue(of({ minutes: aMinutes(), ai: anAi() })),
      discardAi: jasmine.createSpy('discardAi').and.returnValue(of(anAi())),
    };
    TestBed.configureTestingModule({
      imports: [MeetingItemAiComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        MinutesWriteOrder,
        MeetingMinutesAi,
        { provide: MeetingService, useValue: svc },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(MeetingMinutesAi).load('m-1');
    fixture = TestBed.createComponent(MeetingItemAiComponent);
    fixture.componentRef.setInput('itemId', 'i-1');
    fixture.componentRef.setInput('itemTitle', 'Hand-hygiene compliance, Q3');
    fixture.componentRef.setInput('attendance', aMinutes().attendance);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  const text = () => el.textContent ?? '';
  const button = (attr: string) => el.querySelector<HTMLButtonElement>(`[${attr}] button`);

  it('the minutes suggestion: marked as AI, the discussion and decision, the vote as stated, M6 flagged, M5 said', () => {
    create(anAi({ presentMembers: 6, suggestions: { minutes: [MINUTES_SUGG], actions: [] }, undecided: 1 }));
    expect(el.querySelector('.am-ai__result')).withContext('the four AI marks').not.toBeNull();
    expect(text()).toContain(en.meeting.ai.minutesTag);
    expect(el.querySelector('[data-ai-discussion]')!.textContent).toContain('Compliance rose to 84%');
    expect(el.querySelector('[data-ai-votes]')!.textContent).toContain('Vote: 5 for · 2 against · 0 abstain · from your notes');
    expect(el.querySelector('[data-ai-votes-above]')!.textContent).toContain('These add up to 7, more than the 6 members present.');
    expect(el.querySelector('[data-ai-replaces]')!.textContent).toContain(en.meeting.ai.replacesDiscussion);
    expect(text()).toContain(en.meeting.ai.acceptIntoMinutes);
  });

  it('a vote the notes did not state: "not in your notes · left empty", no flag; nothing replaced, no line', () => {
    create(anAi({ suggestions: { minutes: [{ ...MINUTES_SUGG, decisions: [{ text: 'Continue monthly audit.', votes: null, abovePresent: false }], replaces: { discussion: false, decisions: false } }], actions: [] } }));
    expect(el.querySelector('[data-ai-votes]')!.textContent).toContain(en.meeting.ai.votesEmpty);
    expect(el.querySelector('[data-ai-votes-above]')).toBeNull();
    expect(el.querySelector('[data-ai-replaces]')).toBeNull();
  });

  it('M5 names decisions alone, and both', () => {
    create(anAi({ suggestions: { minutes: [{ ...MINUTES_SUGG, replaces: { discussion: true, decisions: true } }], actions: [] } }));
    expect(el.querySelector('[data-ai-replaces]')!.textContent).toContain(en.meeting.ai.replacesBoth);
  });

  it('Accept into minutes accepts it; the page gets the minutes answer', () => {
    create(anAi({ suggestions: { minutes: [MINUTES_SUGG], actions: [] }, undecided: 1 }));
    let shown = 0;
    TestBed.inject(MeetingMinutesAi).minutesChange.subscribe(() => shown++);
    el.querySelector<HTMLButtonElement>('.am-ai__primary')!.click();
    expect(svc['acceptAi']).toHaveBeenCalledOnceWith('m-1', 'ai-min-1', {});
    expect(shown).toBe(1);
  });

  it('an item the notes say nothing about reads so, with Discard only (accepting it is refused)', () => {
    create(anAi({ suggestions: { minutes: [{ ...MINUTES_SUGG, nothing: true, discussion: null, decisions: [] }], actions: [] } }));
    expect(text()).toContain(en.meeting.ai.nothing);
    expect(el.querySelector('.am-ai__primary')).toBeNull();
    button('data-ai-discard')!.click();
    expect(svc['discardAi']).toHaveBeenCalledOnceWith('m-1', 'ai-min-1');
  });

  it('an action with an owner and a due date: Accept, named by its title (WCAG 2.5.3)', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction()] } }));
    const accept = button('data-ai-accept')!;
    expect(accept.getAttribute('aria-label')).toBe('Accept: Repair negative-pressure alarm, room 3');
    accept.click();
    expect(svc['acceptAi']).toHaveBeenCalledOnceWith('m-1', 'ai-act-1', {});
  });

  it('M7: an outside guest is never suggested; Owner — and the reason, and no Accept', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ owner: null, ownerReason: { code: 'OUTSIDE_GUEST', name: 'Dr. Lina Mansour' } })] } }));
    expect(text()).toContain(en.meeting.ai.ownerNone);
    expect(el.querySelector('[data-ai-why]')!.textContent).toContain("Dr. Lina Mansour is an outside guest, so isn't suggested as owner.");
    expect(button('data-ai-accept')).toBeNull();
  });

  it('build note 1: the Arabic outside-guest reason is neutral about the person', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ owner: null, ownerReason: { code: 'OUTSIDE_GUEST', name: 'د. لينا منصور' } })] } }), 'ar');
    expect(el.querySelector('[data-ai-why]')!.textContent!.trim()).toBe('لا يُقترح ضيف من الخارج مسؤولًا (د. لينا منصور). اختر شخصًا في المنشأة.');
  });

  it('a name nobody matches, and a date that has passed, each give their sentence', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ owner: null, ownerReason: { code: 'NO_MATCH', name: 'Omar' }, dueAt: null, dueReason: { code: 'DATE_PASSED', day: '2026-09-15' } })] } }));
    const why = Array.from(el.querySelectorAll('[data-ai-why]')).map((w) => w.textContent!.trim());
    expect(why).toEqual(['No one in the organisation matches “Omar”. Choose a person.', `The date in your notes, ${TestBed.inject(FormatService).date('2026-09-15T09:00:00.000Z')}, has passed. Choose a due date.`]);
  });

  it('Edit opens the three fields inline, prefilled; saving accepts with what was chosen', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction()] } }));
    button('data-ai-edit')!.click();
    fixture.detectChanges();
    const title = el.querySelector<HTMLInputElement>('[data-ai-edit-title]')!;
    expect(title.value).toBe('Repair negative-pressure alarm, room 3');
    title.value = 'Repair the alarm in room 3';
    title.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-ai-edit-save] button')!.click();
    expect(svc['acceptAi']).toHaveBeenCalledOnceWith('m-1', 'ai-act-1', { title: 'Repair the alarm in room 3', ownerUserId: 'u-3', dueAt: '2027-04-15T13:00:00.000Z' });
  });

  it('Edit on an action with no owner or date: saving is held until they are chosen (Save is never disabled)', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ owner: null, dueAt: null })] } }));
    button('data-ai-edit')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('[data-ai-edit-save] button')!.click();
    fixture.detectChanges();
    expect(svc['acceptAi']).not.toHaveBeenCalled();
    expect(text()).toContain(en.meeting.action.ownerRequired);
  });

  it('the suggested owner is offered even when not an invitee (a person of the organisation)', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ owner: { userId: 'u-9', name: 'Omar Haddad' } })] } }));
    const options = fixture.componentInstance.ownerOptions(anAiAction({ owner: { userId: 'u-9', name: 'Omar Haddad' } }));
    expect(options.map((o) => o.value)).toEqual(['u-9', 'u-1', 'u-2', 'u-3']);
    fixture.componentRef.setInput('attendance', [...aMinutes().attendance, anAttendanceRow({ attendeeId: 'a-out', kind: 'OUTSIDE_GUEST', userId: null, name: 'Dr. Lina Mansour', seat: null })]);
    expect(fixture.componentInstance.ownerOptions(anAiAction()).some((o) => o.label.startsWith('Dr. Lina Mansour'))).withContext('an outside guest never').toBeFalse();
  });

  it('a suggestion gone (decided elsewhere, or replaced by Draft again) offers Reload', () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction()] } }));
    let reloads = 0;
    fixture.componentInstance.reload.subscribe(() => reloads++);
    svc['acceptAi'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'MEETING_AI_SUGGESTION_GONE' } })));
    button('data-ai-accept')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-ai-item-error]')!.textContent).toContain(en.meeting.refusal.aiSuggestionGone);
    button('data-ai-reload')!.click();
    expect(reloads).toBe(1);
  });

  it("an action's own refusal is said from its code (a due date in the past)", () => {
    create(anAi({ suggestions: { minutes: [], actions: [anAiAction()] } }));
    svc['acceptAi'].and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'MEETING_ACTION_DUE_IN_PAST' } })));
    button('data-ai-accept')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-ai-item-error]')!.textContent).toContain(en.meeting.refusal.actionDueInPast);
  });

  it('suggestions for another item are not shown here', () => {
    create(anAi({ suggestions: { minutes: [{ ...MINUTES_SUGG, agendaItemId: 'i-2' }], actions: [anAiAction({ agendaItemId: 'i-2' })] } }));
    expect(el.querySelector('[data-ai-suggestion]')).toBeNull();
  });
});
