/**
 * ACC-271 PR 2 — converts every existing workflow stage to the stage's own
 * "who" (plan §6.1, §6.3, §6.4; Ahmad's answers of 28 Oct). Plan:
 * backend/Plans/step-271-stage-owns-who.md.
 *
 *   npm run backfill:acc271-stage-assignees              # dry run — writes nothing
 *   npm run backfill:acc271-stage-assignees -- --execute # apply
 *   npm run backfill:acc271-stage-assignees              # again: must report 0
 *
 * Runs AFTER PR 2 deploys, never before: the deployed engine must know how to
 * read a converted stage (PR 1 does), and the record page must take its moves
 * from the server (PR 2 does) before any stage is converted.
 *
 * WHAT IT CHANGES, per non-platform organisation, on every stage with no
 * whoMode yet (whoFromLegacy() is the mapping, in one place):
 *   - the stage's whoMode, and its entries: SELF → Creator, ORG_UNIT_HEAD → the
 *     head of the record's unit where the record type has a unit route
 *     (RECORD_ROUTES), else the starting assignment as for a new organisation
 *     (Ahmad, 29 Oct), a set user / position / committee → itself,
 *     ROLE and ROUND_ROBIN → the tenant admin's starting assignment (the
 *     organisation's earliest-assigned ACTIVE TENANT_ADMIN holder);
 *   - the forward move of a stage now decided by All of them or Committee vote
 *     goes on its approval path, if it is the stage's only forward move and
 *     not there yet (PR 1, §11.1);
 *   - LIVE RECORDS (Q8, as Ahmad changed it — a development environment): on
 *     an open entry of a converted stage, any approval already given is
 *     removed and any open task of the stage is cancelled, counted and
 *     reported rather than refused. Workflows and records are not cleared.
 *
 * Refuses: a customer organisation (ACC-101), a plan whose counts differ from
 * §6.4's expected ones, a stage with several forward moves none of them on
 * the approval path, and an organisation with no ACTIVE tenant admin when a
 * starting assignment is needed. One transaction per organisation
 * (BACKFILL_TX) under the organisation's template row locks, which plans again
 * and refuses a moved plan; ONE audit row per organisation in its own trail.
 * Reads in batches — no query inside a row loop.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import type { StageAssigneeKind, StageWhoMode } from '../generated/prisma/client';
import { decidesTogether, whoFromLegacy, type WhoEntryDraft } from '../src/foundation/workflow/workflow-who';
import { RECORD_ROUTES } from '../src/foundation/workflow/stage-task-record-routes';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc271-stage-assignees';
export const TICKET = 'ACC-271';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);
const OPEN_TASK = { notIn: ['COMPLETED', 'CANCELLED'] as ('COMPLETED' | 'CANCELLED')[] };

/** The counts a plan is compared with. */
export interface StageCounts {
  stages: number;
  startingAssignments: number;
  entries: Record<StageAssigneeKind, number>;
  modes: Record<StageWhoMode, number>;
  approvalPathMarks: number;
  approvalsReset: number;
  tasksCancelled: number;
}

const zeroEntries = (): Record<StageAssigneeKind, number> => ({
  SPECIFIC_USER: 0,
  POSITION_IN_UNIT: 0,
  ORG_UNIT_HEAD: 0,
  CREATOR: 0,
  COMMITTEE: 0,
});

/**
 * Plan §6.4: both fixture organisations, measured 28 Oct. The 2 Org unit head
 * stages (Unit Manager Review, on document requests and change requests) have
 * no unit route, so they start on the tenant admin with the 46 Role stages.
 */
const SECTION_6_4: StageCounts = {
  stages: 60,
  startingAssignments: 48,
  entries: { ...zeroEntries(), CREATOR: 12 },
  modes: { ANY_ONE: 56, ALL: 4, COMMITTEE_VOTE: 0 },
  approvalPathMarks: 0,
  approvalsReset: 0,
  tasksCancelled: 0,
};
export const EXPECTED: Readonly<Record<string, StageCounts>> = {
  [HOSPITAL_FIXTURE.slug]: SECTION_6_4,
  [UNIVERSITY_FIXTURE.slug]: SECTION_6_4,
};

