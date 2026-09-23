// Real auth interceptor (Step 9) — replaces the dev-only Bearer-token
// attachment entirely. No token is attached manually anymore: the httpOnly
// access_token/refresh_token cookies are sent/received by the browser
// automatically once withCredentials is set, which this interceptor does
// for every request.
//
// ── ACC-122: a 401 is no longer the end of the session ──────────────────────
//
// It used to be. Any 401 (except /auth/me) called clearSession() and
// redirected to /login, which meant the 15-minute access token WAS the session
// length: the first request after fifteen minutes threw the user out, mid-form,
// with their work lost. The 7-day refresh token documented in CLAUDE.md did
// nothing, because nothing ever called POST /auth/refresh.
//
// Now a 401 on an ordinary request means "try renewing once, then retry".
// Only if the renewal itself fails is the session genuinely over.
//
// WORTH KNOWING, because it rules out a tempting shortcut: after fifteen
// minutes the request does not arrive with an EXPIRED token — it arrives with
// no token at all. The access_token cookie carries `maxAge: 15 minutes`, so
// the browser has already deleted it. Anything that tried to read the expired
// token's claims (to decide whether renewal is worth attempting, say) would
// find nothing. The server is the only authority on whether a session lives.
//
// ── The auth endpoints: never renewed, and NEVER NAVIGATED FROM ─────────────
//
//   /auth/refresh  a 401 here IS the terminal answer; retrying it recurses.
//   /auth/login    a 401 means wrong credentials, not an expired session.
//   /auth/logout   ending a session; renewing it is incoherent.
//   /auth/me       start-up only — see below.
//
// THE "NAVIGATE NOWHERE" HALF IS A REGRESSION FIX, and the shape of it is
// worth remembering. Having that branch sign the user out reintroduced ACC-24
// by a route nobody thought to look down: restoreSession()'s renewal is an
// ORDINARY HTTP CALL, so it re-enters this interceptor, matched /auth/refresh,
// and the interceptor redirected on restoreSession()'s behalf. A signed-out
// visitor loading /forgot-password was bounced to /login?returnUrl=%2F.
//
// The comment promising that restoreSession() never redirects described the
// FUNCTION, not the BEHAVIOUR — a function cannot promise something its own
// dependencies can undo.
//
// It cost two more things quietly. A deep URL typed while signed out had
// authGuard's returnUrl overwritten with '/' by the boot refresh, so the
// ACC-122 returnUrl work was defeated on every cold load. And reloading
// /login?returnUrl=…&reason=idle dropped both parameters, so the inactivity
// notice disappeared on refresh.
//
// The ordinary path never needed it: a failed renewal already reaches the
// outer catchError below, which calls endSession() with the page the user is
// actually on. Navigating here as well was a second, worse-informed redirect
// racing the correct one.
//
// ── /auth/me and ACC-24, which must not be reintroduced ─────────────────────
//
// restoreSession() fires unconditionally from provideAppInitializer on EVERY
// app boot, including on /accept-invitation and /forgot-password, which are
// meant to be reachable while signed out. A 401 there means "not signed in",
// not "a live session just died". ACC-24 fixed a real bug where this
// interceptor's redirect hijacked those pages; that exclusion stays exactly as
// it was — no redirect, ever, for /auth/me.
//
// The renewal attempt for the start-up case lives in AuthService.restoreSession()
// rather than here, so that it can retry /auth/me and interpret the result. It
// is what lets a reload more than fifteen minutes after signing in keep you
// signed in, instead of bouncing you to /login with a perfectly valid refresh
// token in the jar.

import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { SessionRenewalService } from '../services/session-renewal.service';

/**
 * Auth endpoints whose own 401 must never be answered with a renewal.
 *
 * Matched on the path, so a query string or a different host cannot slip past.
 */
const NO_RENEWAL_PATHS = ['/auth/refresh', '/auth/login', '/auth/logout', '/auth/me'] as const;

const isNoRenewalRequest = (req: HttpRequest<unknown>): boolean =>
  NO_RENEWAL_PATHS.some((path) => {
    const url = req.url.split('?')[0] ?? '';
    return url.endsWith(path);
  });

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const renewalService = inject(SessionRenewalService);
  const router = inject(Router);

  const withCredentialsReq = req.clone({ withCredentials: true });

  /** The pre-ACC-122 behaviour: the session is over. */
  const endSession = (error: unknown) => {
    authService.clearSession();
    void router.navigate(['/login'], {
      // ACC-122 — so signing in again returns the user to the page they were
      // on rather than dropping them on Home. Never set for /auth/me, which
      // does not reach this branch at all.
      queryParams: { returnUrl: router.url },
    });
    return throwError(() => error);
  };

  return next(withCredentialsReq).pipe(
    catchError((error: unknown) => {
      const is401 = error instanceof HttpErrorResponse && error.status === 401;
      if (!is401) return throwError(() => error);

      // Rethrow — and navigate NOWHERE. The caller decides what the failure
      // meant, because only the caller knows:
      //   /auth/me      restoreSession() → "not signed in", stays put (ACC-24)
      //   /auth/refresh the ordinary path's outer catchError below, which
      //                 navigates with the RIGHT url; or restoreSession()
      //                 and IdleService, which handle their own
      //   /auth/login   the form shows "wrong credentials"
      //   /auth/logout  the caller is already navigating
      if (isNoRenewalRequest(req)) return throwError(() => error);

      return renewalService.renew().pipe(
        // Renewal worked: replay the original request exactly once. A second
        // 401 on the retry is final — no loop, no second renewal.
        switchMap(() =>
          next(withCredentialsReq).pipe(
            catchError((retryError: unknown) =>
              retryError instanceof HttpErrorResponse && retryError.status === 401
                ? endSession(retryError)
                : throwError(() => retryError),
            ),
          ),
        ),
        // Renewal failed — refresh token expired, revoked, the user
        // deactivated, or a forced logout (ACC-122's tokenVersion check).
        // This is the one place a session genuinely ends.
        catchError(() => endSession(error)),
      );
    }),
  );
};
