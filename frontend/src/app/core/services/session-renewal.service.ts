// ACC-122 — one refresh at a time, shared by everyone who needs it.
//
// ## Why this is a service and not a variable in the interceptor
//
// `authInterceptor` is an `HttpInterceptorFn` — a plain function, re-entered
// per request with no instance of its own. The "is a refresh already running"
// answer has to outlive a single call, so it lives here, in the one place
// Angular will give every caller the same instance of.
//
// ## Why sharing is not an optimisation
//
// It is a correctness requirement, and getting it wrong signs people out.
// `POST /auth/refresh` ROTATES: it revokes the token it was given and issues a
// new one (`auth.service.ts`, `refreshToken.update({ revokedAt })`). So if two
// expired requests each fired their own refresh, the first would succeed and
// revoke the cookie, and the second would arrive presenting a token that is
// now revoked — `Invalid or expired refresh token`, 401, session over. The
// user would be signed out BY the machinery meant to keep them signed in, and
// only when they happened to have two requests in flight at once, which is
// most page loads.
//
// `shareReplay` with `refCount: false` is deliberate: the result must stay
// available to a caller that subscribes after the refresh has already
// completed, which is exactly what a slow second 401 does. `refCount: true`
// would tear the shared subscription down the moment the first caller
// unsubscribed and let a later one fire a second HTTP call.
//
// ## What this does NOT do
//
// It does not decide WHICH requests may renew — the interceptor owns that —
// and it does not sign anyone out. It reports failure and lets the caller act.

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, finalize, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SessionRenewalService {
  private readonly http = inject(HttpClient);
  private readonly refreshUrl = `${environment.apiUrl}/auth/refresh`;

  /** The refresh currently in flight, or null when none is. */
  private inFlight: Observable<unknown> | null = null;

  /**
   * Renews the session, or joins the renewal already running.
   *
   * Every concurrent caller gets the SAME observable and therefore the same
   * single HTTP request. Completion — success or failure — clears the slot, so
   * a later 401 starts a fresh attempt rather than replaying a stale verdict.
   */
  renew(): Observable<unknown> {
    if (!this.inFlight) {
      this.inFlight = this.http.post(this.refreshUrl, {}).pipe(
        // finalize, not tap: the slot must clear on error and on unsubscribe
        // too, or one failed refresh would wedge renewal for the whole
        // session and every later 401 would replay that failure.
        finalize(() => {
          this.inFlight = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    }
    return this.inFlight;
  }

  /** True while a renewal is in flight. Exposed for tests, not for callers. */
  get isRenewing(): boolean {
    return this.inFlight !== null;
  }
}
