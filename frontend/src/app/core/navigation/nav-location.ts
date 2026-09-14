import { NavAccess, NavGroup, NavItem, visibleNavGroups } from './nav-items';

// ACC-79 — where the current URL sits in the navigation model.
//
// The breadcrumb reads this, and so do browser tab titles. Before ACC-79 the
// breadcrumb read `data.breadcrumb` off each route — a second, hand-maintained
// copy of labels the nav model already held, which could drift from the rail.
// Resolving from the nav model means the rail, the route guard, the breadcrumb
// and the tab title all read ONE source.
export interface NavLocation {
  group: NavGroup;
  item: NavItem;
  // True when the URL IS the item's own page (/committees), false when it sits
  // below it (/committees/abc123). A page below its section gets the section as
  // its parent crumb; the section page itself does not list itself.
  isSectionPage: boolean;
}

/**
 * The nav item this path belongs to, among the items THIS user can see.
 *
 * Longest route wins, compared segment by segment: /tasks/unassigned resolves to
 * Unassigned tasks (Administration), not to My tasks (My work), even though
 * '/tasks' is a prefix of it. Matching is on whole segments, so /tasks-archive
 * would never match /tasks.
 *
 * Returns null when the path belongs to no item the user can see. That is
 * deliberate, not a miss: a user without users:view viewing their OWN profile at
 * /users/:id must not be shown "Administration / Users" — a section they are not
 * in, linking to a page that would bounce them.
 */
export function resolveNavLocation(
  url: string,
  access: NavAccess,
): NavLocation | null {
  const path = normalizePath(url);
  let best: NavLocation | null = null;

  for (const group of visibleNavGroups(access)) {
    for (const item of group.items) {
      const route = normalizePath(item.route);
      const matches = path === route || path.startsWith(route + '/');
      if (!matches) continue;
      if (!best || route.length > normalizePath(best.item.route).length) {
        best = { group, item, isSectionPage: path === route };
      }
    }
  }
  return best;
}

// Drops the query string, fragment and any trailing slash, so
// /users?users.scope=ACTIVE and /users/ both resolve as /users.
export function normalizePath(url: string): string {
  const withoutQuery = url.split(/[?#]/)[0] ?? '';
  const trimmed = withoutQuery.replace(/\/+$/, '');
  return trimmed === '' ? '/' : trimmed;
}
