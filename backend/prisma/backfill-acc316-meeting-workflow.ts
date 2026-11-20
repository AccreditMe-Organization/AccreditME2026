/**
 * ACC-316 PR 2 — existing organisations' Meeting workflow becomes the decided
 * one (plan backend/Plans/step-316-meeting-management.md §3.8), and their
 * committees' In force stages allow scheduling a meeting. New organisations
 * get both from the seed.
 *
 *   npm run backfill:acc316-meeting-workflow              # dry run — writes nothing
 *   npm run backfill:acc316-meeting-workflow -- --execute # apply
 *   npm run backfill:acc316-meeting-workflow              # again: must report 0
 *
 * Runs ONCE, AFTER PR 3a deploys, with the other two ACC-316 backfills (lane B,
 * Prompt 139); not before PR 2, since the pool kinds must be resolvable when a
 * stage names them.
 *
 * KEYS FIRST. MEETING became a keyed template in PR 2 (its app moves are found
 * by stage key). Existing meeting stages have none, so a stage is found by its
 * key if it has one, else by the old seed's English name in the organisation's
 * default MEETING template, and given the seed's key while it has none (and no
 * other stage of the template holds it).
 *
 * ONLY WHERE STILL THE SEED'S. Each change is made only while the value is
 * still what the old seed wrote:
 *   - "Agenda Ready" is renamed "Agenda Issued" (both languages) only while
 *     both names are the old seed's;
 *   - who works Planned, Agenda Ready and Minutes Draft is replaced only while
 *     it is the old seed's single CREATOR entry, and Minutes Review's only
 *     while every entry is a starting assignment (or there is none);
 *   - record actions are written only on a stage that has none, flags only on
 *     a stage that has none;
 *   - "Prepare Agenda" is relabelled only while both labels are the old
 *     seed's; Distribute Minutes and Return for Correction become the app's
 *     moves only while they are still the person's;
 *   - the old draft-to-draft "Return for Correction" is deleted, with its
 *     transition actions, unless an action log or a vote refers to it (then it
 *     is reported and left);
 *   - a committee stage flagged IN_FORCE that does not allow schedule_meeting
 *     gains it.
 * Anything not still the seed's is reported and left alone.
 *
 * Refuses a customer organisation with anything to change (ACC-101). ONE
 * transaction per organisation (BACKFILL_TX) that locks the two templates,
 * plans again and refuses a moved plan, and ONE audit row per organisation
 * changed. Idempotent: a second run plans nothing.
 */
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { COMMITTEE_ACTIONS, STAGE_FLAG } from '../src/foundation/workflow/record-registry';
import { SYSTEM_WORKFLOW_SEED, type SeedStage } from '../src/foundation/workflow/workflow.seed';
import { HOSPITAL_FIXTURE } from './seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from './seed/fixtures/university.fixture';

export const SCRIPT_NAME = 'backfill-acc316-meeting-workflow';
export const TICKET = 'ACC-316';
export const BACKFILL_TX = { maxWait: 10_000, timeout: 60_000 } as const;

const FIXTURE_SLUGS = new Set([HOSPITAL_FIXTURE.slug, UNIVERSITY_FIXTURE.slug]);

const MEETING_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'MEETING')!;
const seedStage = (key: string): SeedStage => MEETING_SEED.stages.find((s) => s.key === key)!;

/** The old seed's stage names, by the seed key that wires the new one. */
export const OLD_STAGE_NAMES: Readonly<Record<string, string>> = {
  planned: 'Planned',
  agenda_ready: 'Agenda Ready',
  minutes_draft: 'Minutes Draft',
  minutes_review: 'Minutes Review',
  minutes_approved: 'Minutes Approved',
  cancelled: 'Cancelled',
};
const OLD_AGENDA = { nameEn: 'Agenda Ready', nameAr: 'الأجندة جاهزة' };
const OLD_PREPARE = { labelEn: 'Prepare Agenda', labelAr: 'إعداد الأجندة' };
/** The stages whose who the old seed made a single CREATOR entry. */
const OLD_CREATOR_STAGES = ['planned', 'agenda_ready', 'minutes_draft'];

