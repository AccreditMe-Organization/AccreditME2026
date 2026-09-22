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
//
// ACC-79 — RESTRUCTURED INTO GROUPS, built against
// frontend/design-reference/AccreditMe App Shell.dc.html:
//
//   My work  →  Quality management  →  Administration
//
// Configuration screens are one-time setup an admin visits during onboarding
// and rarely after, so they go LAST. Before this, a non-admin saw an almost
// empty rail, because the rail was mostly configuration they could not use.
//
// ONE DEVIATION FROM THE REFERENCE, on purpose. The reference shows the
// Administration group when `role === "admin"`. This product never gates on a
// role NAME — a tenant-created custom role must get a correctly adapted rail
// with no special-casing (the same rule CLAUDE.md sets for Committee's CRUD
// permissions and for the future dashboard). So every item keeps its own
// permission, and a group renders when at least one of its items does.

import { ADMIN_ACCESS } from './admin-access';

export type NavGroupKey = 'work' | 'quality' | 'admin' | 'platform';

export interface NavItem {
  // Stable identity for tracking and tests. Never shown.
  key: string;
  labelKey: string;
  icon: string;
  route: string;
  // Omitted for content that is intrinsically SELF-SCOPED — a query that can
  // only ever return the caller's own records, so no permission is needed to
  // see it. Absent here means the route is not permission-gated at all, and
  // it is left out of ROUTE_PERMISSIONS below. Do not omit it to make a link
  // "just show up": the backend endpoint behind the route must be ungated for
  // the same reason, or the page renders a wall of 403s.
  requiredPermission?: string;
  // A live count shown on the item. Names a source the sidebar knows how to
  // read; the count is fetched only while the item is visible, so it can never
  // request an endpoint the user lacks the permission for.
  badge?: 'setupHealth';
  // Present ONLY on an entitlement-driven functional module. The item renders
  // only when NavigationAccessService.isModuleEnabled(moduleKey) — true for
  // FULL and READ_ONLY alike, because a read-only module is fully present and
  // readable; its write affordances are decided on the page, by
  // canWriteModule(). Both this AND requiredPermission must pass.
  moduleKey?: string;
}

