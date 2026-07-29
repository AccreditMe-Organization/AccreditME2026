// platformAdminGuard — mirrors PlatformGuard's own two-part check server-side
// (NavigationAccessService.isPlatformAdmin() reads both isPlatformOrg and
// platform:admin, never permission alone). Defense in depth only — the
// backend's own PlatformGuard is the real enforcement; this just avoids a
// non-platform-admin seeing a page full of 403 errors trickle in.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { NavigationAccessService } from '../services/navigation-access.service';

export const platformAdminGuard: CanActivateFn = () => {
  const navigationAccessService = inject(NavigationAccessService);
  const router = inject(Router);

  if (navigationAccessService.isPlatformAdmin()) return true;

  return router.parseUrl('/organization');
};
