// ACC-24 — regression coverage for both sides of that fix: the interceptor
// must NOT redirect on the one call site (GET .../auth/me) where a 401 is
// the expected "not logged in" outcome already handled by
// AuthService.restoreSession() itself, but MUST still end the session on a
// 401 from any other (protected) endpoint — proving the exclusion is narrow,
// not a general loosening of the interceptor's real purpose.
//
// ACC-122 — those cases still hold, but a 401 on an ordinary request now
// means "renew once and retry" rather than "session over". Every ACC-24 case
// below is therefore written to show WHERE the renewal sits, and the session
// only ends once the renewal itself has failed.
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from '../services/auth.service';

const REFRESH_URL = `${environment.apiUrl}/auth/refresh`;
const unauthorized = { status: 401, statusText: 'Unauthorized' };

describe('authInterceptor (ACC-24, ACC-122)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: { navigate: jasmine.Spy; url: string };
  let authService: { clearSession: jasmine.Spy };

  beforeEach(() => {
    router = { navigate: jasmine.createSpy('navigate'), url: '/committees/abc' };
    authService = { clearSession: jasmine.createSpy('clearSession') };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: authService },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const expectSignedOut = () => {
    expect(authService.clearSession).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(
      ['/login'],
      jasmine.objectContaining({ queryParams: { returnUrl: '/committees/abc' } }),
    );
  };

  // ── ACC-24, unchanged in substance ────────────────────────────────────────

  it('does NOT redirect, and does not renew, on a 401 from GET .../auth/me', (done) => {
    http.get(`${environment.apiUrl}/auth/me`).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        // The start-up renewal belongs to restoreSession(), which can retry
        // /auth/me and read the answer. Renewing here would fire a second,
        // pointless refresh on every anonymous page load.
        httpMock.expectNone(REFRESH_URL);
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/auth/me`).flush({}, unauthorized);
  });

  it('does not redirect on a non-401 error from GET .../auth/me', (done) => {
    http.get(`${environment.apiUrl}/auth/me`).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/auth/me`)
      .flush({}, { status: 500, statusText: 'Internal Server Error' });
  });

  it('treats a URL that merely CONTAINS "me" as an ordinary request', (done) => {
    // Guards against a naive substring match (e.g. .includes('me')) that
    // would over-exclude — only the exact /auth/me suffix is special.
    http.get(`${environment.apiUrl}/committees/me-fake-id`).subscribe({
      error: () => {
        expectSignedOut();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/committees/me-fake-id`).flush({}, unauthorized);
    httpMock.expectOne(REFRESH_URL).flush({}, unauthorized);
  });

  // ── ACC-122: renewal ──────────────────────────────────────────────────────

  it('renews once and retries the original request, which then succeeds', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      next: (body) => {
        expect(body).toEqual({ data: ['ok'] });
        // The whole point: the caller never saw the 401 and was never
        // signed out. This is the mid-form Save that used to lose work.
        expect(authService.clearSession).not.toHaveBeenCalled();
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/users`).flush({}, unauthorized);
    httpMock.expectOne(REFRESH_URL).flush({ success: true });
    httpMock.expectOne(`${environment.apiUrl}/users`).flush({ data: ['ok'] });
  });

  it('signs the user out when the renewal itself is refused', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        expectSignedOut();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/users`).flush({}, unauthorized);
    // Refresh token expired, revoked, user deactivated, or ACC-122's
    // tokenVersion check refusing a forced-out session.
    httpMock.expectOne(REFRESH_URL).flush({}, unauthorized);
  });

  it('does not loop: a 401 on the RETRY ends the session instead of renewing again', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        expectSignedOut();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/users`).flush({}, unauthorized);
    httpMock.expectOne(REFRESH_URL).flush({ success: true });
    httpMock.expectOne(`${environment.apiUrl}/users`).flush({}, unauthorized);
    // If the retry's 401 renewed again, verify() would find a second refresh.
    httpMock.expectNone(REFRESH_URL);
  });

  // THE ONE THAT MATTERS MOST, and the reason SessionRenewalService exists.
  //
  // /auth/refresh ROTATES: it revokes the token it was handed. Two refreshes
  // means the second presents a revoked token, gets a 401, and signs the user
  // out — the failure mode is "logged out at random when two requests happen
  // to expire together", which is most page loads.
  it('makes exactly ONE refresh call for three concurrent 401s, and retries all three', (done) => {
    const seen: string[] = [];
    const urls = ['/users', '/roles', '/committees'];

    for (const path of urls) {
      http.get(`${environment.apiUrl}${path}`).subscribe({
        next: () => {
          seen.push(path);
          if (seen.length === urls.length) {
            expect(seen.sort()).toEqual([...urls].sort());
            expect(authService.clearSession).not.toHaveBeenCalled();
            done();
          }
        },
      });
    }

    for (const path of urls) {
      httpMock.expectOne(`${environment.apiUrl}${path}`).flush({}, unauthorized);
    }

    // expectOne throws if there were two — which is the assertion.
    httpMock.expectOne(REFRESH_URL).flush({ success: true });

    for (const path of urls) {
      httpMock.expectOne(`${environment.apiUrl}${path}`).flush({ ok: true });
    }
  });

  // ── ACC-122: the endpoints that must never renew ──────────────────────────

  // ── THE REGRESSION. Pinned as BEHAVIOUR: "does not navigate", not "takes
  // branch X". ─────────────────────────────────────────────────────────────
  //
  // A 401 on /auth/refresh used to sign the user out from right here. That
  // looked harmless and reintroduced ACC-24: restoreSession()'s renewal is an
  // ordinary HTTP call, so it lands in this interceptor, and the interceptor
  // redirected on its behalf — bouncing a signed-out visitor off
  // /forgot-password to /login?returnUrl=%2F.
  //
  // The caller owns this failure. Whoever asked for the refresh already knows
  // what to do about it.
  it('does NOT navigate on a 401 from /auth/refresh — the caller decides', (done) => {
    http.post(REFRESH_URL, {}).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        expect(authService.clearSession).not.toHaveBeenCalled();
        done();
      },
    });

    // Exactly one request total: the one we made. No recursion.
    httpMock.expectOne(REFRESH_URL).flush({}, unauthorized);
  });

  it('does NOT navigate on a 401 from /auth/login — the form shows the error', (done) => {
    http.post(`${environment.apiUrl}/auth/login`, {}).subscribe({
      error: () => {
        // Navigating here would also wipe query parameters the login page is
        // showing — reason=idle among them.
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/auth/login`).flush({}, unauthorized);
  });

  it('does NOT navigate on a 401 from /auth/logout — the caller already is', (done) => {
    http.post(`${environment.apiUrl}/auth/logout`, {}).subscribe({
      error: () => {
        // IdleService navigates with reason and returnUrl; a redirect from
        // here would race it and overwrite both with something worse.
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/auth/logout`).flush({}, unauthorized);
  });

  it('still signs out exactly ONCE when an ordinary request cannot be renewed', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        // Before the fix both the inner branch and the outer catchError
        // navigated, and the inner one used the wrong url.
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expectSignedOut();
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/users`).flush({}, unauthorized);
    httpMock.expectOne(REFRESH_URL).flush({}, unauthorized);
  });

  it('ignores the query string when deciding, so /auth/me?x=1 is still /auth/me', (done) => {
    http.get(`${environment.apiUrl}/auth/me?cacheBust=1`).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        httpMock.expectNone(REFRESH_URL);
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/auth/me?cacheBust=1`).flush({}, unauthorized);
  });

  it('leaves non-401 errors alone', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        httpMock.expectNone(REFRESH_URL);
        expect(authService.clearSession).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/users`)
      .flush({}, { status: 403, statusText: 'Forbidden' });
  });
});
