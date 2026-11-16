// ACC-126 — the session's 12-hour limit on screen, driven by a fake clock
// (fakeAsync's tick() moves Date.now() as well as the timers; see
// idle.service.spec.ts for why jasmine.clock() is not used here).
import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { IdleService } from './idle.service';
import { SESSION_LIMIT_WARNING_LEAD_MS, SessionLimitService } from './session-limit.service';
import { SessionLimitState, isSessionTimeLimitRefusal } from './session-limit-state';

const MINUTE = 60 * 1000;

describe('SessionLimitService (ACC-126)', () => {
  let service: SessionLimitService;
  let state: SessionLimitState;
  let idle: { signOut: jasmine.Spy };

  /** Built inside each fakeAsync spec, so Date.now() is the fake clock's. */
  function setup(endsInMs: number | null): void {
    idle = { signOut: jasmine.createSpy('signOut').and.resolveTo(undefined) };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: IdleService, useValue: idle }] });
    state = TestBed.inject(SessionLimitState);
    service = TestBed.inject(SessionLimitService);
    state.setEndsAt(endsInMs === null ? null : new Date(Date.now() + endsInMs).toISOString());
    service.start();
  }

  afterEach(() => service?.stop());

  it('shows no warning more than 10 minutes before the limit', fakeAsync(() => {
    setup(30 * MINUTE);
    tick(19 * MINUTE);
    expect(service.warningVisible()).toBeFalse();
    discardPeriodicTasks();
  }));

  it('shows the warning from 10 minutes before the limit — and not a second earlier', fakeAsync(() => {
    setup(30 * MINUTE);
    tick(20 * MINUTE - 2000);
    expect(service.warningVisible()).withContext('10:02 before').toBeFalse();
    tick(2000);
    expect(service.warningVisible()).withContext('10:00 before').toBeTrue();
    expect(idle.signOut).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('signs out at the limit with reason "limit", once', fakeAsync(() => {
    setup(30 * MINUTE);
    tick(30 * MINUTE - 1000);
    expect(idle.signOut).not.toHaveBeenCalled();
    tick(1000);
    expect(idle.signOut).toHaveBeenCalledOnceWith('limit');
    tick(5000);
    expect(idle.signOut).toHaveBeenCalledTimes(1);
    expect(service.warningVisible()).toBeFalse();
    discardPeriodicTasks();
  }));

  it('"Continue working" hides the warning for good, and the sign-out still comes at the limit', fakeAsync(() => {
    setup(5 * MINUTE);
    tick(1000);
    expect(service.warningVisible()).withContext('non-vacuity: shown first').toBeTrue();

    service.dismiss();
    tick(1000);
    expect(service.warningVisible()).toBeFalse();
    tick(3 * MINUTE);
    expect(service.warningVisible()).withContext('not shown again').toBeFalse();

    tick(2 * MINUTE);
    expect(idle.signOut).toHaveBeenCalledOnceWith('limit');
    discardPeriodicTasks();
  }));

  it('"Sign out now" is a sign-out the person chose', fakeAsync(() => {
    setup(5 * MINUTE);
    service.signOutNow();
    expect(idle.signOut).toHaveBeenCalledOnceWith('user');
    discardPeriodicTasks();
  }));

  it('does nothing while the deadline is unknown', fakeAsync(() => {
    setup(null);
    tick(25 * MINUTE);
    expect(service.warningVisible()).toBeFalse();
    expect(idle.signOut).not.toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('warns 10 minutes ahead (pinned by reading the constant)', () => {
    expect(SESSION_LIMIT_WARNING_LEAD_MS).toBe(10 * MINUTE);
  });
});

describe('SessionLimitState (ACC-126)', () => {
  let state: SessionLimitState;
  const refusal = (code: string, status = 401) =>
    new HttpErrorResponse({
      status,
      error: { statusCode: status, code, message: 'x', error: 'Unauthorized' },
    });

  beforeEach(() => {
    TestBed.resetTestingModule();
    state = TestBed.inject(SessionLimitState);
  });

  it('reads the deadline, and treats a missing or unreadable one as unknown', () => {
    state.setEndsAt('2026-11-13T18:00:00.000Z');
    expect(state.endsAt()).toBe(Date.parse('2026-11-13T18:00:00.000Z'));
    state.setEndsAt(null);
    expect(state.endsAt()).toBeNull();
    state.setEndsAt('not a date');
    expect(state.endsAt()).toBeNull();
  });

  it('notes only a 401 SESSION_TIME_LIMIT refusal', () => {
    expect(isSessionTimeLimitRefusal(refusal('SESSION_TIME_LIMIT'))).toBeTrue();
    expect(isSessionTimeLimitRefusal(refusal('SESSION_TIME_LIMIT', 403))).toBeFalse();
    expect(isSessionTimeLimitRefusal(refusal('ORGANIZATION_UNAVAILABLE'))).toBeFalse();
    expect(state.note(refusal('ORGANIZATION_UNAVAILABLE'))).toBeFalse();
    expect(state.signedOutForLimit()).toBeFalse();

    state.setEndsAt('2026-11-13T18:00:00.000Z');
    expect(state.note(refusal('SESSION_TIME_LIMIT'))).toBeTrue();
    expect(state.signedOutForLimit()).toBeTrue();
    expect(state.endsAt()).withContext('the session is over').toBeNull();
  });

  it('keeps the note through sign-out, and drops it at the next sign-in', () => {
    state.note(refusal('SESSION_TIME_LIMIT'));
    state.endSession();
    expect(state.signedOutForLimit()).toBeTrue();
    state.clearNote();
    expect(state.signedOutForLimit()).toBeFalse();
  });
});
