// The first route guard in this codebase (Step 9) — before this, literally
// nothing stopped an unauthenticated user from navigating to any route in
// the Angular router (only the backend's own API calls would 401).

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) return true;

  // ACC-122 — carry where they were trying to go, so signing in returns them
  // there instead of dropping them on Home.
  //
  // This is not only for the person who typed a URL. When a 401 arrives DURING
  // a navigation, the interceptor clears the session and this guard then runs
  // for the route being entered — so a bare '/login' here would overwrite the
  // returnUrl the interceptor had just set, and the redirect would silently
  // lose the destination in exactly the case it matters most.
  return router.parseUrl(`/login?returnUrl=${encodeURIComponent(state.url)}`);
};
