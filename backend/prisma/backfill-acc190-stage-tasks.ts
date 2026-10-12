/**
 * ACC-190 (CF-07) — existing tenants' seeded workflows, brought to the new
 * model. Plan: backend/Plans/step-190-stage-task-definitions.md §8.
 *
 *   npm run backfill:acc190-stage-tasks              # dry run — writes nothing
 *   npm run backfill:acc190-stage-tasks -- --execute # apply
 *
 * Run AFTER the deploy, dry run first. Two changes, per tenant:
 *
 * 1. Every CREATE_TASK action on a transition that the seed gave one is
 *    DELETED (Ahmad, 9 Oct, answer B). Its WorkflowActionLog rows are deleted
 *    first — the key is RESTRICT — because that history is test data, not real.
 *    Nothing is disabled. A CREATE_TASK the seed never placed is reported, not
 *    touched. The tasks those actions created are LEFT ALONE; the script never
 *    writes the Task table, and lists them so nobody wonders.
 * 2. Each seeded RETURN or EXIT transition gets its `kind` (ADVANCE is the
 *    column's default). A transition whose stages a tenant has renamed cannot
 *    be matched, so it is reported with "set its kind in workflow settings"
 *    rather than guessed.
 *
 * Transitions are matched as the seed itself matches them: by template object
 * type and the from/to stage names (`seedDefaultWorkflows()`).
 *
 * Each tenant's changes happen in ONE transaction that re-reads its scope and
 * refuses if the database changed since the dry run, and that transaction
 * writes one audit row to the tenant's own trail listing every action and log
 * row removed and every kind set (ACC-101: a vendor change to a tenant's
 * configuration is recorded in the tenant's record).
 *
 * CUSTOMER GUARD (ACC-101): these are tenant-editable configuration. Only the
 * seeded fixtures and no customer exist today; if a customer tenant would be
 * changed, --execute refuses and says so — that change becomes a
 * customer-notified one, never a silent script.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, WorkflowTransitionKind } from '../generated/prisma/client';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';
import { SYSTEM_WORKFLOW_SEED } from '../src/foundation/workflow/workflow.seed';

const SCRIPT_NAME = 'backfill-acc190-stage-tasks';
const TICKET = 'ACC-190';
const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

// One tenant's transaction is the re-plan plus about fifty writes, each a round
// trip to the database. Prisma's default 5-second timeout is not enough from a
// client far from it: on 10 Oct al-nakheel's ran 5.3 seconds and rolled back
// (al-manara, one write fewer, fitted). Same shape as the engine's
// STAGE_CHANGE_TX, with room for the whole tenant.
const BACKFILL_TX = { maxWait: 10_000, timeout: 120_000 } as const;

// The 26 transitions the seed gave a CREATE_TASK action until ACC-190, as
// [objectType, fromStageKey, toStageKey]. The seed no longer carries them, so
// they are listed here; the stage NAMES are read from the seed.
const SEEDED_CREATE_TASK: readonly [string, string, string][] = [
  ['DOCUMENT_REQUEST', 'submitted', 'unit_manager_review'],
  ['DOCUMENT_REQUEST', 'unit_manager_review', 'quality_review'],
  ['DOCUMENT', 'drafting', 'owners_review'],
  ['DOCUMENT', 'owners_review', 'stakeholders_review'],
  ['DOCUMENT', 'stakeholders_review', 'final_approval'],
  ['DOCUMENT', 'final_approval', 'publish_approval'],
  ['INCIDENT', 'reported', 'investigating'],
  ['INCIDENT', 'investigating', 'root_cause_identified'],
  ['AUDIT', 'planning', 'announced'],
  ['AUDIT', 'announced', 'fieldwork'],
  ['AUDIT', 'fieldwork', 'findings_draft'],
  ['AUDIT', 'auditee_response', 'report_review'],
  ['AUDIT', 'report_review', 'report_approved'],
  ['AUDIT', 'corrective_action', 'verification'],
  ['CORRECTIVE_ACTION', 'detection', 'investigation'],
  ['CORRECTIVE_ACTION', 'investigation', 'root_cause_approved'],
  ['CORRECTIVE_ACTION', 'root_cause_approved', 'action_planning'],
  ['CORRECTIVE_ACTION', 'action_planning', 'plan_approved'],
  ['CORRECTIVE_ACTION', 'plan_approved', 'implementation'],
  ['CORRECTIVE_ACTION', 'implementation', 'implementation_verified'],
  ['CORRECTIVE_ACTION', 'implementation_verified', 'effectiveness_check'],
  ['CORRECTIVE_ACTION', 'effectiveness_check', 'effectiveness_approved'],
  ['MEETING', 'minutes_review', 'minutes_approved'],
  ['COMMITTEE', 'formation', 'terms_review'],
  ['CHANGE_REQUEST', 'submitted', 'unit_manager_review'],
  ['CHANGE_REQUEST', 'unit_manager_review', 'quality_review'],
];

interface SeededPair {
  objectType: string;
  fromName: string;
  toName: string;
}

function stageName(objectType: string, key: string): string {
  const workflow = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === objectType);
  const stage = workflow?.stages.find((s) => s.key === key);
  if (!stage) throw new Error(`Seed has no stage ${objectType}.${key}`);
  return stage.nameEn;
}

const CREATE_TASK_PAIRS: SeededPair[] = SEEDED_CREATE_TASK.map(([objectType, from, to]) => ({
  objectType,
  fromName: stageName(objectType, from),
  toName: stageName(objectType, to),
}));

const KIND_PAIRS: (SeededPair & { kind: WorkflowTransitionKind; label: string })[] = SYSTEM_WORKFLOW_SEED.flatMap((w) =>
  w.transitions
    .filter((t) => t.kind && t.kind !== 'ADVANCE')
    .map((t) => ({
      objectType: w.objectType,
      fromName: stageName(w.objectType, t.fromStageKey),
      toName: stageName(w.objectType, t.toStageKey),
      kind: t.kind as WorkflowTransitionKind,
      label: t.labelEn,
    })),
);

interface ActionPlan {
  actionId: string;
  transitionId: string;
  objectType: string;
  from: string;
  to: string;
  logs: { id: string; workflowInstanceId: string; status: string; executedAt: Date }[];
  toStageId: string;
}

interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  deleteActions: ActionPlan[];
  reportOnlyActions: { actionId: string; objectType: string; from: string; to: string; label: string }[];
  setKinds: { transitionId: string; objectType: string; from: string; to: string; label: string; before: string; after: WorkflowTransitionKind }[];
  kindsAlreadySet: number;
  unmatchedKinds: { objectType: string; from: string; to: string; kind: string }[];
  tasksThatStay: { id: string; title: string; status: string; createdAt: Date }[];
}

const pairKey = (objectType: string, from: string, to: string) => `${objectType}|${from}|${to}`;

async function planOrg(prisma: PrismaClient, org: { id: string; slug: string; customer: boolean }): Promise<OrgPlan> {
  const transitions = await prisma.workflowTransition.findMany({
    where: { fromStage: { workflowTemplate: { organizationId: org.id } } },
    select: {
      id: true,
      labelEn: true,
      kind: true,
      toStageId: true,
      fromStage: { select: { nameEn: true, workflowTemplate: { select: { objectType: true } } } },
      toStage: { select: { nameEn: true } },
      actions: {
        where: { actionType: 'CREATE_TASK' },
        select: {
          id: true,
          actionLogs: { select: { id: true, workflowInstanceId: true, status: true, executedAt: true } },
        },
      },
    },
  });
  const byPair = new Map<string, typeof transitions>();
  for (const t of transitions) {
    const key = pairKey(t.fromStage.workflowTemplate.objectType, t.fromStage.nameEn, t.toStage.nameEn);
    byPair.set(key, [...(byPair.get(key) ?? []), t]);
  }

  const seededCreateTask = new Set(CREATE_TASK_PAIRS.map((p) => pairKey(p.objectType, p.fromName, p.toName)));
  const plan: OrgPlan = {
    organizationId: org.id,
    slug: org.slug,
    customer: org.customer,
    deleteActions: [],
    reportOnlyActions: [],
    setKinds: [],
    kindsAlreadySet: 0,
    unmatchedKinds: [],
    tasksThatStay: [],
  };

  for (const t of transitions) {
    const objectType = t.fromStage.workflowTemplate.objectType;
    const seeded = seededCreateTask.has(pairKey(objectType, t.fromStage.nameEn, t.toStage.nameEn));
    for (const action of t.actions) {
      if (seeded) {
        plan.deleteActions.push({
          actionId: action.id,
          transitionId: t.id,
          objectType,
          from: t.fromStage.nameEn,
          to: t.toStage.nameEn,
          logs: action.actionLogs,
          toStageId: t.toStageId,
        });
      } else {
        plan.reportOnlyActions.push({ actionId: action.id, objectType, from: t.fromStage.nameEn, to: t.toStage.nameEn, label: t.labelEn });
      }
    }
  }

  for (const pair of KIND_PAIRS) {
    const matches = byPair.get(pairKey(pair.objectType, pair.fromName, pair.toName)) ?? [];
    if (matches.length === 0) {
      plan.unmatchedKinds.push({ objectType: pair.objectType, from: pair.fromName, to: pair.toName, kind: pair.kind });
      continue;
    }
    for (const t of matches) {
      if (t.kind === pair.kind) {
        plan.kindsAlreadySet++;
      } else {
        plan.setKinds.push({ transitionId: t.id, objectType: pair.objectType, from: pair.fromName, to: pair.toName, label: t.labelEn, before: t.kind, after: pair.kind });
      }
    }
  }

  // The tasks the actions to be deleted created: the instances their logs
  // name, at the stage the action's transition led to, with no stage entry
  // (a stage-definition task always has one). They stay.
  for (const action of plan.deleteActions) {
    const instanceIds = [...new Set(action.logs.map((l) => l.workflowInstanceId))];
    if (instanceIds.length === 0) continue;
    const tasks = await prisma.task.findMany({
      where: {
        organizationId: org.id,
        workflowInstanceId: { in: instanceIds },
        sourceStageId: action.toStageId,
        workflowInstanceStageId: null,
      },
      select: { id: true, title: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    plan.tasksThatStay.push(...tasks);
  }
  return plan;
}

function printPlan(plan: OrgPlan): void {
  const logRows = plan.deleteActions.reduce((n, a) => n + a.logs.length, 0);
  console.log(`\n── ${plan.slug}${plan.customer ? '  (CUSTOMER TENANT)' : ''}`);
  console.log(`  CREATE_TASK actions to DELETE: ${plan.deleteActions.length}, with ${logRows} WorkflowActionLog row(s) deleted first`);
  for (const a of plan.deleteActions) {
    const logs = a.logs.map((l) => `log ${l.id} ${l.status} ${l.executedAt.toISOString()}`).join('; ');
    console.log(`    ${a.objectType.padEnd(18)} ${a.from} → ${a.to}   action ${a.actionId}${logs ? `   [${logs}]` : ''}`);
  }
  if (plan.reportOnlyActions.length > 0) {
    console.log(`  CREATE_TASK actions NOT seeded — reported, not touched: ${plan.reportOnlyActions.length}`);
    for (const a of plan.reportOnlyActions) console.log(`    ${a.objectType.padEnd(18)} ${a.from} → ${a.to} ("${a.label}")   action ${a.actionId}`);
  }
  console.log(`  Transition kinds to SET: ${plan.setKinds.length} (already set: ${plan.kindsAlreadySet})`);
  for (const k of plan.setKinds) console.log(`    ${k.objectType.padEnd(18)} ${k.from} → ${k.to} ("${k.label}")   ${k.before} → ${k.after}`);
  if (plan.unmatchedKinds.length > 0) {
    console.log(`  Seeded RETURN/EXIT transitions NOT found (stage renamed or removed) — set their kind in workflow settings: ${plan.unmatchedKinds.length}`);
    for (const k of plan.unmatchedKinds) console.log(`    ${k.objectType.padEnd(18)} ${k.from} → ${k.to}   should be ${k.kind}`);
  }
  console.log(`  Tasks the deleted actions created — they STAY: ${plan.tasksThatStay.length}`);
  for (const t of plan.tasksThatStay) console.log(`    task ${t.id}  ${t.status.padEnd(10)} ${t.createdAt.toISOString()}  "${t.title}"`);
}

const hasChanges = (plan: OrgPlan) => plan.deleteActions.length > 0 || plan.setKinds.length > 0;

async function main(): Promise<void> {
  const execute = process.argv.includes('--execute');
  const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    console.log(`\n${execute ? 'EXECUTE' : 'DRY RUN'} — retiring seeded CREATE_TASK actions and setting transition kinds (${TICKET})`);
    const organizations = await prisma.organization.findMany({
      where: { isPlatformOrg: false },
      select: { id: true, slug: true },
      orderBy: { slug: 'asc' },
    });

    const plans: OrgPlan[] = [];
    for (const org of organizations) {
      plans.push(await planOrg(prisma, { ...org, customer: !FIXTURE_SLUGS.has(org.slug) }));
    }
    plans.forEach(printPlan);

    const totals = plans.reduce(
      (t, p) => ({
        actions: t.actions + p.deleteActions.length,
        logs: t.logs + p.deleteActions.reduce((n, a) => n + a.logs.length, 0),
        kinds: t.kinds + p.setKinds.length,
      }),
      { actions: 0, logs: 0, kinds: 0 },
    );
    console.log(`\nTotal: ${totals.actions} action(s) and ${totals.logs} log row(s) to delete, ${totals.kinds} kind(s) to set.`);

    const work = plans.filter(hasChanges);
    if (work.length === 0) {
      console.log('\nNothing to change — already done.\n');
      return;
    }
    const customers = work.filter((p) => p.customer);
    if (customers.length > 0) {
      console.log(`\nREFUSED: ${customers.map((p) => p.slug).join(', ')} ${customers.length === 1 ? 'is a customer tenant' : 'are customer tenants'}.`);
      console.log('Changing a customer\'s workflow configuration is a customer-notified change, not a script (ACC-101).\n');
      process.exitCode = 1;
      return;
    }
    if (!execute) {
      console.log('\nDry run only — re-run with --execute to apply.\n');
      return;
    }

    for (const plan of work) {
      await prisma.$transaction(async (tx) => {
        // Re-read the scope inside the transaction: anything different from
        // the dry run means it no longer describes this database.
        const now = await planOrg(tx as unknown as PrismaClient, { id: plan.organizationId, slug: plan.slug, customer: plan.customer });
        const same =
          JSON.stringify(now.deleteActions.map((a) => [a.actionId, a.logs.map((l) => l.id)])) ===
            JSON.stringify(plan.deleteActions.map((a) => [a.actionId, a.logs.map((l) => l.id)])) &&
          JSON.stringify(now.setKinds.map((k) => [k.transitionId, k.after])) === JSON.stringify(plan.setKinds.map((k) => [k.transitionId, k.after]));
        if (!same) throw new Error(`The database changed since the dry run for ${plan.slug} — re-run the dry run.`);

        const logIds = plan.deleteActions.flatMap((a) => a.logs.map((l) => l.id));
        if (logIds.length > 0) {
          const deleted = await tx.workflowActionLog.deleteMany({ where: { id: { in: logIds }, organizationId: plan.organizationId } });
          if (deleted.count !== logIds.length) throw new Error(`Expected to delete ${logIds.length} log row(s) in ${plan.slug}, deleted ${deleted.count}`);
        }
        const actionIds = plan.deleteActions.map((a) => a.actionId);
        if (actionIds.length > 0) {
          const deleted = await tx.workflowTransitionAction.deleteMany({ where: { id: { in: actionIds }, actionType: 'CREATE_TASK' } });
          if (deleted.count !== actionIds.length) throw new Error(`Expected to delete ${actionIds.length} action(s) in ${plan.slug}, deleted ${deleted.count}`);
        }
        for (const k of plan.setKinds) {
          await tx.workflowTransition.update({ where: { id: k.transitionId }, data: { kind: k.after } });
        }

        await tx.auditLog.create({
          data: {
            organizationId: plan.organizationId,
            actorId: null,
            action: 'UPDATE',
            objectType: 'WorkflowTemplate',
            objectId: null,
            before: {
              createTaskActions: plan.deleteActions.map((a) => ({
                actionId: a.actionId,
                transitionId: a.transitionId,
                objectType: a.objectType,
                from: a.from,
                to: a.to,
                actionLogs: a.logs.map((l) => ({ id: l.id, workflowInstanceId: l.workflowInstanceId, status: l.status, executedAt: l.executedAt.toISOString() })),
              })),
              transitionKinds: plan.setKinds.map((k) => ({ transitionId: k.transitionId, kind: k.before })),
            },
            after: {
              createTaskActions: [],
              transitionKinds: plan.setKinds.map((k) => ({ transitionId: k.transitionId, kind: k.after })),
            },
            metadata: {
              source: SCRIPT_NAME,
              ticket: TICKET,
              reason: 'CREATE_TASK retired: tasks now come from stage task definitions; their test-data logs removed with them (Ahmad, 9 Oct). Seeded return and exit transitions given their kind.',
              tasksLeftAlone: plan.tasksThatStay.map((t) => t.id),
              unmatchedKinds: plan.unmatchedKinds,
            },
          },
        });
      }, BACKFILL_TX);
      console.log(`  ${plan.slug}: deleted ${plan.deleteActions.length} action(s), ${plan.deleteActions.reduce((n, a) => n + a.logs.length, 0)} log row(s); set ${plan.setKinds.length} kind(s); 1 audit row.`);
    }
    console.log('\nDone.\n');
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

// Run only when executed as a script, so the spec can import the planning.
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

export { planOrg, CREATE_TASK_PAIRS, KIND_PAIRS };
