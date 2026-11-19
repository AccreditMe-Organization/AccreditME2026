import { Prisma } from '../../../../generated/prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import { AWAITING_DECISION_KEYS } from './change-request-policy';

/**
 * ACC-245 PR 2 — the two candidate reads of GET /committee-change-requests/
 * awaiting-decision, each its own capped query, so rows one arm cannot keep never
 * use up the other's cap (P200). Module functions so a real-database spec can
 * hold every organisation predicate in them load-bearing, against deliberately
 * corrupt cross-organisation links: each table is scoped by the organisation
 * itself, never only through another table that is.
 *
 * Both read a request's NEWEST instance (createdAt DESC), not cancelled, and
 * never the viewer's own requests; both order oldest submitted first, then id.
 */

type Client = Pick<PrismaService, '$queryRaw'>;
const OBJECT_TYPE = 'COMMITTEE_CHANGE_REQUEST';

/** The newest instance of each request, scoped by the organisation. */
function newestInstance(organizationId: string): Prisma.Sql {
  return Prisma.sql`
    JOIN LATERAL (
      SELECT wi."currentStageId", wi.status
      FROM "WorkflowInstance" wi
      WHERE wi."organizationId" = ${organizationId}
        AND wi."objectType"::text = ${OBJECT_TYPE}
        AND wi."objectId" = r.id
      ORDER BY wi."createdAt" DESC
      LIMIT 1
    ) li ON TRUE`;
}

/**
 * The chain arm: requests whose newest instance stands in a stage awaiting the
 * chain's decision (the policy's keys: Under review), in a template of this
 * organisation. The chain then decides which of them are the viewer's.
 */
export async function chainCandidateIds(client: Client, organizationId: string, viewerId: string, cap: number): Promise<string[]> {
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT r.id
    FROM "CommitteeChangeRequest" r
    ${newestInstance(organizationId)}
    JOIN "WorkflowStage" s ON s.id = li."currentStageId"
    JOIN "WorkflowTemplate" t ON t.id = s."workflowTemplateId" AND t."organizationId" = ${organizationId}
    WHERE r."organizationId" = ${organizationId}
      AND r."submittedAt" IS NOT NULL
      AND r."requestedById" <> ${viewerId}
      AND li.status::text <> ${'CANCELLED'}
      AND s.key = ANY(${[...AWAITING_DECISION_KEYS]}::text[])
    ORDER BY r."submittedAt" ASC, r.id ASC
    LIMIT ${cap}`;
  return rows.map((r) => r.id);
}

/**
 * Where the viewer may be in an added review stage's pool, worked out before the
 * read (committee-change-request.service.ts, reviewRowsDecidedBy):
 * - `stageIds`: stages whose pool, resolved without a record, has the viewer;
 * - `committeeStageIds` + `committeeIds`: stages naming "the request's committee",
 *   and the committees the viewer (or someone they cover) holds a seat on;
 * - `unitStageIds` + `unitIds`: stages naming "the request's unit's head", and the
 *   units the viewer (or someone they cover) leads.
 * All stage ids are added review stages of this organisation's change request
 * template, read with that scope.
 */
export interface ReviewCandidateScope {
  stageIds: string[];
  committeeStageIds: string[];
  committeeIds: string[];
  unitStageIds: string[];
  unitIds: string[];
}

/** The review arm, one page: requests standing where the viewer may be in the pool, after `after`. */
export async function reviewCandidates(
  client: Client,
  organizationId: string,
  viewerId: string,
  scope: ReviewCandidateScope,
  after: { submittedAt: Date; id: string } | null,
  cap: number,
): Promise<{ id: string; submittedAt: Date }[]> {
  const page = after ? Prisma.sql`AND (r."submittedAt", r.id) > (${after.submittedAt}, ${after.id})` : Prisma.empty;
  return client.$queryRaw<{ id: string; submittedAt: Date }[]>`
    SELECT r.id, r."submittedAt"
    FROM "CommitteeChangeRequest" r
    ${newestInstance(organizationId)}
    JOIN "Committee" c ON c.id = r."committeeId" AND c."organizationId" = ${organizationId}
    WHERE r."organizationId" = ${organizationId}
      AND r."submittedAt" IS NOT NULL
      AND r."requestedById" <> ${viewerId}
      AND li.status::text <> ${'CANCELLED'}
      AND (
        li."currentStageId" = ANY(${scope.stageIds}::text[])
        OR (li."currentStageId" = ANY(${scope.committeeStageIds}::text[]) AND r."committeeId" = ANY(${scope.committeeIds}::text[]))
        OR (li."currentStageId" = ANY(${scope.unitStageIds}::text[]) AND c."orgUnitId" = ANY(${scope.unitIds}::text[]))
      )
      ${page}
    ORDER BY r."submittedAt" ASC, r.id ASC
    LIMIT ${cap}`;
}
