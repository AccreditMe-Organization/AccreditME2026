// permissionGuard — ACC-70. Route-level counterpart to the permission
// filtering the sidebar already does, closing the gap where a hidden nav link
// still left the URL reachable by anyone.
//
// Same shape and same standing as platformAdminGuard: DEFENCE IN DEPTH ONLY.
// The backend's PermissionGuard re-checks every request regardless, and is
// the real enforcement boundary. This exists so a user who cannot use a
// screen does not land on one that renders a wall of failed requests — which
// is exactly what ACC-62's persona testing hit, and what platformAdminGuard's
// own comment describes as "a page full of 403 errors trickle in".
//
// The permission comes from ROUTE_PERMISSIONS, derived from the sidebar's own
// nav lists. It is deliberately NOT re-declared here — see nav-items.ts for
// why diverging from that list defeats the point of having it.

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { NavigationAccessService } from '../services/navigation-access.service';
import { ROUTE_PERMISSIONS } from '../navigation/nav-items';
import { LANDING_ROUTE } from '../navigation/landing-route';

export const permissionGuard: CanActivateFn = (route) => {
  const navigationAccessService = inject(NavigationAccessService);
  const router = inject(Router);

  // The path this guard is attached to, as declared in app.routes.ts. Read
  // from the route config rather than the resolved URL so a deep child URL
  // (/committees/:id) is judged by its guarded parent's permission, not by a
  // path that has no entry in the map.
  const path = route.routeConfig?.path ?? '';
  const required = ROUTE_PERMISSIONS.get(path);

  // No entry means this route was never meant to be permission-gated (the
  // landing page, a user's own profile). Absence is not denial — a guard that
  // denied unmapped routes would silently break every route added later
  // without a nav entry.
  if (!required) return true;

  // ACC-70 — an unknown answer is not a negative one. A failed loadAccess()
  // leaves permissions empty while still resolving successfully, so treating
  // "absent" as "denied" here would eject a legitimate user from every
  // guarded route after one transient 5xx. Let the request through and let
  // the backend answer authoritatively.
  if (!navigationAccessService.hasTrustworthyPermissions()) return true;

  if (navigationAccessService.hasPermission(required)) return true;

  return router.parseUrl(LANDING_ROUTE);
};
