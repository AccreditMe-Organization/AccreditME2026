// Real auth interceptor (Step 9) — replaces the dev-only Bearer-token
// attachment entirely. No token is attached manually anymore: the httpOnly
// access_token/refresh_token cookies are sent/received by the browser
// automatically once withCredentials is set, which this interceptor does
// for every request. On any 401 response, clears the local currentUser
// state and redirects to /login — this, not a synchronous local check, is
// the real source of truth for "session expired" (see AuthService).

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
      if (error instanceof HttpErrorResponse && error.status === 401) {
        authService.clearSession();
        void router.navigate(['/login']);
      }
      return throwError(() => error);
    }),
  );
};
