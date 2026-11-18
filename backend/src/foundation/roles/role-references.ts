import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
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
 *   - POSITIONS         a position that gives its holders the role (OrgPosition.roleId)
 *   - STAGE_ESCALATIONS a workflow stage escalation rule that tells the role's
 *                       holders (WorkflowStage.escalationConfig[].notifyRoleId, ACC-105)
 * A stage's people never name a role (no ROLE assignee kind since ACC-271), and
 * a transition names none. Users of any status count: a grant is a grant.
 *
 * ONE function, read by deactivateRole() (inside its transaction, under the role
 * row lock) and by GET /roles/:id/deactivation-check, so the two cannot differ.
 * One query per category, each scoped by the role's id AND organisation,
 * returning the total and up to 10 names; never a read per row.
 */
export type RoleReferenceCategory = 'USER_GRANTS' | 'POSITION_GRANTS' | 'POSITIONS' | 'STAGE_ESCALATIONS';

export interface RoleReferenceBlocker {
  category: RoleReferenceCategory;
  count: number;
  /** Up to NAMES_SHOWN of them, by name. */
  names: string[];
}

export const NAMES_SHOWN = 10;

type Client = Pick<PrismaService, '$queryRaw'>;
type Row = { name: string; total: number };

const GRANTED_BY_POSITION = Prisma.sql`(ur."grantedViaHeadPositionId" IS NOT NULL OR ur."grantedViaHeadPositionOrgUnitId" IS NOT NULL)`;

function grantsSql(roleId: string, organizationId: string, byPosition: boolean): Prisma.Sql {
  return Prisma.sql`
    SELECT u.name, count(*) OVER ()::int AS total
      FROM "UserRole" ur
      JOIN "Role" r ON r.id = ur."roleId" AND r."organizationId" = ${organizationId}
      JOIN "User" u ON u.id = ur."userId" AND u."organizationId" = ${organizationId}
     WHERE ur."roleId" = ${roleId} AND ${byPosition ? GRANTED_BY_POSITION : Prisma.sql`NOT ${GRANTED_BY_POSITION}`}
     ORDER BY u.name, u.id
     LIMIT ${NAMES_SHOWN}`;
}

const QUERIES: Record<RoleReferenceCategory, (roleId: string, organizationId: string) => Prisma.Sql> = {
  USER_GRANTS: (roleId, organizationId) => grantsSql(roleId, organizationId, false),
  POSITION_GRANTS: (roleId, organizationId) => grantsSql(roleId, organizationId, true),
  POSITIONS: (roleId, organizationId) => Prisma.sql`
    SELECT p."nameEn" AS name, count(*) OVER ()::int AS total
      FROM "OrgPosition" p
     WHERE p."roleId" = ${roleId} AND p."organizationId" = ${organizationId}
     ORDER BY p."nameEn", p.id
     LIMIT ${NAMES_SHOWN}`,
  STAGE_ESCALATIONS: (roleId, organizationId) => Prisma.sql`
    SELECT t."nameEn" || ' — ' || s."nameEn" AS name, count(*) OVER ()::int AS total
      FROM "WorkflowStage" s
      JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
     WHERE EXISTS (
             SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(s."escalationConfig") = 'array' THEN s."escalationConfig" ELSE '[]'::jsonb END) rule
              WHERE rule->>'notifyRoleId' = ${roleId})
     ORDER BY t."nameEn", s."order", s.id
     LIMIT ${NAMES_SHOWN}`,
};

/** Everything that still holds or names the role, one entry per category that has any. */
export async function roleReferences(client: Client, roleId: string, organizationId: string): Promise<RoleReferenceBlocker[]> {
  const categories = Object.keys(QUERIES) as RoleReferenceCategory[];
  const results: RoleReferenceBlocker[] = [];
  for (const category of categories) {
    const rows = await client.$queryRaw<Row[]>(QUERIES[category](roleId, organizationId));
    if (rows.length > 0) results.push({ category, count: rows[0]!.total, names: rows.map((r) => r.name) });
  }
  return results;
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
