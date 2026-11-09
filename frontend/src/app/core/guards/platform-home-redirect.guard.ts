// platformHomeRedirectGuard — ACC-120. /home is the TENANT landing, and a
// platform admin has no tenant work: its counts never load for them. Login
// already sends a platform admin to the platform, but /home is also reached by
// the bare '/' redirect, a bookmark, and permissionGuard's fallback to
// LANDING_ROUTE. This sends a platform admin from there to PLATFORM_LANDING.
//
// Everyone else passes, with or without permissions: /home still carries no
// permissionGuard (ACC-70). An impersonation session is a TENANT session —
// isPlatformAdmin() reads the tenant's isPlatformOrg, false — so it lands on
// /home as the impersonated user would.
//
// Like platformAdminGuard, an answer is acted on only when both halves of
// isPlatformAdmin() are trustworthy; an unknown answer falls open to /home,
// which is the safe direction here (a platform admin sees an empty Home, never
// a tenant user sent to the platform).

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { NavigationAccessService } from '../services/navigation-access.service';
import { PLATFORM_LANDING } from '../navigation/landing-route';

export const platformHomeRedirectGuard: CanActivateFn = () => {
  const navigationAccessService = inject(NavigationAccessService);
  const router = inject(Router);

  if (
    !navigationAccessService.hasTrustworthyPermissions() ||
    !navigationAccessService.hasTrustworthyTenantAccess()
  ) {
    return true;
  }

  return navigationAccessService.isPlatformAdmin() ? router.parseUrl(PLATFORM_LANDING) : true;
};
