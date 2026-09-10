// platformAdminGuard — mirrors PlatformGuard's own two-part check server-side
// (NavigationAccessService.isPlatformAdmin() reads both isPlatformOrg and
// platform:admin, never permission alone). Defense in depth only — the
// backend's own PlatformGuard is the real enforcement; this just avoids a
// non-platform-admin seeing a page full of 403 errors trickle in.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { NavigationAccessService } from '../services/navigation-access.service';
import { LANDING_ROUTE } from '../navigation/landing-route';

export const platformAdminGuard: CanActivateFn = () => {
  const navigationAccessService = inject(NavigationAccessService);
  const router = inject(Router);

  // ACC-70 — a failed loadAccess() leaves every signal empty while still
  // resolving successfully, so isPlatformAdmin() returns false for a reason
  // that has nothing to do with this user. Bouncing on that was a live bug:
  // one transient 5xx during a hard reload of /platform/* ejected a genuine
  // platform admin. Defer to the backend's own PlatformGuard instead, which
  // re-checks the real answer on every request.
  if (!navigationAccessService.hasTrustworthyPermissions()) return true;

  if (navigationAccessService.isPlatformAdmin()) return true;

  // ACC-70 — was '/organization', which could bounce a non-platform-admin
  // onto a screen they hold no permission for.
  return router.parseUrl(LANDING_ROUTE);
};
