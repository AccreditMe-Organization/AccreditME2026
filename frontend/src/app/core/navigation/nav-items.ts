// ACC-70 — the single source of truth for "which permission does this route
// require". Extracted from sidebar.component.ts, where both lists were
// module-private consts, so that the sidebar and the route guards read the
// SAME mapping rather than two copies of it.
//
// Why that matters more than it looks: a route and its own nav link
// disagreeing about who may see it is a genuinely unpleasant bug to chase —
// the link is absent but the URL works, or the link is present and the route
// bounces. Neither symptom points at the cause. One list makes that class of
// bug impossible rather than merely unlikely.
//
// DELIBERATE: permissionGuard uses whatever permission is declared here, even
// where the choice looks questionable. `/working-calendar` requiring `org:view`
// rather than a calendar-specific permission is the clearest example — there
// is no calendar permission in the system, and the calendar is org-level
// configuration, so org:view is defensible. But the point stands regardless of
// whether any individual entry is ideal: if the guard second-guessed this list,
// the single source of truth would be a fiction and the drift it exists to
// prevent would be reintroduced by the very code meant to prevent it. Change
// the entry here if a mapping is wrong; never diverge from it downstream.

export interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
  requiredPermission: string;
}

// Only routes that actually exist today (ACC-5–ACC-22) — meetings/
// documents/etc. are still unbuilt and will add their own entries once
// those modules ship, not stubbed here as dead links.
export const FOUNDATION_NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.organization', icon: 'pi pi-building', route: '/organization', requiredPermission: 'org:view' },
  { labelKey: 'nav.workingCalendar', icon: 'pi pi-calendar', route: '/working-calendar', requiredPermission: 'org:view' },
  { labelKey: 'nav.lookups', icon: 'pi pi-list', route: '/lookups', requiredPermission: 'lookups:view' },
  { labelKey: 'nav.roles', icon: 'pi pi-shield', route: '/roles', requiredPermission: 'roles:view' },
  { labelKey: 'nav.workflows', icon: 'pi pi-sitemap', route: '/workflows', requiredPermission: 'workflows:view' },
  { labelKey: 'nav.orgPositions', icon: 'pi pi-briefcase', route: '/org-positions', requiredPermission: 'positions:view' },
  { labelKey: 'nav.committees', icon: 'pi pi-flag', route: '/committees', requiredPermission: 'committees:view' },
  { labelKey: 'nav.tasks', icon: 'pi pi-check-square', route: '/tasks', requiredPermission: 'tasks:view' },
  { labelKey: 'nav.unassignedTasks', icon: 'pi pi-exclamation-triangle', route: '/tasks/unassigned', requiredPermission: 'tasks:manage' },
  { labelKey: 'nav.users', icon: 'pi pi-users', route: '/users', requiredPermission: 'users:view' },
];

// Functional modules (ACC-17+) will be appended here as they ship, each
// filtered through navigationAccessService.isModuleEnabled(moduleKey) —
// none exist yet, so this list is intentionally empty for now.
//
// RESOLVED IN ACC-79 — read before adding an entry anyway.
//
// isModuleEnabled() used to read `modules` from GET /tenant, which requires
// tenant:view. Only TENANT_ADMIN holds it, so every other role got a 403 and
// isModuleEnabled() answered false for every module — this list was left
// empty partly so that would stay harmless. It now reads GET
// /tenant/entitlements, which is ungated and self-scoped, so a non-admin sees
// the modules their tenant actually has.
//
// Two things still worth knowing before adding one:
//   - isModuleEnabled() is true for READ_ONLY modules too. A read-only module
//     belongs in the rail; use canWriteModule() to decide write affordances.
//   - With no plan assigned, every enabled module resolves to FULL. That is a
//     named legacy fallback, not a rule — see SYSTEM-REFERENCE §1.8.
export const FUNCTIONAL_NAV_ITEMS: (NavItem & { moduleKey: string })[] = [];

// Permission-gated routes that are NOT rendered from the lists above.
// Admin Settings is drawn separately in the sidebar (its own divider and
// icon, below the nav list) but is still permission-gated, so it belongs in
// the mapping even though it is not a NavItem. Without this it would be the
// one gated screen the route guard silently allowed through.
export const STANDALONE_ROUTE_PERMISSIONS: ReadonlyMap<string, string> = new Map([
  ['admin-settings', 'tenant:manage_config'],
]);

// Route path -> required permission, for the guard. Keyed by the route path
// WITHOUT its leading slash, matching how app.routes.ts declares children
// under the shell's `path: ''`.
//
// Built from the lists above rather than hand-written, so adding a nav item
// automatically guards its route and there is no second place to forget.
export const ROUTE_PERMISSIONS: ReadonlyMap<string, string> = new Map([
  ...[...FOUNDATION_NAV_ITEMS, ...FUNCTIONAL_NAV_ITEMS].map(
    (item) => [item.route.replace(/^\//, ''), item.requiredPermission] as const,
  ),
  ...STANDALONE_ROUTE_PERMISSIONS,
]);
