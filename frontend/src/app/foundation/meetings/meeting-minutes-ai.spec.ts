import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { aMinutes, anAi, anAiAction } from './meeting-fixtures.testing';
import { MeetingMinutesAi } from './meeting-minutes-ai';
import { MinutesWriteOrder } from './minutes-write-order';
import { MeetingService, type MeetingAiDto, type MeetingMinutesDto } from './services/meeting.service';

// ACC-322 PR 2 — the page's Meetings AI state: the newest read wins, an accept
// is a minutes write in the page's order (P206), and a discard tells the page
// to re-read the minutes so Distribute's count is current (M2).
describe('MeetingMinutesAi (ACC-322 PR 2)', () => {
  let svc: Record<string, jasmine.Spy>;
  let store: MeetingMinutesAi;
  let order: MinutesWriteOrder;

  beforeEach(() => {
    svc = {
      ai: jasmine.createSpy('ai').and.returnValue(of(anAi())),
      acceptAi: jasmine.createSpy('acceptAi'),
      discardAi: jasmine.createSpy('discardAi').and.returnValue(of(anAi({ undecided: 0 }))),
    };
    TestBed.configureTestingModule({ providers: [MinutesWriteOrder, MeetingMinutesAi, { provide: MeetingService, useValue: svc }] });
    store = TestBed.inject(MeetingMinutesAi);
    order = TestBed.inject(MinutesWriteOrder);
  });

  it('an older read never replaces a newer one', () => {
    const first = new Subject<MeetingAiDto>();
    const second = new Subject<MeetingAiDto>();
    svc['ai'].and.returnValues(first, second);
    store.load('m-1');
    store.reread();
    second.next(anAi({ undecided: 2 }));
    first.next(anAi({ undecided: 9 }));
    expect(store.ai()!.undecided).toBe(2);
  });

  it('clear() drops what was shown, and a read still in flight lands nowhere', () => {
    const read = new Subject<MeetingAiDto>();
    svc['ai'].and.returnValue(read);
    store.load('m-1');
    store.clear();
    read.next(anAi());
    expect(store.ai()).toBeNull();
  });

  it("an accept's minutes reach the page only when it answers the newest minutes write (P206)", () => {
    const answer = new Subject<{ minutes: MeetingMinutesDto; ai: MeetingAiDto }>();
    svc['acceptAi'].and.returnValue(answer);
    store.load('m-1');
    const shown: MeetingMinutesDto[] = [];
    store.minutesChange.subscribe((m) => shown.push(m));
    store.accept('ai-1').subscribe();
    order.begin(); // a newer minutes write begins before the accept answers
    answer.next({ minutes: aMinutes(), ai: anAi() });
    expect(shown).toEqual([]);
  });

  it("a discard tells the page to re-read the minutes; the suggestions follow the server's answer", () => {
    svc['ai'].and.returnValue(of(anAi({ suggestions: { minutes: [], actions: [anAiAction()] }, undecided: 1 })));
    store.load('m-1');
    expect(store.actionsOf('i-1').length).toBe(1);
    let counted = 0;
    store.countChanged.subscribe(() => counted++);
    store.discard('ai-act-1').subscribe();
    expect(counted).toBe(1);
    expect(store.actionsOf('i-1')).toEqual([]);
  });
});
