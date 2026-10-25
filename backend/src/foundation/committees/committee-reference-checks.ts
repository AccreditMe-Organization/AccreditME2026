import { BadRequestException, Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { STAGE_FLAG } from '../workflow/record-registry';

/**
 * ACC-233 — what a committee may point at: its parent, the committee it reports
 * to, and the unit that owns it. Plan: backend/Plans/step-233-committee-reference-checks.md.
 *
 * Every refusal is a 400 with a CODE. The committee dialog says it from the
 * code, in the reader's language, never from the English `message` (written for
 * a log). A reference in another organisation is read with `{ id,
 * organizationId }`, so it misses exactly as an invented id does and gets the
 * identical refusal: nothing here can tell a caller another organisation's
 * committee or unit exists.
 *
 * The checks run inside the caller's transaction, after
 * `lockCommitteeHierarchy()`, so the walk and the write see the same tree.
 */
export const COMMITTEE_REFUSALS = {
  COMMITTEE_OWN_PARENT: "A committee can't be its own parent committee.",
  COMMITTEE_REPORTS_TO_ITSELF: "A committee can't report to itself.",
  COMMITTEE_PARENT_LOOP: "A committee can't sit under one of its own sub-committees.",
  COMMITTEE_REPORTS_TO_LOOP: "A committee can't report to a committee that reports to it.",
  COMMITTEE_PARENT_DISSOLVING: "A committee that is being dissolved, or has been, can't be a parent committee.",
  COMMITTEE_REPORTS_TO_DISSOLVING: "A committee can't report to a committee that is being dissolved, or has been.",
  COMMITTEE_PARENT_NOT_FOUND: "That parent committee doesn't exist.",
  COMMITTEE_REPORTS_TO_NOT_FOUND: "That committee doesn't exist.",
  COMMITTEE_UNIT_REQUIRED: 'Choose the unit that owns this committee.',
  COMMITTEE_UNIT_NOT_FOUND: "That unit doesn't exist or is no longer active.",
} as const;

export type CommitteeRefusalCode = keyof typeof COMMITTEE_REFUSALS;

export class CommitteeReferenceRefusal extends BadRequestException {
  constructor(readonly code: CommitteeRefusalCode) {
    super({ statusCode: 400, message: COMMITTEE_REFUSALS[code], error: 'Bad Request', code });
  }
}

/**
 * What is being set. `undefined` means "not changing" and is not checked; for
 * a parent or reports-to, `null` means "clear it", which is always allowed.
 * `committeeId` is null on create: a new committee has no sub-committees and
 * nothing reports to it yet, so no loop can pass through it.
 */
export interface CommitteeReferenceChange {
  organizationId: string;
  committeeId: string | null;
  parentCommitteeId?: string | null;
  reportingToCommitteeId?: string | null;
  orgUnitId?: string | null;
}

/** The transaction client of the EXTENDED PrismaService — not Prisma.TransactionClient, whose delegates differ. */
export type CommitteeTx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];
type Tx = CommitteeTx;

/**
 * Serialises every change to one organisation's committee tree. Two edits that
 * would close a loop between them (A under B, B under A) lock DIFFERENT
 * committee rows, so only an organisation-wide lock queues them; the second
 * walk then sees the first edit. Released when the transaction ends. Same shape
 * as the storage quota's lock (ACC-177).
 */
