import { TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { aMinutes, aMinutesItem, anAi, anAiAction } from '../../meeting-fixtures.testing';
import { MeetingMinutesAi } from '../../meeting-minutes-ai';
import { MinutesWriteOrder } from '../../minutes-write-order';
import { MeetingService, type MeetingAiDto } from '../../services/meeting.service';
import { MeetingActionItemsCardComponent } from './meeting-action-items-card.component';

// ACC-322 PR 2 — the Action items card: every draft action item "From item n",
// and, for whoever records the minutes, the undecided AI action suggestions
// and the items they sit under.
describe('MeetingActionItemsCardComponent (ACC-322 PR 2)', () => {
  const MINUTES = aMinutes({
    items: [
      aMinutesItem({ id: 'i-1', order: 2, title: 'Hand hygiene', actionItems: [{ id: 'act-1', title: 'Re-audit wards 4B and 6A', owner: { id: 'u-2', name: 'Omar Haddad' }, dueAt: '2027-04-30T13:00:00.000Z', task: null }] }),
      aMinutesItem({ id: 'i-2', order: 4, title: 'Isolation room' }),
    ],
  });

  function create(ai: MeetingAiDto | null, language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [MeetingActionItemsCardComponent],
      providers: [provideTranslateService({ lang: 'en' }), provideFormatTesting(), MinutesWriteOrder, MeetingMinutesAi, { provide: MeetingService, useValue: { ai: () => of(ai) } }],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    if (ai) TestBed.inject(MeetingMinutesAi).load('m-1');
    const fixture = TestBed.createComponent(MeetingActionItemsCardComponent);
    fixture.componentRef.setInput('minutes', MINUTES);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('lists each draft action item with the item it comes from', () => {
    const el = create(null);
    const row = el.querySelector('[data-action-card-row="act-1"]')!;
    expect(row.textContent).toContain('Re-audit wards 4B and 6A');
    expect(row.textContent).toContain('Omar Haddad');
    expect(row.textContent).toContain('From item 2');
    expect(el.querySelector('[data-testid="meeting-action-items-ai"]')).toBeNull();
  });

  it('counts the undecided AI action suggestions, with their items (6.2)', () => {
    const el = create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ id: 'a1' }), anAiAction({ id: 'a2', agendaItemId: 'i-2' }), anAiAction({ id: 'a3', agendaItemId: 'i-2' })] } }));
    const line = el.querySelector('[data-testid="meeting-action-items-ai"]')!.textContent!;
    expect(line).toContain('3 AI suggestions undecided · items 2, 4');
    expect(line).toContain(en.meeting.actionsCard.notYet);
  });

  it('in Arabic, the counted words follow the language (six forms)', () => {
    const el = create(anAi({ suggestions: { minutes: [], actions: [anAiAction({ id: 'a1' }), anAiAction({ id: 'a2' })] } }), 'ar');
    expect(el.querySelector('[data-testid="meeting-action-items-ai"]')!.textContent).toContain('اقتراحان لم يُبتّ فيهما · البند 2');
  });
});
