// adminConsoleGuard — ACC-292. /admin, the Administration console, opens for
// exactly the people the rail shows its Administration item to: admin:access
// AND at least one Administration item they may see (canOpenAdminConsole(),
// nav-items.ts). One rule for the link and the route, so neither can be shown
// without the other.
//
// Defence in depth only, like permissionGuard: the console requests nothing a
// page does not, and every card's page keeps its own guard.

import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { NavigationAccessService } from '../services/navigation-access.service';
import { injectNavAccess } from '../navigation/nav-access';
import { canOpenAdminConsole } from '../navigation/nav-items';
import { LANDING_ROUTE } from '../navigation/landing-route';

export const adminConsoleGuard: CanActivateFn = () => {
  const access = inject(NavigationAccessService);
  const router = inject(Router);
  const navAccess = injectNavAccess();

  // ACC-70's rule, as permissionGuard: an unknown answer is not a negative one.
  // A failed loadAccess() leaves permissions empty; let the page load and the
  // backend answer for each card's page.
  if (!access.hasTrustworthyPermissions()) return true;

  return canOpenAdminConsole(navAccess) ? true : router.parseUrl(LANDING_ROUTE);
};
