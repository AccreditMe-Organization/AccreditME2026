// The first route guard in this codebase (Step 9) — before this, literally
// nothing stopped an unauthenticated user from navigating to any route in
// the Angular router (only the backend's own API calls would 401).

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) return true;

  return router.parseUrl('/login');
};
