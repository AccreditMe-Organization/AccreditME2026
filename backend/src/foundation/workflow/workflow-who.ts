import type { Prisma, StageAssigneeKind, StageWhoMode, TransitionMover } from '../../../generated/prisma/client';

/**
 * ACC-271 PR 2 — the old "who" columns translated to the stage's own, in ONE
 * place: the backfill reads it for existing stages (plan §6.1, Ahmad's final
 * answers of 28 Oct), and its spec pins it. The seed states each stage's
 * `who` itself (workflow.seed.ts) rather than deriving it, so a reader sees it.
 */

/** One assignee entry to write, before it has a stage or an order. */
export interface WhoEntryDraft {
  kind: StageAssigneeKind;
  userId?: string | null;
  positionId?: string | null;
  orgUnitId?: string | null;
  committeeId?: string | null;
  committeeRoleValueId?: string | null;
}

export interface LegacyStageWho {
  assigneeStrategy: string;
  approvalMode: string;
  parallelThreshold: string | null;
  assigneeUserId: string | null;
  assigneePositionId: string | null;
  assigneeOrgUnitId: string | null;
  committeeId: string | null;
  assigneeCommitteeRoleValueId: string | null;
}

export interface ConvertedWho {
  whoMode: StageWhoMode;
  entries: WhoEntryDraft[];
  /** No entry of its own: the tenant admin's starting assignment goes here. */
  startingAssignment: boolean;
  /** Anything the mapping decided that a reader should see in the dry run. */
  notes: string[];
}

/**
 * | strategy              | becomes                                                    |
 * |-----------------------|------------------------------------------------------------|
 * | SPECIFIC_USER         | that user (none set → the starting assignment)             |
 * | POSITION_FIXED        | the position in that unit (either missing → starting)      |
 * | ORG_UNIT_HEAD         | the head of the record's unit (entry with no unit), when   |
 * |                       | the record type has a unit route; else the starting        |
 * |                       | assignment, as the seed gives a new organisation           |
 * | SELF                  | the record's creator                                       |
 * | COMMITTEE             | the committee (none set → the record's), with its role     |
 * | ROLE, ROUND_ROBIN     | the tenant admin's starting assignment                     |
 *
 * | approval              | who mode                                                   |
 * |-----------------------|------------------------------------------------------------|
 * | SINGLE, PARALLEL ANY  | ANY_ONE                                                    |
 * | PARALLEL ALL          | ALL                                                        |
 * | PARALLEL MAJORITY     | COMMITTEE_VOTE when the only entry is a Committee, else ALL (Q7) |
 * | SEQUENTIAL            | ALL (what the engine already did)                          |
 * | COMMITTEE             | COMMITTEE_VOTE with exactly one Committee entry, else ANY_ONE |
 */
