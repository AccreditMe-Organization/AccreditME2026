import { TestBed } from '@angular/core/testing';
import { MyWorkEvents } from '../../core/my-work/my-work-events';
import { MyWorkCountsService } from './my-work-counts.service';
import { HomeSpecCalls, HomeSpecOptions, homeProviders, recordList } from './home.testing';

// ACC-279 — the person's work counts: loaded once after sign-in, again on Home's
// entry and after actions, never by a timer; a failure is a failure, never 0.
describe('MyWorkCountsService (ACC-279)', () => {
  let service: MyWorkCountsService;
  let calls: HomeSpecCalls;

  function build(opts: HomeSpecOptions = {}): void {
    const setup = homeProviders(opts);
    calls = setup.calls;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: setup.providers });
    service = TestBed.inject(MyWorkCountsService);
  }

  const mineReads = () => calls.recordList.filter((q) => q.view === 'mine').length;

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  it('loads nothing until init(), then each read once; a second init() loads nothing', () => {
    build();
    expect(mineReads()).toBe(0);
    service.init();
    expect(mineReads()).toBe(2); // open tasks, and the overdue count
    expect(calls.awaitingMe).toBe(1);
    expect(calls.committees).toBe(1);
    service.init();
    expect(mineReads()).toBe(2);
  });

  it("Home's entry right after sign-in does not load twice; later, it reloads", () => {
    jasmine.clock().mockDate(new Date('2026-11-06T09:00:00.000Z'));
    build();
    service.init();
    service.refreshOnEntry();
    expect(calls.awaitingMe).toBe(1);
    jasmine.clock().tick(5000);
    service.refreshOnEntry();
    expect(calls.awaitingMe).toBe(2);
  });

  it('a burst of actions is one reload, and only after sign-in', () => {
    build();
    const events = TestBed.inject(MyWorkEvents);
    events.changed();
    jasmine.clock().tick(1);
    expect(calls.awaitingMe).toBe(0);

    service.init();
    events.changed();
    events.changed();
    events.changed();
    jasmine.clock().tick(1);
    expect(calls.awaitingMe).toBe(2);
  });

  it('a failed read is "failed", never a number; the others still load', () => {
    build({ myTasks: 'fail', myOverdue: 2 });
    service.init();
    expect(service.myTasks()).toEqual({ state: 'failed' });
    expect(service.myOverdue()).toEqual({ state: 'ready', value: 2 });
  });

  it('a reload keeps the last answer until the new one arrives (no flicker to a skeleton)', () => {
    build({ myTasks: recordList([], 4) });
    service.init();
    expect(service.myTasks().state).toBe('ready');
    service.reload();
    expect(service.myTasks().state).toBe('ready');
  });

  it('change requests are asked only of committees:approve holders', () => {
    build({ permissions: [] });
    service.init();
    expect(calls.changes).toBe(0);
    build({ permissions: ['committees:approve'] });
    service.init();
    expect(calls.changes).toBe(1);
  });

  it('My committees is not asked while the Committees module is closed', () => {
    build();
    spyOn(service, 'committeesOpen').and.returnValue(false);
    service.init();
    expect(calls.committees).toBe(0);
    expect(service.myCommittees()).toEqual({ state: 'ready', value: { total: 0, rows: [] } });
  });

  // ACC-281 — lane A's rail and guard read this; it costs no query of its own.
  it('isCommitteeMember is true only once My committees loaded with at least one', () => {
    build({ committees: { total: 0, rows: [] } });
    expect(service.isCommitteeMember()).withContext('before init: loading').toBeFalse();
    service.init();
    expect(service.myCommittees().state).withContext('non-vacuity: it loaded').toBe('ready');
    expect(service.isCommitteeMember()).withContext('total 0').toBeFalse();
    expect(calls.committees).toBe(1);

    build({ committees: 'fail' });
    service.init();
    expect(service.isCommitteeMember()).withContext('failed').toBeFalse();

    build({ committees: { total: 2, rows: [] } });
    service.init();
    expect(service.isCommitteeMember()).toBeTrue();
    expect(calls.committees).toBe(1);
  });

  it('clear() at sign-out forgets everything, and the next init() loads again', () => {
    build({ myTasks: recordList([], 4) });
    service.init();
    service.clear();
    expect(service.myTasks()).toEqual({ state: 'loading' });
    service.init();
    expect(service.myTasks().state).toBe('ready');
    expect(mineReads()).toBe(4);
  });
});
