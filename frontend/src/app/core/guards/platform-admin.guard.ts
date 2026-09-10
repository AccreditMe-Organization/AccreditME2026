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

  // ACC-70 — isPlatformAdmin() reads BOTH halves (isPlatformOrg from /tenant,
  // platform:admin from the permissions call), so both must be real answers
  // before a false result can be treated as a denial.
  //
  // Bouncing without that check was a live bug: one transient 5xx during a
  // hard reload of /platform/* left every signal empty and ejected a genuine
  // platform admin. Deferring to the backend's own PlatformGuard — which
  // re-checks on every request — is the safe response to an unknown answer.
  //
  // Note hasTrustworthyTenantAccess() counts a 403 as trustworthy, so a
  // zero-permission user (403 on /tenant) is still correctly DENIED here
  // rather than falling through. That case was the ACC-70 live-pass
  // regression; only a genuine fault falls open.
  if (
    !navigationAccessService.hasTrustworthyPermissions() ||
    !navigationAccessService.hasTrustworthyTenantAccess()
  ) {
    return true;
  }

  if (navigationAccessService.isPlatformAdmin()) return true;

  // ACC-70 — was '/organization', which could bounce a non-platform-admin
  // onto a screen they hold no permission for.
  return router.parseUrl(LANDING_ROUTE);
};