export interface StagePlan {
  stageId: string;
  templateId: string;
  nameEn: string;
  whoMode: StageWhoMode;
  entries: WhoEntryDraft[];
  startingAssignment: boolean;
  notes: string[];
  /** The forward move to put on the approval path, if any. */
  markApprovalPath: string | null;
}

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  adminUserId: string | null;
  stages: StagePlan[];
  approvalIdsToReset: string[];
  taskIdsToCancel: string[];
  counts: StageCounts;
  /** Why this organisation cannot be converted as it stands, if it cannot. */
  problems: string[];
}

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; counts: StageCounts }[];
  refused: { slug: string; reason: string }[];
}

type Db = Pick<PrismaService, 'workflowStage' | 'userRole' | 'workflowInstanceStage' | 'workflowApproval' | 'task'>;

/** One organisation's unconverted stages and what converting them takes. Five reads, whatever the size. */
export async function planOrganization(db: Db, organizationId: string): Promise<Omit<OrgPlan, 'organizationId' | 'slug' | 'customer'>> {
  const [rows, admin] = await Promise.all([
    db.workflowStage.findMany({
      where: { whoMode: null, workflowTemplate: { organizationId } },
      select: {
        id: true,
        workflowTemplateId: true,
        workflowTemplate: { select: { objectType: true } },
        nameEn: true,
        assigneeStrategy: true,
        approvalMode: true,
        parallelThreshold: true,
        assigneeUserId: true,
        assigneePositionId: true,
        assigneeOrgUnitId: true,
        committeeId: true,
        assigneeCommitteeRoleValueId: true,
        transitionsFrom: { where: { kind: 'ADVANCE' }, select: { id: true, isApprovalPath: true }, orderBy: { id: 'asc' } },
      },
      orderBy: { id: 'asc' },
    }),
    // "The tenant admin": the earliest-assigned ACTIVE holder of the root role.
    db.userRole.findFirst({
      where: { role: { organizationId, key: 'TENANT_ADMIN', isActive: true }, user: { organizationId, status: 'ACTIVE' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { userId: true },
    }),
  ]);

  const problems: string[] = [];
  const counts: StageCounts = {
    stages: rows.length,
    startingAssignments: 0,
    entries: zeroEntries(),
    modes: { ANY_ONE: 0, ALL: 0, COMMITTEE_VOTE: 0 },
    approvalPathMarks: 0,
    approvalsReset: 0,
    tasksCancelled: 0,
  };
  const stages: StagePlan[] = rows.map((row) => {
    const who = whoFromLegacy(row, RECORD_ROUTES[row.workflowTemplate.objectType] !== undefined);
    let markApprovalPath: string | null = null;
    if (decidesTogether(who.whoMode) && !row.transitionsFrom.some((t) => t.isApprovalPath)) {
      if (row.transitionsFrom.length === 1) markApprovalPath = row.transitionsFrom[0]!.id;
      else if (row.transitionsFrom.length > 1) {
        problems.push(`"${row.nameEn}" decides together but has ${row.transitionsFrom.length} forward moves and none on the approval path`);
      }
    }
    counts.modes[who.whoMode]++;
    if (who.startingAssignment) counts.startingAssignments++;
    for (const e of who.entries) counts.entries[e.kind]++;
    if (markApprovalPath) counts.approvalPathMarks++;
    return {
      stageId: row.id,
      templateId: row.workflowTemplateId,
      nameEn: row.nameEn,
      whoMode: who.whoMode,
      entries: who.entries,
      startingAssignment: who.startingAssignment,
      notes: who.notes,
      markApprovalPath,
    };
  });
  if (counts.startingAssignments > 0 && !admin) problems.push('no ACTIVE tenant admin to start the stages on');

  // Live records on the stages being converted: what is in flight there.
  const stageIds = stages.map((s) => s.stageId);
  const openEntries =
    stageIds.length === 0
      ? []
      : await db.workflowInstanceStage.findMany({
          where: { exitedAt: null, stageId: { in: stageIds }, workflowInstance: { organizationId } },
          select: { id: true, stageId: true, workflowInstanceId: true },
        });
  const entryIds = openEntries.map((e) => e.id);
  const [approvals, tasks] = await Promise.all([
    entryIds.length === 0
      ? Promise.resolve([] as { id: string }[])
      : db.workflowApproval.findMany({ where: { workflowInstanceStageId: { in: entryIds } }, select: { id: true }, orderBy: { id: 'asc' } }),
    openEntries.length === 0
      ? Promise.resolve([] as { id: string }[])
      : db.task.findMany({
          where: {
            organizationId,
            status: OPEN_TASK,
            OR: [
              { workflowInstanceStageId: { in: entryIds } },
              // A stage task made before ACC-190 knows its stage, not its entry.
              ...openEntries.map((e) => ({ workflowInstanceStageId: null, workflowInstanceId: e.workflowInstanceId, sourceStageId: e.stageId })),
            ],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
        }),
  ]);
  counts.approvalsReset = approvals.length;
  counts.tasksCancelled = tasks.length;
  return {
    adminUserId: admin?.userId ?? null,
    stages,
    approvalIdsToReset: approvals.map((a) => a.id),
    taskIdsToCancel: tasks.map((t) => t.id),
    counts,
    problems,
  };
}

export async function planBackfill(
  prisma: PrismaService,
  organizationIds?: readonly string[],
  isFixture: (slug: string) => boolean = (slug) => FIXTURE_SLUGS.has(slug),
): Promise<OrgPlan[]> {
  const orgs = await prisma.organization.findMany({
    where: { isPlatformOrg: false, ...(organizationIds && { id: { in: [...organizationIds] } }) },
    select: { id: true, slug: true },
    orderBy: { slug: 'asc' },
  });
  const plans: OrgPlan[] = [];
  for (const org of orgs) {
    plans.push({ organizationId: org.id, slug: org.slug, customer: !isFixture(org.slug), ...(await planOrganization(prisma, org.id)) });
  }
  return plans;
}

const sameCounts = (a: StageCounts, b: StageCounts): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The whole run, minus the printing. `organizationIds`, `isFixture` and
 * `expected` stand in for the real organisations, fixture list and §6.4 counts
 * in the spec, which seeds its own organisations.
 */
export async function runBackfill(
  prisma: PrismaService,
  options: {
    execute: boolean;
    organizationIds?: readonly string[];
    isFixture?: (slug: string) => boolean;
    expected?: Readonly<Record<string, StageCounts>>;
  },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const expected = options.expected ?? EXPECTED;
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refused: [] };
  const work = plans.filter((p) => p.stages.length > 0);
  for (const plan of work) {
    if (plan.customer) result.refused.push({ slug: plan.slug, reason: 'a customer organisation (ACC-101)' });
    else if (plan.problems.length > 0) result.refused.push({ slug: plan.slug, reason: plan.problems.join('; ') });
    else if (!expected[plan.slug]) result.refused.push({ slug: plan.slug, reason: 'no expected counts for this organisation (plan §6.4)' });
    else if (!sameCounts(plan.counts, expected[plan.slug]!)) {
      result.refused.push({ slug: plan.slug, reason: `counts differ from plan §6.4: planned ${JSON.stringify(plan.counts)}` });
    }
  }
  if (!options.execute || work.length === 0 || result.refused.length > 0) return result;

  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      // The organisation's templates, locked, so no stage editor or second run moves under us.
      await tx.$queryRaw`SELECT id FROM "WorkflowTemplate" WHERE "organizationId" = ${plan.organizationId} ORDER BY id FOR UPDATE`;
      // Again, inside the transaction: refuse rather than act on a stale plan.
      const now = await planOrganization(tx, plan.organizationId);
      if (
        JSON.stringify(now.stages.map((s) => s.stageId)) !== JSON.stringify(plan.stages.map((s) => s.stageId)) ||
        !sameCounts(now.counts, plan.counts)
      ) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      const adminUserId = now.adminUserId;

      for (const mode of ['ANY_ONE', 'ALL', 'COMMITTEE_VOTE'] as const) {
        const ids = now.stages.filter((s) => s.whoMode === mode).map((s) => s.stageId);
        if (ids.length > 0) await tx.workflowStage.updateMany({ where: { id: { in: ids }, whoMode: null }, data: { whoMode: mode } });
      }
      const entries = now.stages.flatMap((s) =>
        s.startingAssignment
          ? [{ organizationId: plan.organizationId, stageId: s.stageId, order: 1, kind: 'SPECIFIC_USER' as const, userId: adminUserId, isStartingAssignment: true }]
          : s.entries.map((e, i) => ({ organizationId: plan.organizationId, stageId: s.stageId, order: i + 1, ...e })),
      );
      if (entries.length > 0) await tx.workflowStageAssignee.createMany({ data: entries });
      const marks = now.stages.map((s) => s.markApprovalPath).filter((id): id is string => id !== null);
      if (marks.length > 0) await tx.workflowTransition.updateMany({ where: { id: { in: marks } }, data: { isApprovalPath: true } });
      if (now.approvalIdsToReset.length > 0) await tx.workflowApproval.deleteMany({ where: { id: { in: now.approvalIdsToReset } } });
      if (now.taskIdsToCancel.length > 0) {
        await tx.task.updateMany({
          where: { id: { in: now.taskIdsToCancel }, organizationId: plan.organizationId, status: OPEN_TASK },
          data: { status: 'CANCELLED', cancelledAt: new Date() },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: plan.organizationId,
          before: { unconvertedStages: now.counts.stages },
          after: { counts: JSON.parse(JSON.stringify(now.counts)) as object, startingAssignmentUserId: adminUserId },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason:
              "Each workflow stage now says who works it (ACC-271): its own entries and how they decide, converted from the old assignee strategy and approval mode. Stages on a role start on the tenant admin. In-flight approvals and open stage tasks on converted stages are reset.",
            notes: now.stages.flatMap((s) => s.notes.map((n) => `${s.nameEn}: ${n}`)),
            approvalPathMarked: marks,
            approvalsReset: now.approvalIdsToReset.length,
            tasksCancelled: now.taskIdsToCancel,
          },
        },
      });
      result.changed.push({ slug: plan.slug, counts: now.counts });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — who works each workflow stage (${TICKET})`);
  for (const p of result.plans) {
    const c = p.counts;
    console.log(
      `  ${p.slug.padEnd(24)} ${c.stages} stage(s) to convert${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}\n` +
        `      who mode: Any one ${c.modes.ANY_ONE}, All ${c.modes.ALL}, Committee vote ${c.modes.COMMITTEE_VOTE}\n` +
        `      entries: Creator ${c.entries.CREATOR}, Org unit head ${c.entries.ORG_UNIT_HEAD}, Specific user ${c.entries.SPECIFIC_USER}, ` +
        `Fixed position ${c.entries.POSITION_IN_UNIT}, Committee ${c.entries.COMMITTEE}; starting assignments ${c.startingAssignments}\n` +
        `      approval path marked ${c.approvalPathMarks}; in flight: approvals to reset ${c.approvalsReset}, open stage tasks to cancel ${c.tasksCancelled}`,
    );
    for (const s of p.stages) for (const n of s.notes) console.log(`      note: "${s.nameEn}" — ${n}`);
    for (const problem of p.problems) console.log(`      PROBLEM: ${problem}`);
  }
  const total = result.plans.reduce((n, p) => n + p.counts.stages, 0);
  console.log(`\nTotal: ${total} stage(s) to convert.`);
  if (result.refused.length > 0) {
    for (const r of result.refused) console.log(`REFUSED: ${r.slug} — ${r.reason}`);
    console.log('');
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.counts.stages} stage(s) converted; 1 audit row.`);
    console.log(total === 0 ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must report 0.\n');
  } else {
    console.log(total === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const result = await runBackfill(prisma, { execute: process.argv.includes('--execute') });
    report(result);
    if (result.refused.length > 0) process.exitCode = 1;
  } finally {
    await prisma.onModuleDestroy();
  }
}

// Run only when executed as a script, so the spec can import it.
if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
