// Real auth interceptor (Step 9) — replaces the dev-only Bearer-token
// attachment entirely. No token is attached manually anymore: the httpOnly
// access_token/refresh_token cookies are sent/received by the browser
// automatically once withCredentials is set, which this interceptor does
// for every request. On any 401 response, clears the local currentUser
// state and redirects to /login — this, not a synchronous local check, is
// the real source of truth for "session expired" (see AuthService).
//
// ACC-24 exception — GET .../auth/me is excluded from the redirect. This is
// the one call site (AuthService.restoreSession(), fired unconditionally by
// the APP_INITIALIZER on every app boot — see app.config.ts's
// initializeSession()) where a 401 is an expected "not logged in" outcome,
// not a signal that a real session died mid-use — restoreSession() already
// handles it gracefully via its own catchError. Without this exclusion, the
// interceptor's redirect fired first (interceptors run in front of the
// caller's own error handling) and hijacked the destination on EVERY
// unauthenticated visit to EVERY route outside the authGuard-protected shell
// tree — including /accept-invitation and /forgot-password, which are
// explicitly meant to be reachable pre-auth. Every other 401 (a genuinely
// expired/invalid session hit on a protected endpoint during actual app
// usage) must still redirect exactly as before.

import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const withCredentialsReq = req.clone({ withCredentials: true });

  return next(withCredentialsReq).pipe(
    catchError((error: unknown) => {
      const isSessionRestoreCheck = req.url.endsWith('/auth/me');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isSessionRestoreCheck) {
        authService.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
