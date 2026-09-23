// ACC-122 — the guard carries returnUrl.
//
// Worth a spec of its own because the failure is invisible: without it the
// user still reaches /login, still signs in, and simply lands somewhere else.
// Nothing errors, so only a test that asserts the destination notices.
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, provideRouter } from '@angular/router';
import { authGuard } from './auth.guard';
import { AuthService } from '../services/auth.service';

describe('authGuard (ACC-122 — returnUrl)', () => {
  let router: Router;

  function setup(authenticated: boolean): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { isAuthenticated: () => authenticated } },
      ],
    });
    router = TestBed.inject(Router);
  }

  const run = (url: string) =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  it('lets a signed-in user through', () => {
    setup(true);
    expect(run('/committees')).toBe(true);
  });

  it('sends a signed-out user to /login carrying where they were going', () => {
    setup(false);
    expect(run('/committees/abc')).toEqual(
      router.parseUrl('/login?returnUrl=%2Fcommittees%2Fabc'),
    );
  });

  it('encodes a query string in the destination rather than losing it', () => {
    setup(false);
    // Unencoded, the '?' would start a SECOND query parameter and the filter
    // would be dropped — the user would return to an unfiltered list.
    const result = run('/users?users.scope=ACTIVE');
    expect(result).toEqual(router.parseUrl('/login?returnUrl=%2Fusers%3Fusers.scope%3DACTIVE'));
  });
});
