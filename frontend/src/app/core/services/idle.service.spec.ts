// ACC-122 — the idle rule, driven by a fake clock.
//
// Every assertion here is about TIME, so none of it may depend on the real
// one: a suite that waits thirty minutes is a suite nobody runs.
//
// fakeAsync's tick() alone is the clock. zone.js's fake-async zone patches
// Date.now() as well as the timer functions, so the service's timestamp
// arithmetic moves with tick() for free. jasmine.clock() was tried here and
// is actively wrong: it replaces setInterval too, fights zone.js for it, and
// the interval then never runs.
import { TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { IDLE_TIMEOUT_MS, IDLE_WARNING_LEAD_MS, IdleService } from './idle.service';
import { AuthService } from './auth.service';

describe('IdleService (ACC-122)', () => {
  let service: IdleService;
  let router: { navigate: jasmine.Spy; url: string };
  let authService: { logout: jasmine.Spy; clearSession: jasmine.Spy };

  function setup(logoutFails = false): void {
    router = { navigate: jasmine.createSpy('navigate'), url: '/committees/abc' };
    authService = {
      logout: jasmine
        .createSpy('logout')
        .and.returnValue(logoutFails ? throwError(() => new Error('offline')) : of({ success: true })),
      clearSession: jasmine.createSpy('clearSession'),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: authService },
      ],
    });
    service = TestBed.inject(IdleService);
    try {
      localStorage.clear();
    } catch {
      /* ignored — the service tolerates this too */
    }
  }

  afterEach(() => {
    service.stop();
  });

  /** Moves the fake clock — timers and Date.now() together. */
  const advance = (ms: number): void => {
    tick(ms);
  };

  const input = (type = 'keydown'): void => {
    document.dispatchEvent(new Event(type));
  };

  it('shows no warning while the user is inside the idle window', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS - 1000);

    expect(service.warningVisible()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
    service.stop();
    discardPeriodicTasks();
  }));

  it('warns 2 minutes before the 30-minute limit', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS);

    expect(service.warningVisible()).toBeTrue();
    expect(service.secondsRemaining()).toBe(IDLE_WARNING_LEAD_MS / 1000);
    service.stop();
    discardPeriodicTasks();
  }));

  it('signs out when the countdown runs out, revoking server-side first', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS);
    tick();

    // POST /auth/logout, not just a local clear: the refresh token is a
    // database row with a 7-day life. Dropping only the client's memory of it
    // would leave the session alive on the server.
    expect(authService.logout).toHaveBeenCalled();
    expect(authService.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/login'],
      jasmine.objectContaining({
        queryParams: jasmine.objectContaining({ returnUrl: '/committees/abc', reason: 'idle' }),
      }),
    );
    discardPeriodicTasks();
  }));

  it('still signs the user out locally when the logout call fails', fakeAsync(() => {
    setup(true);
    service.start();

    advance(IDLE_TIMEOUT_MS);
    tick();

    // Being told "you have been signed out" and left signed in is worse than
    // either outcome on its own.
    expect(authService.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('resets the clock on keyboard input', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS - 1000);
    input('keydown');
    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS - 1000);

    expect(service.warningVisible()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
    service.stop();
    discardPeriodicTasks();
  }));

  it('resets the clock on pointer and touch input too', fakeAsync(() => {
    setup();
    service.start();

    for (const type of ['pointerdown', 'pointermove', 'touchstart']) {
      advance(IDLE_TIMEOUT_MS / 2);
      input(type);
    }

    expect(service.warningVisible()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
    service.stop();
    discardPeriodicTasks();
  }));

  // THE ONE THE TICKET IS ABOUT. The notification bell polls on a timer, and
  // that is why the 15-minute bug LOOKED like an idle timeout. An idle rule
  // that HTTP traffic could extend would be no idle rule at all: a dashboard
  // left open on an empty desk would stay signed in for ever.
  //
  // It holds by construction — the clock is driven by DOM input and nothing
  // else — and this test exists so that stays true. Anyone adding "extend on
  // API call" fails here.
  it('is NOT kept alive by background activity that is not user input', fakeAsync(() => {
    setup();
    service.start();

    // Stand in for the bell's poll: time passing, with non-input events
    // firing, and no keyboard or pointer anywhere.
    for (let elapsed = 0; elapsed < IDLE_TIMEOUT_MS; elapsed += 60_000) {
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('scroll'));
      advance(60_000);
    }
    tick();

    expect(authService.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalled();
    discardPeriodicTasks();
  }));

  it('extend() clears the warning and restarts the clock', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS);
    expect(service.warningVisible()).toBeTrue();

    service.extend();

    expect(service.warningVisible()).toBeFalse();
    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS - 1000);
    expect(router.navigate).not.toHaveBeenCalled();
    service.stop();
    discardPeriodicTasks();
  }));

  it('throttles how often activity is written, without dropping the first one', fakeAsync(() => {
    setup();
    service.start();
    const written = () => localStorage.getItem('am.session.lastActivity');

    const atStart = written();
    advance(1000);
    input();
    // Inside the throttle window: the stored value must not have moved.
    expect(written()).toBe(atStart);

    advance(20_000);
    input();
    expect(written()).not.toBe(atStart);

    service.stop();
    discardPeriodicTasks();
  }));

  // Two tabs are ONE user. If each kept its own clock, the idle tab would
  // sign out someone typing in the other.
  it('adopts a newer last-activity written by another tab', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS);
    expect(service.warningVisible()).toBeTrue();

    // The other tab saw input just now and broadcast it.
    service['lastActivity'].set(Date.now());

    expect(service.warningVisible()).toBeFalse();
    service.stop();
    discardPeriodicTasks();
  }));

  it('never moves the shared clock backwards', fakeAsync(() => {
    setup();
    service.start();
    advance(5000);

    const current = service['lastActivity']();
    // A late message from a tab whose own record is older must be ignored,
    // or one stale tab would shorten everybody's session.
    service['channel']?.onmessage?.(
      new MessageEvent('message', { data: { type: 'activity', at: current - 60_000 } }),
    );

    expect(service['lastActivity']()).toBe(current);
    service.stop();
    discardPeriodicTasks();
  }));

  it('survives localStorage throwing, degrading to this tab only', fakeAsync(() => {
    setup();
    const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem');
    spyOn(Storage.prototype, 'setItem').and.throwError('blocked');
    spyOn(Storage.prototype, 'getItem').and.throwError('blocked');

    // Private window, or site data blocked (ACC-96's rule). A stricter
    // session is acceptable; an exception thrown into the app is not.
    expect(() => {
      service.start();
      advance(20_000);
      input();
    }).not.toThrow();

    service.stop();
    discardPeriodicTasks();
    if (setItem) Object.defineProperty(Storage.prototype, 'setItem', setItem);
  }));

  it('signs out only once even if the timer fires again', fakeAsync(() => {
    setup();
    service.start();

    advance(IDLE_TIMEOUT_MS);
    tick();
    advance(5000);
    tick();

    expect(authService.logout).toHaveBeenCalledTimes(1);
    discardPeriodicTasks();
  }));

  // The dialog's static line says "You'll be signed out in 2 minutes", and
  // nothing in the code derives that "2" from the constant — they agree by
  // convention. Changing the lead without changing the string would leave the
  // dialog quietly lying, which no other test would notice.
  it('keeps the warning lead at the 2 minutes the dialog text promises', () => {
    expect(IDLE_WARNING_LEAD_MS).toBe(2 * 60 * 1000);
    expect(IDLE_TIMEOUT_MS).toBe(30 * 60 * 1000);
  });
});