export interface NavGroup {
  key: NavGroupKey;
  labelKey: string;
  // ACC-123 — a permission the whole GROUP requires, on top of each item's
  // own. Present only on Administration today.
  //
  // It exists because an item's permission had been answering two questions at
  // once. `users:view` is what the task assignee picker needs (it reads GET
  // /users), and it was also read as "may open the Users admin page", so
  // QUALITY_MANAGER — which holds users:view, org:view, lookups:view and
  // workflows:view for its pickers — was shown the whole Administration
  // section, and write controls the server then refused. Splitting the
  // questions is the fix: the item permission still says what the PAGE reads,
  // and this says whether the person administers at all. Both must pass.
  requiredPermission?: string;
  items: readonly NavItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// TENANT NAVIGATION — the same groups for every tenant user. Which items a
// user sees is computed from their permissions and their tenant's
// entitlements; nothing here knows what role anyone holds.
//
// A module AccreditMe has NOT BUILT has no entry here, and must not get one
// ahead of shipping — not greyed out, not "coming soon". A roadmap promise on
// screen is a liability when an accreditation surveyor is looking.
// ─────────────────────────────────────────────────────────────────────────────
export const TENANT_NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'work',
    labelKey: 'nav.groups.work',
    items: [
      { key: 'home', labelKey: 'nav.home', icon: 'pi pi-home', route: '/home' },
      // NO requiredPermission, matching the endpoint behind it. /tasks renders
      // MyTasksComponent, which reads GET /tasks/my-tasks — ungated in ACC-70
      // because it can only return work assigned to the caller.
      {
        key: 'myTasks',
        labelKey: 'nav.myTasks',
        icon: 'pi pi-check-square',
        route: '/tasks',
      },
    ],
  },
  {
    key: 'quality',
    labelKey: 'nav.groups.quality',
    items: [
      // ⚠ COMMITTEES IS THE ONE QUALITY ITEM THAT IS NOT ENTITLEMENT-DRIVEN,
      // and that is deliberate, not an oversight to "fix" by adding a
      // moduleKey.
      //
      // The design reference treats Committees as a licensed module like the
      // rest of this group. But no tenant has any module switched on — every
      // organization's settings.modules key is absent (verified against the
      // dev database, ACC-79) — so gating this item on
      // isModuleEnabled('committees') would remove Committees from every rail,
      // tenant admins included, the moment it shipped.
      //
      // Turning settings.modules.committees on for tenants is a data decision
      // of the same class as assigning tenants to plans, and it belongs with
      // the pricing work, not with a shell ticket. Until then this stays
      // permission-gated only. When that work lands, add
      // `moduleKey: 'committees'` here, and switch the data on first.
      //
      // Every functional module built after this (Documents, Standards, …)
      // gets BOTH a moduleKey and a requiredPermission from the start.
      {
        key: 'committees',
        labelKey: 'nav.committees',
        icon: 'pi pi-flag',
        route: '/committees',
        requiredPermission: 'committees:view',
      },
    ],
  },
  {
    key: 'admin',
    labelKey: 'nav.groups.admin',
    // ACC-123. Note what is NOT done here: the items keep their own
    // permissions unchanged. Dropping them and gating the section on this
    // alone would hand a custom admin role every admin page the moment a
    // tenant granted it one — the "each item still requires its own page
    // permission as well" half of the decision.
    requiredPermission: ADMIN_ACCESS,
    items: [
      // ACC-82 — first, as in the reference: it is the one Administration item
      // that is about what is wrong NOW rather than a screen to configure. Its
      // badge counts open conditions (SYSTEM-REFERENCE §13.9).
      {
        key: 'setupHealth',
        labelKey: 'nav.setupHealth',
        icon: 'pi pi-heart',
        route: '/setup-health',
        requiredPermission: 'setup:view',
        badge: 'setupHealth',
      },
      {
        key: 'users',
        labelKey: 'nav.users',
        icon: 'pi pi-users',
        route: '/users',
        requiredPermission: 'users:view',
      },
      {
        key: 'roles',
        labelKey: 'nav.roles',
        icon: 'pi pi-shield',
        route: '/roles',
        requiredPermission: 'roles:view',
      },
      {
        key: 'orgPositions',
        labelKey: 'nav.orgPositions',
        icon: 'pi pi-briefcase',
        route: '/org-positions',
        requiredPermission: 'positions:view',
      },
      {
        key: 'organization',
        labelKey: 'nav.organization',
        icon: 'pi pi-building',
        route: '/organization',
        requiredPermission: 'org:view',
      },
      {
        key: 'workflows',
        labelKey: 'nav.workflows',
        icon: 'pi pi-sitemap',
        route: '/workflows',
        requiredPermission: 'workflows:view',
      },
      {
        key: 'lookups',
        labelKey: 'nav.lookups',
        icon: 'pi pi-list',
        route: '/lookups',
        requiredPermission: 'lookups:view',
      },
      {
        key: 'workingCalendar',
        labelKey: 'nav.workingCalendar',
        icon: 'pi pi-calendar',
        route: '/working-calendar',
        requiredPermission: 'org:view',
      },
      // ── ACC-79: the four screens the Admin Settings hub used to front. ──
      //
      // The hub was a page of cards duplicating the rail — seven of its cards
      // pointed at screens already listed above, with their permissions copied
      // by hand — plus four screens that lived nowhere else. Those four now sit
      // here and the hub is gone. Its URLs are kept (/admin-settings/...), so
      // nothing that links to them moves.
      //
      // Twelve items is long for a flat list. Merging screens was considered and
      // rejected: none of the four genuinely belong together (the reasoning is
      // on each). The order does the work instead — people, structure, time,
      // then the tenant's own settings.
      //
      // Task SLA sits beside Working calendar: SLA hours are counted through
      // the calendar, and TaskService reads this config for real.
      {
        key: 'taskSla',
        labelKey: 'nav.taskSla',
        icon: 'pi pi-clock',
        route: '/admin-settings/task-sla',
        requiredPermission: 'tenant:manage_config',
      },
      // Not in the design reference. A tasks:manage triage view: the reference's
      // nearest equivalent, "Awaiting my action", is unbuilt. Kept here rather
      // than dropped, because removing a working screen from the rail would
      // orphan it the way Platform Admin's screens once were.
      {
        key: 'unassignedTasks',
        labelKey: 'nav.unassignedTasks',
        icon: 'pi pi-exclamation-triangle',
        route: '/tasks/unassigned',
        requiredPermission: 'tasks:manage',
      },
      // tenant:view, not manage_config — the page reads GET /tenant. Its save
      // is PATCH /tenant, which needs tenant:update, so a custom role holding
      // only tenant:view sees a form whose save is refused. Pre-existing, and
      // unreachable with the seeded roles: only TENANT_ADMIN holds any tenant:*
      // permission.
      {
        key: 'organizationProfile',
        labelKey: 'nav.organizationProfile',
        icon: 'pi pi-id-card',
        route: '/admin-settings/organization-profile',
        requiredPermission: 'tenant:view',
      },
      // INERT TODAY, and the page says so. It stores Organization.emailConfig,
      // which nothing reads — email still goes through the platform default
      // (CLAUDE.md, Email Provider). Listed so the screen is not orphaned; when
      // per-tenant email resolution is built this entry needs no change.
      {
        key: 'emailProvider',
        labelKey: 'nav.emailProvider',
        icon: 'pi pi-envelope',
        route: '/admin-settings/email-provider',
        requiredPermission: 'tenant:manage_config',
      },
      // Labelled "AI credits", not "AI settings": the page is a credit balance
      // and an overage toggle. It holds NO provider configuration — provider
      // selection is unbuilt (CLAUDE.md, AI provider selection) — so it was not
      // merged with Email provider despite both sounding like provider setup.
      // Its natural home is the reference's Plan & modules, when that exists.
      {
        key: 'aiCredits',
        labelKey: 'nav.aiCredits',
        icon: 'pi pi-microchip-ai',
        route: '/admin-settings/ai-settings',
        requiredPermission: 'tenant:manage_config',
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// PLATFORM NAVIGATION — a different product operating ON tenants, not a higher
// permission tier inside one. The whole of /platform is gated by
// platformAdminGuard (isPlatformOrg AND platform:admin), so these items carry
// no individual permission.
//
// Every built platform screen is listed. Before ACC-79 the platform rail had a
// single "Super Admin" link, and AI feature costs and AI credit packs were
// reachable only by typing their URLs (CLAUDE.md, Open/Deferred Items).
// ─────────────────────────────────────────────────────────────────────────────
export const PLATFORM_NAV_GROUPS: readonly NavGroup[] = [
  {
    key: 'platform',
    labelKey: 'nav.groups.platform',
    items: [
      {
        key: 'tenants',
        labelKey: 'platform.tenants',
        icon: 'pi pi-building',
        route: '/platform/tenants',
      },
      {
        key: 'plans',
        labelKey: 'platform.plans',
        icon: 'pi pi-box',
        route: '/platform/plans',
      },
      {
        key: 'aiCreditPacks',
        labelKey: 'platform.aiCreditPacks',
        icon: 'pi pi-wallet',
        route: '/platform/ai-credit-packs',
      },
      {
        key: 'aiFeatureCosts',
        labelKey: 'platform.aiFeatureCosts',
        icon: 'pi pi-sliders-h',
        route: '/platform/ai-feature-costs',
      },
      {
        key: 'platformSettings',
        labelKey: 'platform.platformSettings',
        icon: 'pi pi-cog',
        route: '/platform/settings',
      },
    ],
  },
];

// The slice of NavigationAccessService this model depends on. Declared as an
// interface so the visibility rule is testable without HTTP or TestBed.
export interface NavAccess {
  hasPermission(permission: string): boolean;
  isModuleEnabled(moduleKey: string): boolean;
  isPlatformAdmin(): boolean;
}

export function isNavItemVisible(item: NavItem, access: NavAccess): boolean {
  const permitted =
    !item.requiredPermission || access.hasPermission(item.requiredPermission);
  const entitled = !item.moduleKey || access.isModuleEnabled(item.moduleKey);
  return permitted && entitled;
}

/** ACC-123 — a group the caller may see at all, before its items are filtered. */
export function isNavGroupPermitted(group: NavGroup, access: NavAccess): boolean {
  return !group.requiredPermission || access.hasPermission(group.requiredPermission);
}

/**
 * The rail for this user: platform groups for a platform admin, tenant groups
 * for everyone else, each filtered to the items this user may see.
 *
 * A group with no visible items is dropped entirely — never rendered as a
 * lone heading, which would read as a section the user has been locked out
 * of rather than one that does not apply to them.
 */
export function visibleNavGroups(access: NavAccess): NavGroup[] {
  const groups = access.isPlatformAdmin()
    ? PLATFORM_NAV_GROUPS
    : TENANT_NAV_GROUPS;
  return groups
    .filter((group) => isNavGroupPermitted(group, access))
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => isNavItemVisible(item, access)),
    }))
    .filter((group) => group.items.length > 0);
}