export interface OrgPlan {
  organizationId: string;
  slug: string;
  customer: boolean;
  meetingTemplateId: string | null;
  committeeTemplateId: string | null;
  changes: string[];
  left: string[];
  /** The work, in a form apply() follows. */
  ops: Op[];
}

type Op =
  | { op: 'setKey'; stageId: string; key: string }
  | { op: 'renameStage'; stageId: string; nameEn: string; nameAr: string }
  | { op: 'setWho'; stageId: string; stageKey: string }
  | { op: 'addActions'; stageId: string; actions: string[] }
  | { op: 'setFlags'; stageId: string; flags: string[] }
  | { op: 'relabel'; transitionId: string; labelEn: string; labelAr: string }
  | { op: 'appMover'; transitionId: string }
  | { op: 'deleteTransition'; transitionId: string };

export interface BackfillResult {
  execute: boolean;
  plans: OrgPlan[];
  changed: { slug: string; changes: number }[];
  refusedCustomers: string[];
}

/**
 * Whether a stage's stored assignees already are the seed's entries, kind by
 * kind in the seed's order. Sorted by `order` HERE, never trusting the order
 * rows were read in: Postgres guarantees none without ORDER BY, and on CI
 * (18 Nov) Minutes Review's two entries came back second-first, so a second
 * dry run called them configured. Pure, so the spec can hand it reversed rows.
 */
export function whoIsAlreadyTheSeeds(
  assignees: readonly { kind: string; order: number }[],
  entries: readonly { kind: string }[],
): boolean {
  const stored = [...assignees].sort((a, b) => a.order - b.order);
  return stored.length === entries.length && stored.every((a, i) => a.kind === entries[i]?.kind);
}

type Db = Pick<
  PrismaService,
  'workflowTemplate' | 'workflowStage' | 'workflowTransition' | 'workflowStageAssignee' | 'workflowStageRecordAction' | 'workflowActionLog' | 'workflowApproval'
>;

