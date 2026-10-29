import { PermissionDto, UserPermissionGrantDto } from '../services/role.service';
import { MatrixModule, buildMatrix } from './permission-matrix.model';

/**
 * ACC-272 — "A user's permissions", as data apart from the screen.
 *
 * Pure functions over the catalogue and one person's grants (GET
 * /users/:userId/permissions), so the rules are tested without rendering:
 * which roles count, what each gives, the union, who gives each key, and the
 * modules with nothing granted.
 *
 * THE SHOWN SET IS THE ROLE PERMISSIONS PAGE'S, role by role. A role gives
 * exactly the keys its own permissions page would show as held: in use only,
 * no platform key inside a tenant, and the root-only key (workflows:manage)
 * only from the root role. So "Gives n", "n of N" and "16 permissions" count
 * one set, and none of them can disagree with the role's own page. Nothing
 * here is what the server decides with: that is getUserPermissions(), which
 * this page never imitates.
 */

/** The tenant's root role (Organization Administrator), frozen server-side. */
export const ROOT_ROLE_KEY = 'TENANT_ADMIN';

export interface UserRoleLine {
  grant: UserPermissionGrantDto;
  /** An inactive role gives nothing. */
  active: boolean;
  /** The root role: "Gives every permission". */
  isRoot: boolean;
  /** The shown keys this role gives (none while inactive), in catalogue order. */
  gives: string[];
}

export interface UserPermissionsSummary {
  /** Head-position roles, then direct, then inactive (the user record's order). */
  roles: UserRoleLine[];
  activeRoles: UserRoleLine[];
  /** The modules as shown: the root-only key is in them only through the root role. */
  modules: MatrixModule[];
  /** Every shown key some active role gives. */
  granted: ReadonlySet<string>;
  /** For each granted key, the active roles that give it, in the roles' order. */
  from: ReadonlyMap<string, UserPermissionGrantDto[]>;
  /** Modules with nothing granted, in the product order. */
  emptyModules: string[];
  /** An active root role is held: every row is granted. */
  viaRoot: UserRoleLine | null;
}

/**
 * The roles in the order the user record shows them: a role that comes with a
 * head position first, then one granted directly, then every inactive role,
 * last whatever its source. Within each, the server's order (oldest grant
 * first). Shared with the user record's Roles panel, so the two cannot drift.
 */
export function orderGrants<T extends { source: string; role: { isActive: boolean } }>(grants: readonly T[]): T[] {
  // Only an explicit false is inactive: a role read without the field is active.
  const rank = (g: T) => (g.role.isActive === false ? 2 : g.source !== 'DIRECT' ? 0 : 1);
  return grants
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
    .map(({ g }) => g);
}

/** The keys a role's own permissions page would show, as a set. */
function shownFor(catalogue: readonly PermissionDto[], isTenant: boolean, isRoot: boolean): Set<string> {
  return new Set(buildMatrix(catalogue, { isTenant, isRootRole: isRoot }).flatMap((m) => m.keys));
}

export function summarise(
  grants: readonly UserPermissionGrantDto[],
  catalogue: readonly PermissionDto[],
  opts: { isTenant: boolean },
): UserPermissionsSummary {
  const shown = { root: shownFor(catalogue, opts.isTenant, true), other: shownFor(catalogue, opts.isTenant, false) };
  const order = new Map(catalogue.map((p, i) => [`${p.module}:${p.action}`, i]));
  const roles = orderGrants(grants).map((grant): UserRoleLine => {
    const isRoot = grant.role.key === ROOT_ROLE_KEY;
    const active = grant.role.isActive !== false;
    const set = isRoot ? shown.root : shown.other;
    const gives = active
      ? [...new Set(grant.permissions)].filter((k) => set.has(k)).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      : [];
    return { grant, active, isRoot, gives };
  });
  const activeRoles = roles.filter((r) => r.active);
  const viaRoot = activeRoles.find((r) => r.isRoot) ?? null;
  const modules = buildMatrix(catalogue, { isTenant: opts.isTenant, isRootRole: !!viaRoot });

  const from = new Map<string, UserPermissionGrantDto[]>();
  for (const r of activeRoles) {
    for (const k of r.gives) from.set(k, [...(from.get(k) ?? []), r.grant]);
  }
  const granted = new Set(from.keys());
  const emptyModules = modules.filter((m) => !m.keys.some((k) => granted.has(k))).map((m) => m.module);
  return { roles, activeRoles, modules, granted, from, emptyModules, viaRoot };
}