// Permission-gated routes that have NO nav item. Without an entry here, such a
// route would be the one gated screen the guard silently allowed through.
export const STANDALONE_ROUTE_PERMISSIONS: ReadonlyMap<string, readonly string[]> =
  new Map([
    // Must be explicit now that /tasks itself is ungated. permissionGuard walks
    // UP from a route to its nearest mapped ancestor, but a child route with no
    // canActivate never runs the guard at all. With 'tasks' unmapped, this child
    // would have become reachable by anyone — and TaskListComponent can return
    // ANY task in the tenant, not just the caller's. Deliberately has no nav
    // item: CLAUDE.md records /tasks/all as a stopgap that must not be linked.
    //
    // ACC-123 deliberately leaves this one tasks:view alone. It is a stopgap
    // route with no nav item, not an Administration screen, so requiring
    // admin:access here would be inventing a rule the decision did not make.
    ['tasks/all', ['tasks:view'] as readonly string[]],
  ]);

// Route path -> the permissions required to open it, ALL of which must be held.
// Keyed by the route path WITHOUT its leading slash, matching how app.routes.ts
// declares children under the shell's `path: ''`.
//
// Built from the groups above rather than hand-written, so adding a nav item
// automatically guards its route and there is no second place to forget. An
// Administration item yields two entries in its list — the group's
// admin:access and its own page permission (ACC-123) — which is how a typed
// URL is refused rather than only a link being hidden.
//
// Platform items are not included: /platform is guarded as a whole by
// platformAdminGuard, not per item.
export const ROUTE_PERMISSIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ...TENANT_NAV_GROUPS.flatMap((group) =>
    group.items
      // A self-scoped item has no entry — absence from this map is how the
      // guard knows the route is not permission-gated. A group permission
      // alone does not create one: an ungated item inside a gated group would
      // be a contradiction, and none exists.
      .filter(
        (item): item is NavItem & { requiredPermission: string } =>
          !!item.requiredPermission,
      )
      .map(
        (item) =>
          [
            item.route.replace(/^\//, ''),
            group.requiredPermission
              ? [group.requiredPermission, item.requiredPermission]
              : [item.requiredPermission],
          ] as const,
      ),
  ),
  ...STANDALONE_ROUTE_PERMISSIONS,
]);