export async function lockCommitteeHierarchy(tx: Tx, organizationId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`committee-hierarchy:${organizationId}`}))::text`;
}

export async function assertCommitteeReferences(tx: Tx, change: CommitteeReferenceChange, logger: Logger): Promise<void> {
  const { organizationId, committeeId } = change;

  if (change.parentCommitteeId) {
    const target = change.parentCommitteeId;
    if (target === committeeId) throw new CommitteeReferenceRefusal('COMMITTEE_OWN_PARENT');
    if (!(await committeeExists(tx, target, organizationId))) throw new CommitteeReferenceRefusal('COMMITTEE_PARENT_NOT_FOUND');
    if (committeeId && (await parentChainReaches(tx, target, committeeId, organizationId))) {
      throw new CommitteeReferenceRefusal('COMMITTEE_PARENT_LOOP');
    }
    if (await isDissolving(tx, target, organizationId, logger)) throw new CommitteeReferenceRefusal('COMMITTEE_PARENT_DISSOLVING');
  }

  if (change.reportingToCommitteeId) {
    const target = change.reportingToCommitteeId;
    if (target === committeeId) throw new CommitteeReferenceRefusal('COMMITTEE_REPORTS_TO_ITSELF');
    if (!(await committeeExists(tx, target, organizationId))) throw new CommitteeReferenceRefusal('COMMITTEE_REPORTS_TO_NOT_FOUND');
    if (committeeId && (await reportsToChainReaches(tx, target, committeeId, organizationId))) {
      throw new CommitteeReferenceRefusal('COMMITTEE_REPORTS_TO_LOOP');
    }
    if (await isDissolving(tx, target, organizationId, logger)) {
      throw new CommitteeReferenceRefusal('COMMITTEE_REPORTS_TO_DISSOLVING');
    }
  }

  if (change.orgUnitId !== undefined) {
    if (!change.orgUnitId) throw new CommitteeReferenceRefusal('COMMITTEE_UNIT_REQUIRED');
    const unit = await tx.orgUnit.findFirst({
      where: { id: change.orgUnitId, organizationId, isActive: true },
      select: { id: true },
    });
    if (!unit) throw new CommitteeReferenceRefusal('COMMITTEE_UNIT_NOT_FOUND');
  }
}

async function committeeExists(tx: Tx, id: string, organizationId: string): Promise<boolean> {
  return !!(await tx.committee.findFirst({ where: { id, organizationId }, select: { id: true } }));
}

/**
 * Whether walking UP from `start` along the parent chain reaches `committeeId` —
 * i.e. `start` is the committee or one of its descendants, so making it the
 * parent would close a loop. One recursive query; UNION (not UNION ALL) drops a
 * committee already seen, so a loop already in the data ends the walk instead
 * of hanging the request. Two fixed queries rather than one with a column name
 * passed in: no identifier is ever built from a value.
 */
async function parentChainReaches(tx: Tx, start: string, committeeId: string, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ reaches: boolean }[]>`
    WITH RECURSIVE up(id) AS (
      SELECT ${start}::text
      UNION
      SELECT c."parentCommitteeId" FROM "Committee" c JOIN up ON c.id = up.id
      WHERE c."organizationId" = ${organizationId} AND c."parentCommitteeId" IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${committeeId}) AS "reaches"`;
  return rows[0]?.reaches === true;
}

/** The same walk along the reports-to chain, which is separate from the parent chain. */
async function reportsToChainReaches(tx: Tx, start: string, committeeId: string, organizationId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<{ reaches: boolean }[]>`
    WITH RECURSIVE up(id) AS (
      SELECT ${start}::text
      UNION
      SELECT c."reportingToCommitteeId" FROM "Committee" c JOIN up ON c.id = up.id
      WHERE c."organizationId" = ${organizationId} AND c."reportingToCommitteeId" IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM up WHERE id = ${committeeId}) AS "reaches"`;
  return rows[0]?.reaches === true;
}

/**
 * Whether the committee's CURRENT stage — its newest COMMITTEE workflow
 * instance — is flagged DISSOLVING (ACC-255 PR 2: the stage's own meaning,
 * configured per tenant, never its key, name or order).
 *
 * The instance row is read FOR SHARE: a transition on that committee takes the
 * instance's row lock (ACC-190), so a dissolution already in flight finishes
 * before this answers, and one started now waits for this save.
 *
 * A committee with no instance or no current stage is not dissolving.
 */
async function isDissolving(tx: Tx, committeeId: string, organizationId: string, _logger: Logger): Promise<boolean> {
  const rows = await tx.$queryRaw<{ flags: string[] | null }[]>`
    SELECT ws."flags" AS "flags"
    FROM "WorkflowInstance" wi
    LEFT JOIN "WorkflowStage" ws ON ws.id = wi."currentStageId"
    WHERE wi."organizationId" = ${organizationId} AND wi."objectType" = 'COMMITTEE' AND wi."objectId" = ${committeeId}
    ORDER BY wi."createdAt" DESC
    LIMIT 1
    FOR SHARE OF wi`;
  return (rows[0]?.flags ?? []).includes(STAGE_FLAG.DISSOLVING);
}