/** What changing one organisation would do, read with `db` (the client, or a transaction). */
export async function planOrg(db: Db, organizationId: string): Promise<Pick<OrgPlan, 'meetingTemplateId' | 'committeeTemplateId' | 'changes' | 'left' | 'ops'>> {
  const out: Pick<OrgPlan, 'meetingTemplateId' | 'committeeTemplateId' | 'changes' | 'left' | 'ops'> = {
    meetingTemplateId: null,
    committeeTemplateId: null,
    changes: [],
    left: [],
    ops: [],
  };
  const [meeting, committee] = await Promise.all(
    (['MEETING', 'COMMITTEE'] as const).map((objectType) =>
      db.workflowTemplate.findFirst({
        where: { organizationId, objectType, isDefault: true },
        select: {
          id: true,
          stages: {
            select: {
              id: true,
              key: true,
              nameEn: true,
              nameAr: true,
              whoMode: true,
              flags: true,
              recordActions: { select: { actionKey: true } },
              // `order` is read so whoIsAlreadyTheSeeds() can sort by it: Postgres
              // returns rows as they sit on disk unless asked, and the check is positional.
              assignees: { select: { kind: true, order: true, isStartingAssignment: true } },
              transitionsFrom: { select: { id: true, toStageId: true, labelEn: true, labelAr: true, mover: true, kind: true } },
            },
          },
        },
      }),
    ),
  );

  if (meeting) {
    out.meetingTemplateId = meeting.id;
    const byKey = new Map<string, (typeof meeting.stages)[number]>();
    const heldKeys = new Set(meeting.stages.map((s) => s.key).filter((k): k is string => k !== null));
    for (const [key, name] of Object.entries(OLD_STAGE_NAMES)) {
      const stage =
        meeting.stages.find((s) => s.key === key) ??
        meeting.stages.find((s) => s.key === null && (s.nameEn === name || (key === 'agenda_ready' && s.nameEn === 'Agenda Issued')));
      if (!stage) {
        out.left.push(`stage "${name}" not found (renamed or removed)`);
        continue;
      }
      byKey.set(key, stage);
      if (stage.key === null) {
        if (heldKeys.has(key)) {
          out.left.push(`${stage.nameEn}: another stage already holds the key ${key}`);
        } else {
          out.ops.push({ op: 'setKey', stageId: stage.id, key });
          out.changes.push(`${stage.nameEn}: key ${key}`);
        }
      }
    }

    const agenda = byKey.get('agenda_ready');
    if (agenda && agenda.nameEn === OLD_AGENDA.nameEn) {
      if (agenda.nameAr === OLD_AGENDA.nameAr) {
        const s = seedStage('agenda_ready');
        out.ops.push({ op: 'renameStage', stageId: agenda.id, nameEn: s.nameEn, nameAr: s.nameAr });
        out.changes.push('rename Agenda Ready → Agenda Issued');
      } else {
        out.left.push('Agenda Ready: its Arabic name was changed');
      }
    }

    for (const [key, stage] of byKey) {
      const s = seedStage(key);
      // Who works it.
      if ('entries' in s.who) {
        const oldSeed = OLD_CREATOR_STAGES.includes(key)
          ? stage.whoMode === 'ANY_ONE' && stage.assignees.length === 1 && stage.assignees[0]!.kind === 'CREATOR'
          : key === 'minutes_review' && stage.assignees.every((a) => a.isStartingAssignment);
        const entries = s.who.entries;
        const already = whoIsAlreadyTheSeeds(stage.assignees, entries);
        if (oldSeed) {
          out.ops.push({ op: 'setWho', stageId: stage.id, stageKey: key });
          out.changes.push(`${stage.nameEn}: who works it`);
        } else if (!already) {
          out.left.push(`${stage.nameEn}: who works it was configured`);
        }
      }
      // Record actions and flags.
      if ((s.actions?.length ?? 0) > 0 && stage.recordActions.length === 0) {
        out.ops.push({ op: 'addActions', stageId: stage.id, actions: [...s.actions!] });
        out.changes.push(`${stage.nameEn}: ${s.actions!.length} record action(s)`);
      }
      if ((s.flags?.length ?? 0) > 0 && stage.flags.length === 0) {
        out.ops.push({ op: 'setFlags', stageId: stage.id, flags: [...s.flags!] });
        out.changes.push(`${stage.nameEn}: flag ${s.flags!.join(', ')}`);
      }
    }

    // Moves.
    const id = (key: string): string | undefined => byKey.get(key)?.id;
    const moves = meeting.stages.flatMap((st) => st.transitionsFrom.map((t) => ({ ...t, fromStageId: st.id })));
    const find = (from: string, to: string) => moves.find((t) => t.fromStageId === id(from) && t.toStageId === id(to));
    const prepare = find('planned', 'agenda_ready');
    if (prepare && prepare.labelEn === OLD_PREPARE.labelEn && prepare.labelAr === OLD_PREPARE.labelAr) {
      out.ops.push({ op: 'relabel', transitionId: prepare.id, labelEn: 'Issue Agenda', labelAr: 'إصدار الأجندة' });
      out.changes.push('relabel Prepare Agenda → Issue Agenda');
    }
    for (const [from, to, label] of [
      ['minutes_draft', 'minutes_review', 'Distribute Minutes'],
      ['minutes_review', 'minutes_draft', 'Return for Correction'],
    ] as const) {
      const t = find(from, to);
      if (t && t.mover === 'PERSON' && t.labelEn === label) {
        out.ops.push({ op: 'appMover', transitionId: t.id });
        out.changes.push(`${label}: the app's move`);
      } else if (t && t.mover !== 'APP') {
        out.left.push(`${label}: relabelled, left as the person's move`);
      }
    }
    const loop = find('minutes_draft', 'minutes_draft');
    if (loop && loop.labelEn === 'Return for Correction') {
      const [logs, votes] = await Promise.all([
        db.workflowActionLog.count({ where: { workflowTransitionAction: { workflowTransitionId: loop.id } } }),
        db.workflowApproval.count({ where: { transitionId: loop.id } }),
      ]);
      if (logs === 0 && votes === 0) {
        out.ops.push({ op: 'deleteTransition', transitionId: loop.id });
        out.changes.push('delete the draft-to-draft Return for Correction');
      } else {
        out.left.push(`the draft-to-draft Return for Correction is in use (${logs} log(s), ${votes} vote(s))`);
      }
    }
  }

  if (committee) {
    out.committeeTemplateId = committee.id;
    for (const stage of committee.stages) {
      if (!stage.flags.includes(STAGE_FLAG.IN_FORCE)) continue;
      if (stage.recordActions.some((a) => a.actionKey === COMMITTEE_ACTIONS.SCHEDULE_MEETING)) continue;
      out.ops.push({ op: 'addActions', stageId: stage.id, actions: [COMMITTEE_ACTIONS.SCHEDULE_MEETING] });
      out.changes.push(`committee ${stage.nameEn}: schedule_meeting`);
    }
  }
  return out;
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
    plans.push({ organizationId: org.id, slug: org.slug, customer: !isFixture(org.slug), ...(await planOrg(prisma, org.id)) });
  }
  return plans;
}

