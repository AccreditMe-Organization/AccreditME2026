import { PERMISSIONS_NOT_YET_CHECKED } from '../../common/constants/permissions';
import { ALL_PERMISSIONS } from './permission.seed';
import {
  PermissionNotInUseException,
  PermissionUnknownException,
  PlatformPermissionNotAllowedException,
} from './role-permission-refusal';

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

/** assertGrantable, after refusing a key the catalogue does not have (400). */
export function assertKnownAndGrantable(keys: readonly string[], isPlatformOrg: boolean): void {
  const unknown = keys.filter((k) => !isKnownPermission(k));
  if (unknown.length > 0) throw new PermissionUnknownException(unknown);
  assertGrantable(keys, isPlatformOrg);
}
