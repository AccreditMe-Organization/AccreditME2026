import { TestBed } from '@angular/core/testing';
import { MyWorkEvents } from '../../core/my-work/my-work-events';
import { REQUEST } from '../committees/change-requests/change-request.testing';
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

  // ACC-283 PR 2 — a unit head, an acting cover or a deciding seat decides
  // without committees:approve, so the server, not the key, says who decides.
  it('change requests are asked of everyone while the Committees module is open, holder of committees:approve or not', () => {
    build({ permissions: [] });
    service.init();
    expect(calls.changes).toBe(1);
    build({ permissions: ['committees:approve'] });
    service.init();
    expect(calls.changes).toBe(1);
  });

  it('a change request returned for a head without committees:approve counts in awaiting', () => {
    const request = REQUEST();
    build({ permissions: [], changes: [request] });
    service.init();
    const awaiting = service.awaiting();
    expect(awaiting.state).toBe('ready');
    expect(awaiting.state === 'ready' ? awaiting.value.changes : []).toEqual([request]);
  });

  it('neither My committees nor the change requests are asked while the Committees module is closed', () => {
    build({ permissions: ['committees:approve'] });
    spyOn(service, 'committeesOpen').and.returnValue(false);
    service.init();
    expect(calls.committees).toBe(0);
    expect(calls.changes).toBe(0);
    expect(service.myCommittees()).toEqual({ state: 'ready', value: { total: 0, rows: [], mayBrowseCommittees: false } });
    expect(service.awaiting()).toEqual({ state: 'ready', value: { stages: jasmine.anything() as never, changes: [] } });
    // ACC-283 — and so a closed module gives the rail and the guard a known "no".
    expect(service.mayBrowseCommittees()).toBeFalse();
  });

  // ACC-281 — the fix Ahmad asked for: a platform admin has no tenant work.
  it('init() asks nothing for a platform admin', () => {
    build({ platformAdmin: true });
    service.init();
    expect(mineReads()).toBe(0);
    expect(calls.awaitingMe).toBe(0);
    expect(calls.committees).toBe(0);
    expect(service.myTasks()).toEqual({ state: 'loading' });
  });

  // ACC-281, ACC-283 PR 2a — lane A's rail and guard read this; it costs no
  // query of its own. It is the server's flag, never My committees' count.
  it('mayBrowseCommittees is the server\'s flag, true only once My committees loaded with it', () => {
    build({ committees: { total: 0, rows: [], mayBrowseCommittees: false } });
    expect(service.mayBrowseCommittees()).withContext('before init: loading').toBeFalse();
    service.init();
    expect(service.myCommittees().state).withContext('non-vacuity: it loaded').toBe('ready');
    expect(service.mayBrowseCommittees()).withContext('flag false').toBeFalse();
    expect(calls.committees).toBe(1);

    build({ committees: 'fail' });
    service.init();
    expect(service.mayBrowseCommittees()).withContext('failed').toBeFalse();

    build({ committees: { total: 2, rows: [], mayBrowseCommittees: true } });
    service.init();
    expect(service.mayBrowseCommittees()).toBeTrue();
    expect(calls.committees).toBe(1);
  });

  it('a head on no committee (total 0, flag true) may browse; a count with the flag false may not', () => {
    build({ committees: { total: 0, rows: [], mayBrowseCommittees: true } });
    service.init();
    expect(service.mayBrowseCommittees()).withContext('head: total 0, flag true').toBeTrue();

    build({ committees: { total: 2, rows: [], mayBrowseCommittees: false } });
    service.init();
    expect(service.mayBrowseCommittees()).withContext('total 2, flag false').toBeFalse();
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