/** The shared committee_member_role values a seeded COMMITTEE entry names, by key. */
async function seatIds(db: Pick<PrismaService, 'lookupValue'>): Promise<Map<string, string>> {
  const rows = await db.lookupValue.findMany({
    where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
    select: { id: true, key: true },
  });
  return new Map(rows.map((r) => [r.key, r.id]));
}

export async function runBackfill(
  prisma: PrismaService,
  options: { execute: boolean; organizationIds?: readonly string[]; isFixture?: (slug: string) => boolean },
): Promise<BackfillResult> {
  const plans = await planBackfill(prisma, options.organizationIds, options.isFixture);
  const result: BackfillResult = { execute: options.execute, plans, changed: [], refusedCustomers: [] };
  const work = plans.filter((p) => p.ops.length > 0);
  if (!options.execute || work.length === 0) return result;

  result.refusedCustomers = work.filter((p) => p.customer).map((p) => p.slug);
  if (result.refusedCustomers.length > 0) return result;

  const seats = await seatIds(prisma);
  for (const plan of work) {
    await prisma.$transaction(async (tx) => {
      const templateIds = [plan.meetingTemplateId, plan.committeeTemplateId].filter((x): x is string => x !== null).sort();
      await tx.$queryRaw`SELECT id FROM "WorkflowTemplate" WHERE "organizationId" = ${plan.organizationId} AND id = ANY(${templateIds}::text[]) ORDER BY id FOR UPDATE`;
      const now = await planOrg(tx, plan.organizationId);
      if (JSON.stringify(now.ops) !== JSON.stringify(plan.ops)) {
        throw new Error(`${plan.slug}: the database changed since the dry run — run the dry run again.`);
      }
      for (const op of plan.ops) {
        switch (op.op) {
          case 'setKey':
            await tx.workflowStage.update({ where: { id: op.stageId }, data: { key: op.key } });
            break;
          case 'renameStage':
            await tx.workflowStage.update({ where: { id: op.stageId }, data: { nameEn: op.nameEn, nameAr: op.nameAr } });
            break;
          case 'setWho': {
            const who = seedStage(op.stageKey).who;
            if (!('entries' in who)) break;
            await tx.workflowStageAssignee.deleteMany({ where: { organizationId: plan.organizationId, stageId: op.stageId } });
            await tx.workflowStageAssignee.createMany({
              data: who.entries.map((e, i) => {
                const committeeRoleValueId = e.kind === 'COMMITTEE' ? seats.get(e.seatKey) : undefined;
                if (e.kind === 'COMMITTEE' && !committeeRoleValueId) throw new Error(`no shared seat '${e.seatKey}'`);
                return { organizationId: plan.organizationId, stageId: op.stageId, order: i + 1, kind: e.kind, ...(committeeRoleValueId && { committeeRoleValueId }) };
              }),
            });
            await tx.workflowStage.update({ where: { id: op.stageId }, data: { whoMode: who.mode } });
            break;
          }
          case 'addActions':
            await tx.workflowStageRecordAction.createMany({
              data: op.actions.map((actionKey) => ({ organizationId: plan.organizationId, stageId: op.stageId, actionKey })),
            });
            break;
          case 'setFlags':
            await tx.workflowStage.update({ where: { id: op.stageId }, data: { flags: op.flags } });
            break;
          case 'relabel':
            await tx.workflowTransition.update({ where: { id: op.transitionId }, data: { labelEn: op.labelEn, labelAr: op.labelAr } });
            break;
          case 'appMover':
            await tx.workflowTransition.update({ where: { id: op.transitionId }, data: { mover: 'APP' } });
            break;
          case 'deleteTransition':
            await tx.workflowTransitionAction.deleteMany({ where: { workflowTransitionId: op.transitionId } });
            await tx.workflowTransition.delete({ where: { id: op.transitionId } });
            break;
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: plan.organizationId,
          actorId: null,
          action: 'UPDATE',
          objectType: 'WorkflowTemplate',
          objectId: plan.meetingTemplateId ?? plan.committeeTemplateId ?? plan.organizationId,
          after: { changes: plan.changes },
          metadata: {
            source: SCRIPT_NAME,
            ticket: TICKET,
            reason: "The Meeting workflow's decided stages, pools and moves, and scheduling a meeting on a committee's in-force stages; only where still the seed's.",
          },
        },
      });
      result.changed.push({ slug: plan.slug, changes: plan.changes.length });
    }, BACKFILL_TX);
  }
  return result;
}

