import { IRole } from './role.interface';

/**
 * How a user came to hold a role.
 *
 * STATED EXPLICITLY RATHER THAN LEFT TO BE INFERRED from which of the two
 * grantedVia* ids is null. A client that infers gets it right until the day the
 * writer changes, and the drawing this serves must distinguish three cases in
 * prose ("Pharmacy only" vs "organisation-wide" vs an ordinary grant) — so the
 * three are named.
 *
 * The mapping, confirmed against grantRoleViaHeadAuthority() rather than the
 * schema comment, which is loosely worded on this point (it says "never both
 * null, never both set", meaning of the REVOKE KEY, while also saying the
 * position id is "always populated on a marked row" — the writer settles it:
 * positionId is non-nullable in its signature and always written, orgUnitId is
 * null only for an org-wide head position):
 *
 *   positionId null                  -> DIRECT
 *   positionId set, orgUnitId set    -> HEAD_POSITION_UNIT
 *   positionId set, orgUnitId null   -> HEAD_POSITION_ORG_WIDE
 */
export enum UserRoleGrantSource {
  /** An ordinary assignment, made by a person through POST /users/:id/roles. */
  DIRECT = 'DIRECT',
  /** Comes with a head position scoped to one org unit. Revoked with the unit. */
  HEAD_POSITION_UNIT = 'HEAD_POSITION_UNIT',
  /** Comes with an org-wide head position (the holder has no primary unit). */
  HEAD_POSITION_ORG_WIDE = 'HEAD_POSITION_ORG_WIDE',
}

/**
 * One UserRole row, with the role it points at.
 *
 * ## Why this replaces IRole[] on GET /users/:userId/roles
 *
 * That endpoint mapped `ur.role` and dropped the row, which cost two things and
 * one of them was silent:
 *
 *  1. The two grantedVia* ids never reached the client, so a derived grant was
 *     INDISTINGUISHABLE from a direct one. Not hard to tell apart — absent.
 *
 *  2. The response still carried a `createdAt`, and it was the ROLE's. A client
 *     rendering "Granted {createdAt}" showed the date the role was created in
 *     the tenant, identical for every holder. It looks like the right field.
 *     On dev it is invisible, because the seed created roles and grants on the
 *     same day — it would have tested clean and been wrong in a real tenant.
 *
 * The role is NESTED rather than spread, deliberately. Flattening would keep the
 * old consumers compiling and leave a top-level `createdAt` meaning the role's
 * date next to a `grantedAt` meaning the grant's — the same trap with a second
 * field beside it. Breaking the callers is the point: each one had to be looked
 * at.
 *
 * ## Names are NOT included, and that is the established pattern
 *
 * `IUser` returns `positionId` and `primaryOrgUnitId` as ids, and the profile
 * screen resolves them through OrgPositionService and OrgUnitService. Ids here,
 * resolved the same way, keeps one convention rather than inventing a second.
 */
export interface IUserRoleGrant {
  /** The UserRole row's own id — what a per-grant action would address. */
  id: string;
  role: IRole;
  /**
   * UserRole.createdAt — when this PERSON was given this role, never when the
   * role itself was created.
   */
  grantedAt: Date;
  source: UserRoleGrantSource;
  /** The OrgPosition the grant derives from. Null when source is DIRECT. */
  grantedViaHeadPositionId: string | null;
  /**
   * The OrgUnit the head authority is scoped to. Null for DIRECT and for
   * HEAD_POSITION_ORG_WIDE — which is why the source field exists rather than
   * leaving a client to read two nulls and guess which case it is in.
   */
  grantedViaHeadPositionOrgUnitId: string | null;
}

/**
 * The single place the discriminator rule lives.
 *
 * Exported and used by the service rather than inlined there, so a reader
 * checking "how does the API decide this?" finds one function, and a test can
 * assert the rule itself rather than only its effect through a query.
 */
export function resolveGrantSource(
  grantedViaHeadPositionId: string | null,
  grantedViaHeadPositionOrgUnitId: string | null,
): UserRoleGrantSource {
  if (!grantedViaHeadPositionId) return UserRoleGrantSource.DIRECT;
  return grantedViaHeadPositionOrgUnitId
    ? UserRoleGrantSource.HEAD_POSITION_UNIT
    : UserRoleGrantSource.HEAD_POSITION_ORG_WIDE;
}
