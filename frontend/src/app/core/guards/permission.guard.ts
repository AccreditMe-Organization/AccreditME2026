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
import { ROUTE_PERMISSIONS, tenantNavItemForRoute } from '../navigation/nav-items';
import { MyWorkCountsService } from '../../foundation/home/my-work-counts.service';
import { LANDING_ROUTE } from '../navigation/landing-route';

export const permissionGuard: CanActivateFn = (route) => {
  const navigationAccessService = inject(NavigationAccessService);
  const router = inject(Router);
  const myWork = inject(MyWorkCountsService);

  // The full CONFIGURED path this guard sits on, rebuilt from the route
  // hierarchy — not routeConfig.path alone, and not the resolved URL.
  //
  // Both simpler options are wrong in a way that matters:
  //   - routeConfig.path alone yields only the last segment of a child
  //     ('unassigned' for the old /tasks/unassigned, until ACC-120 slice 3),
  //     which is not a key in the map, so a child's stricter entry would be
  //     silently skipped.
  //   - the resolved URL yields '/committees/abc123', which matches nothing,
  //     so a deep child would be treated as unmapped and allowed.
  //
  // Joining the configured segments gives the child's full path (matched
  // exactly) and 'committees/:id' (which falls back below to its guarded
  // parent).
  const fullPath = route.pathFromRoot
    .map((r) => r.routeConfig?.path ?? '')
    .filter((p) => p.length > 0)
    .join('/');

  // Exact match first, then walk up. A child inherits its parent's
  // requirement unless it declares a stricter one of its own.
  let required: readonly string[] | undefined;
  let routeKey = '';
  const segments = fullPath.split('/').filter((s) => s.length > 0);
  for (let i = segments.length; i > 0 && !required; i--) {
    routeKey = segments.slice(0, i).join('/');
    required = ROUTE_PERMISSIONS.get(routeKey);
  }

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

  // ACC-123 — EVERY permission in the entry, not the first. An Administration
  // route carries two: admin:access and the page's own. Holding one is not
  // holding the route, which is the entire point of separating them — a
  // quality manager holds users:view for the task assignee picker and must
  // still be refused /users.
  if (required.every((permission) => navigationAccessService.hasPermission(permission)))
    return true;

  // ACC-281 — the route's nav item may be met another way: a member of an
  // active committee opens Committees without committees:view (the server
  // answers their own committees). Every child (/committees/:id, its change
  // requests) arrives here through the walk-up above, on the 'committees' key.
  //   - Known member (My committees ready, total > 0): admit.
  //   - Unknown (loading, or failed): admit and let the server decide. This is
  //     ACC-70's rule again, and it is the hard reload straight onto
  //     /committees/:id, which runs before the shell has started the counts.
  //   - Known non-member (ready, total 0, which includes the module being closed):
  //     the landing route, as before.
  // Never a platform admin: their counts never load, so "loading" must not
  // admit them.
  if (tenantNavItemForRoute(routeKey)?.orWhen === 'committeeMember' && !navigationAccessService.isPlatformAdmin()) {
    const committees = myWork.myCommittees();
    if (committees.state !== 'ready' || committees.value.total > 0) return true;
  }

  return router.parseUrl(LANDING_ROUTE);
};