export function whoFromLegacy(
  stage: LegacyStageWho,
  /**
   * Whether the stage's record type can say what its unit is (RECORD_ROUTES).
   * Without a route "the record's unit" resolves to nobody, so an Org unit head
   * stage there starts on the tenant admin instead (Ahmad, 29 Oct).
   */
  recordHasUnitRoute: boolean,
): ConvertedWho {
  const notes: string[] = [];
  const entries: WhoEntryDraft[] = [];
  switch (stage.assigneeStrategy) {
    case 'SPECIFIC_USER':
      if (stage.assigneeUserId) entries.push({ kind: 'SPECIFIC_USER', userId: stage.assigneeUserId });
      else notes.push('Specific user with no user set: starting assignment');
      break;
    case 'POSITION_FIXED':
      if (stage.assigneePositionId && stage.assigneeOrgUnitId) {
        entries.push({ kind: 'POSITION_IN_UNIT', positionId: stage.assigneePositionId, orgUnitId: stage.assigneeOrgUnitId });
      } else {
        notes.push('Fixed position missing its position or unit: starting assignment');
      }
      break;
    case 'ORG_UNIT_HEAD':
      if (recordHasUnitRoute) entries.push({ kind: 'ORG_UNIT_HEAD', orgUnitId: null });
      else notes.push("Org unit head on a record type with no unit of its own yet: starting assignment");
      break;
    case 'SELF':
      entries.push({ kind: 'CREATOR' });
      break;
    case 'COMMITTEE':
      entries.push({ kind: 'COMMITTEE', committeeId: stage.committeeId, committeeRoleValueId: stage.assigneeCommitteeRoleValueId });
      break;
    case 'ROLE':
    case 'ROUND_ROBIN':
      break;
    default:
      notes.push(`Unknown strategy ${stage.assigneeStrategy}: starting assignment`);
  }

  const committeeEntries = entries.filter((e) => e.kind === 'COMMITTEE').length;
  let whoMode: StageWhoMode;
  switch (stage.approvalMode) {
    case 'SINGLE':
      whoMode = 'ANY_ONE';
      break;
    case 'PARALLEL':
      if (stage.parallelThreshold === 'ANY') whoMode = 'ANY_ONE';
      else if (stage.parallelThreshold === 'MAJORITY') {
        whoMode = committeeEntries === 1 && entries.length === 1 ? 'COMMITTEE_VOTE' : 'ALL';
        notes.push(`Majority became ${whoMode === 'ALL' ? 'All of them' : 'Committee vote'}`);
      } else whoMode = 'ALL';
      break;
    case 'SEQUENTIAL':
      whoMode = 'ALL';
      notes.push('Sequential became All of them');
      break;
    case 'COMMITTEE':
      whoMode = committeeEntries === 1 ? 'COMMITTEE_VOTE' : 'ANY_ONE';
      if (whoMode === 'ANY_ONE') notes.push('Committee approval with no single Committee entry became Any one of them');
      break;
    default:
      whoMode = 'ANY_ONE';
      notes.push(`Unknown approval mode ${stage.approvalMode}: Any one of them`);
  }
  return { whoMode, entries, startingAssignment: entries.length === 0, notes };
}

/** ACC-271 (§6.2) — the module's own moves are the app's; every other move a person's. */
export function moverForTrigger(triggerCondition: string): TransitionMover {
  return triggerCondition === 'SYSTEM_AUTOMATIC' ? 'APP' : 'PERSON';
}

/**
 * ACC-271 — a stage whose people decide together (All of them, Committee vote)
 * needs its forward move on the approval path, or the first press of it moves
 * the record at once (PR 1, §11.1).
 */
export function decidesTogether(whoMode: StageWhoMode): boolean {
  return whoMode === 'ALL' || whoMode === 'COMMITTEE_VOTE';
}

export type StartingAssignmentDb = Pick<
  Parameters<Parameters<import('../../prisma/prisma.service').PrismaService['$transaction']>[0]>[0],
  'workflowStage' | 'workflowStageAssignee'
>;

/**
 * ACC-271 — the starting assignment: a SPECIFIC_USER entry marked
 * `isStartingAssignment` on every CONVERTED stage of the organisation that has
 * no entry yet (what the seed marks). Two queries, whatever the count. A stage
 * that already has an entry is left alone, so running it again writes nothing.
 * Returns the stages it wrote.
 */
export async function writeStartingAssignments(
  db: StartingAssignmentDb,
  organizationId: string,
  adminUserId: string,
  createdById: string | null,
): Promise<{ stageIds: string[] }> {
  const stages = await db.workflowStage.findMany({
    where: { whoMode: { not: null }, workflowTemplate: { organizationId }, assignees: { none: {} } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  if (stages.length === 0) return { stageIds: [] };
  const data: Prisma.WorkflowStageAssigneeCreateManyInput[] = stages.map((s) => ({
    organizationId,
    stageId: s.id,
    order: 1,
    kind: 'SPECIFIC_USER',
    userId: adminUserId,
    isStartingAssignment: true,
    createdById,
  }));
  await db.workflowStageAssignee.createMany({ data });
  return { stageIds: stages.map((s) => s.id) };
}
