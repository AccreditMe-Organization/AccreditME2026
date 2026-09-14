// ownProfileGuard — ACC-79. The profile route's guard: your OWN profile is
// always reachable; anyone else's needs users:view, exactly as before.
//
// Why this exists. Since ACC-70 the whole `users` route carried
// permissionGuard, mapped to users:view, and `users/:id` inherited it. A user
// without users:view was therefore bounced from their own profile — the "My
// Profile" item in the user menu silently landed them on Home, and they could
// set neither their language nor out-of-office. The backend never had that
// restriction: GET /users/:id has no @Permissions() on purpose (ACC-43), and
// UserService.getByIdForViewer() lets a user read their own record. Only the
// frontend guard disagreed.
//
// Same standing as permissionGuard: UX, not enforcement. The backend decides
// what a caller may read or write regardless of what this lets through.

import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { permissionGuard } from './permission.guard';

export const ownProfileGuard: CanActivateFn = (route, state) => {
  const currentUserId = inject(AuthService).currentUser()?.id;
  const profileId = route.paramMap.get('id');

  if (currentUserId && profileId === currentUserId) return true;

  // Someone else's profile: the ordinary users:view rule, including its
  // fail-open handling of an unknown permission load.
  return permissionGuard(route, state);
};