function report(result: BackfillResult): void {
  console.log(`\n${result.execute ? 'EXECUTE' : 'DRY RUN'} — the decided Meeting workflow (${TICKET})`);
  for (const p of result.plans.filter((x) => x.ops.length > 0 || x.left.length > 0)) {
    console.log(`  ${p.slug.padEnd(24)} ${p.changes.length} change(s), ${p.left.length} left${p.customer ? '  (CUSTOMER ORGANISATION)' : ''}`);
  }
  const changes = result.plans.reduce((n, p) => n + p.changes.length, 0);
  const orgs = result.plans.filter((p) => p.ops.length > 0).length;
  const left = result.plans.reduce((n, p) => n + p.left.length, 0);
  console.log(`\nTotal: ${changes} change(s) in ${orgs} organisation(s), ${left} left as configured, of ${result.plans.length} read.`);
  if (result.refusedCustomers.length > 0) {
    console.log(`\nREFUSED: ${result.refusedCustomers.length} customer organisation(s) — configuring a customer organisation is a customer-notified change, not a script (ACC-101).\n`);
  } else if (result.execute) {
    for (const c of result.changed) console.log(`  ${c.slug}: ${c.changes} change(s); 1 audit row.`);
    console.log(changes === 0 ? '\nNothing to change.\n' : '\nDone. Run the dry run again: it must report 0.\n');
  } else {
    console.log(changes === 0 ? '\nNothing to change.\n' : '\nDry run only — re-run with --execute to apply.\n');
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaService();
  try {
    const result = await runBackfill(prisma, { execute: process.argv.includes('--execute') });
    report(result);
    if (result.refusedCustomers.length > 0) process.exitCode = 1;
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) {
  main()
    .then(() => process.exit(process.exitCode ?? 0))
    .catch((error: unknown) => {
      console.error('\nBackfill failed:', error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
