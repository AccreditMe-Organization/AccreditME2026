import { PERMISSIONS_NOT_YET_CHECKED, WORKFLOWS_PERMISSIONS } from '../../common/constants/permissions';
import { ALL_PERMISSIONS } from './permission.seed';
import {
  PermissionNotInUseException,
  PermissionRootRoleOnlyException,
  PermissionUnknownException,
  PlatformPermissionNotAllowedException,
} from './role-permission-refusal';
import { TENANT_ADMIN_KEY } from './tenant-administrator.invariant';

/**
 * ACC-120 slice 5 — which permission keys can be GIVEN, and where.
 *
 * One rule, read by every write that can make a key reachable: a role's
 * permission save, creating a role, and a workflow transition's
 * requiredPermission. A transition requiring a key no role may be given is a
 * transition nobody can ever fire, so the two must refuse the same keys.
 *
 * - A platform:* key can be given only in the PLATFORM organisation (R1).
 *   Inside a tenant it means nothing — PlatformGuard also needs isPlatformOrg —
 *   so it is kept where already held and refused where newly asked for.
 * - A key on PERMISSIONS_NOT_YET_CHECKED can be given nowhere (R2): nothing
 *   decides with it today.
 */

const NOT_YET_CHECKED = new Set<string>(PERMISSIONS_NOT_YET_CHECKED);
const CATALOGUE = new Set<string>(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`));

export const isPlatformPermission = (key: string): boolean => key.startsWith('platform:');

export const isPermissionInUse = (key: string): boolean => !NOT_YET_CHECKED.has(key);

export const isKnownPermission = (key: string): boolean => CATALOGUE.has(key);

/**
 * A key a permission save in this organisation cannot change: kept as the role
 * holds it, refused if asked for. Not-in-use keys everywhere; platform keys only
 * inside a tenant — in the platform organisation they are ordinary keys (F2).
 */
export const isFixedInOrganisation = (key: string, isPlatformOrg: boolean): boolean =>
  !isPermissionInUse(key) || (!isPlatformOrg && isPlatformPermission(key));

/**
 * Refuses keys that cannot be given in this organisation. Platform keys are
 * checked first, so a tenant asking for platform:admin hears about the platform
 * rule rather than anything else. Whether a key exists is the caller's own
 * check (the role save answers an unknown key with its own 404).
 */
export function assertGrantable(keys: readonly string[], isPlatformOrg: boolean): void {
  const platform = isPlatformOrg ? [] : keys.filter(isPlatformPermission);
  if (platform.length > 0) throw new PlatformPermissionNotAllowedException(platform);
  const unused = keys.filter((k) => !isPermissionInUse(k));
  if (unused.length > 0) throw new PermissionNotInUseException(unused);
}

/**
 * ACC-258 — keys only the tenant's ROOT ROLE (Organization Administrator,
 * `TENANT_ADMIN`) may hold (Ahmad, 22 Oct: only the tenant admin changes a
 * workflow). Platform Administrator keeps the key through its own frozen seed
 * (24 Oct, Q1); it is never assignable inside a tenant.
 *
 * Kept APART from assertGrantable / assertKnownAndGrantable on purpose: those
 * also guard a workflow transition's requiredPermission, and a transition that
 * requires workflows:manage stays valid — the root role holds it, so someone can
 * still fire it.
 *
 * The role editor reads this through the catalogue's `rootRoleOnly` flag, so
 * no screen keeps a copy of the list.
 */
export const ROOT_ROLE_ONLY_PERMISSIONS: ReadonlySet<string> = new Set<string>([WORKFLOWS_PERMISSIONS.MANAGE]);

export const isRootRoleOnly = (key: string): boolean => ROOT_ROLE_ONLY_PERMISSIONS.has(key);

/**
 * Refuses (400 PERMISSION_ROOT_ROLE_ONLY) giving a root-only key to any role but
 * the root role. `roleKey` is null for a role a tenant created.
 */
export function assertNotRootRoleOnly(keys: readonly string[], roleKey: string | null): void {
  if (roleKey === TENANT_ADMIN_KEY) return;
  const reserved = keys.filter(isRootRoleOnly);
  if (reserved.length > 0) throw new PermissionRootRoleOnlyException(reserved);
}

/** assertGrantable, after refusing a key the catalogue does not have (400). */
export function assertKnownAndGrantable(keys: readonly string[], isPlatformOrg: boolean): void {
  const unknown = keys.filter((k) => !isKnownPermission(k));
  if (unknown.length > 0) throw new PermissionUnknownException(unknown);
  assertGrantable(keys, isPlatformOrg);
}
