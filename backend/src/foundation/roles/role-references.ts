import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { POSITIONS_PERMISSIONS, USERS_PERMISSIONS, WORKFLOWS_PERMISSIONS } from '../../common/constants/permissions';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * ACC-154 — what still holds or names a role. A role is deactivated only when
 * nothing does (Ahmad, 30 Sep: "it needs to check if any position or user holds
 * this role first"), for EVERY role, system or custom; nothing is cleared or
 * cascaded for the admin.
 *
 * The categories, measured against the schema (18 Nov, after ACC-271 removed
 * the roles on transitions and the stage assignee role fields):
 *   - USER_GRANTS       a user granted the role directly (UserRole, no position marker)
 *   - POSITION_GRANTS   a user granted it by holding a head position (UserRole
 *                       with grantedViaHeadPosition*): the position grants it
 *   - POSITIONS         an ACTIVE position that gives its holders the role
 *                       (OrgPosition.roleId). An inactive one does not block: if
 *                       it is reactivated it maps to an inactive role, which
 *                       grants nothing, and it can be given another role.
 *   - STAGE_ESCALATIONS a workflow stage escalation rule that tells the role's
 *                       holders (WorkflowStage.escalationConfig[].notifyRoleId, ACC-105)
 * A stage's people never name a role (no ROLE assignee kind since ACC-271), and
 * a transition names none.
 *
 * WHO COUNTS (Ahmad, 18 Nov): only ACTIVE and INVITED users hold a grant that
 * blocks. An INACTIVE or SUSPENDED user's leftover grant does not: if that user
 * is reactivated, a deactivated role grants nothing (getUserPermissions() reads
 * role.isActive), so nothing is lost by deactivating it.
 *
 * WHAT IS NAMED follows the reader's own permissions (ACC-101's rule): user
 * names need users:view, position names positions:view, stage names
 * workflows:view. Without it the category carries its count and no names.
 * Counts are always given.
 *
 * ONE function, read by deactivateRole() (inside its transaction, under the role
 * row lock) and by GET /roles/:id/deactivation-check, so the two cannot differ.
 * One query per category, each scoped by the role's id AND organisation,
 * returning the total and up to 10 names; never a read per row. The pre-flight
 * runs the four together (`parallel`); inside the deactivate's transaction they
 * stay sequential, on its one connection.
 *
 * NAMES ARE DATA, NOT A LABEL: each carries its English and Arabic name (a
 * person has one name, in nameEn), and a stage carries its workflow's names
 * separately, so the reader's screen builds the label in its own language.
 */
export type RoleReferenceCategory = 'USER_GRANTS' | 'POSITION_GRANTS' | 'POSITIONS' | 'STAGE_ESCALATIONS';

/** One named holder or reference. A person's name is nameEn, with nameAr null. */
export interface RoleReferenceName {
  nameEn: string;
  nameAr: string | null;
  /** STAGE_ESCALATIONS only: the workflow the stage belongs to. */
  workflow?: { nameEn: string; nameAr: string | null };
}

export interface RoleReferenceBlocker {
  category: RoleReferenceCategory;
  count: number;
  /** Up to NAMES_SHOWN of them; empty when the reader may not see these names. */
  names: RoleReferenceName[];
}

export const NAMES_SHOWN = 10;

type Client = Pick<PrismaService, '$queryRaw'>;
type Row = {
  nameEn: string;
  nameAr: string | null;
  workflowNameEn?: string;
  workflowNameAr?: string | null;
  total: number;
};

const GRANTED_BY_POSITION = Prisma.sql`(ur."grantedViaHeadPositionId" IS NOT NULL OR ur."grantedViaHeadPositionOrgUnitId" IS NOT NULL)`;

function grantsSql(roleId: string, organizationId: string, byPosition: boolean): Prisma.Sql {
  return Prisma.sql`
    SELECT u.name AS "nameEn", NULL::text AS "nameAr", count(*) OVER ()::int AS total
      FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId" AND r."organizationId" = ${organizationId}
      JOIN "User" u ON u.id = ur."userId" AND u."organizationId" = ${organizationId}
     WHERE ur."roleId" = ${roleId} AND u.status IN ('ACTIVE', 'INVITED')
       AND ${byPosition ? GRANTED_BY_POSITION : Prisma.sql`NOT ${GRANTED_BY_POSITION}`}
     ORDER BY u.name, u.id
     LIMIT ${NAMES_SHOWN}`;
}

const QUERIES: Record<RoleReferenceCategory, (roleId: string, organizationId: string) => Prisma.Sql> = {
  USER_GRANTS: (roleId, organizationId) => grantsSql(roleId, organizationId, false),
  POSITION_GRANTS: (roleId, organizationId) => grantsSql(roleId, organizationId, true),
  POSITIONS: (roleId, organizationId) => Prisma.sql`
    SELECT p."nameEn", p."nameAr", count(*) OVER ()::int AS total
      FROM "OrgPosition" p
     WHERE p."roleId" = ${roleId} AND p."organizationId" = ${organizationId} AND p."isActive" = true
     ORDER BY p."nameEn", p.id
     LIMIT ${NAMES_SHOWN}`,
  STAGE_ESCALATIONS: (roleId, organizationId) => Prisma.sql`
    SELECT s."nameEn", s."nameAr", t."nameEn" AS "workflowNameEn", t."nameAr" AS "workflowNameAr",
           count(*) OVER ()::int AS total
      FROM "WorkflowStage" s
      JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
     WHERE EXISTS (
             SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."escalationConfig") = 'array' THEN s."escalationConfig" ELSE '[]'::jsonb END) rule
              WHERE rule->>'notifyRoleId' = ${roleId})
     ORDER BY t."nameEn", s."order", s.id
     LIMIT ${NAMES_SHOWN}`,
};

/** The permission a reader needs to see each category's names. */
export const NAME_PERMISSION: Record<RoleReferenceCategory, string> = {
  USER_GRANTS: USERS_PERMISSIONS.VIEW,
  POSITION_GRANTS: USERS_PERMISSIONS.VIEW,
  POSITIONS: POSITIONS_PERMISSIONS.VIEW,
  STAGE_ESCALATIONS: WORKFLOWS_PERMISSIONS.VIEW,
};

/**
 * Everything that still holds or names the role, one entry per category that
 * has any, named only where `viewerPermissions` allows.
 */
export async function roleReferences(
  client: Client,
  roleId: string,
  organizationId: string,
  viewerPermissions: readonly string[],
  options: { parallel?: boolean } = {},
): Promise<RoleReferenceBlocker[]> {
  const categories = Object.keys(QUERIES) as RoleReferenceCategory[];
  const read = (category: RoleReferenceCategory) => client.$queryRaw<Row[]>(QUERIES[category](roleId, organizationId));
  let rowsByCategory: Row[][];
  if (options.parallel) {
    rowsByCategory = await Promise.all(categories.map(read));
  } else {
    rowsByCategory = [];
    for (const category of categories) rowsByCategory.push(await read(category));
  }
  const results: RoleReferenceBlocker[] = [];
  categories.forEach((category, i) => {
    const rows = rowsByCategory[i]!;
    if (rows.length === 0) return;
    const named = viewerPermissions.includes(NAME_PERMISSION[category]);
    results.push({ category, count: rows[0]!.total, names: named ? rows.map(nameOf) : [] });
  });
  return results;
}

function nameOf(row: Row): RoleReferenceName {
  return {
    nameEn: row.nameEn,
    nameAr: row.nameAr,
    ...(row.workflowNameEn !== undefined ? { workflow: { nameEn: row.workflowNameEn, nameAr: row.workflowNameAr ?? null } } : {}),
  };
}

const WORDS: Record<RoleReferenceCategory, [string, string]> = {
  USER_GRANTS: ['user', 'users'],
  POSITION_GRANTS: ['user through a head position', 'users through a head position'],
  POSITIONS: ['position', 'positions'],
  STAGE_ESCALATIONS: ['workflow stage escalation rule', 'workflow stage escalation rules'],
};

/** 409 ROLE_IN_USE: the role is still held or named; the admin removes these first. */
export class RoleInUseException extends ConflictException {
  constructor(blockers: RoleReferenceBlocker[]) {
    const list = blockers.map((b) => `${b.count} ${WORDS[b.category][b.count === 1 ? 0 : 1]}`).join(', ');
    super({
      statusCode: 409,
      message: `This role can't be deactivated while it is still in use: ${list}. Remove these first.`,
      error: 'Conflict',
      code: 'ROLE_IN_USE',
      blockers,
    });
  }
}
