/**
 * ACC-202, PR 1 of 2 — stage history READS the two new outcomes, and the
 * engine does not WRITE them yet. Against a REAL Postgres (npm run test:db).
 * Plan: backend/Plans/step-57-191-202-workflow-checks.md.
 *
 *   - `arrivedBy` on each visit is the PREVIOUS visit's outcome when it was
 *     RETURNED or EXITED, and null otherwise (a forward move, an old REJECTED
 *     or SKIPPED, the first visit). Rows are written here directly, as PR 2's
 *     engine will write them.
 *   - The engine itself still leaves every move with an outcome the deployed
 *     client knows (APPROVED, REJECTED, SKIPPED): a real press of each kind, on
 *     "Any one of them" and "All of them". The static half of the same
 *     guarantee is stage-outcome-writes.scan.spec.ts.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a
 * database, and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { LookupService } from '../lookup/lookup.service';
import { TaskService } from '../task/task.service';
import { TaskAuthorityService } from '../task/task-authority.service';
import { TaskAssignmentService } from '../task/task-assignment.service';
import { TaskSlaService } from '../task/task-sla.service';
import { TaskClosedNoticeService } from '../task/task-closed-notice.service';
import { WorkflowService } from './workflow.service';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { StagePoolService } from './stage-pool.service';
import { applyWorkflowSeed } from './workflow-seed-apply';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import type { WorkflowInstanceStageOutcome } from '../../../generated/prisma/client';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
/** What the client deployed before ACC-202 can read. */
const KNOWN_BEFORE_ACC202: readonly string[] = ['PENDING', 'APPROVED', 'REJECTED', 'SKIPPED'];

describe('Stage history reads RETURNED and EXITED; the engine does not write them yet (ACC-202, PR 1 of 2)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: async () => ({ id: randomUUID() }), createInAppMany: async () => 0 } as unknown as NotificationService;
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: async () => [] } as unknown as LookupService;
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, { add: async () => undefined } as never, stageTasks, new StagePoolService(prisma));

  /** One organisation; one committee at Terms Review, worked by one member, decided `whoMode`; the seeded moves plus an EXIT to Dissolved. */
  async function world(whoMode: 'ANY_ONE' | 'ALL') {
    const slug = `acc202-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, org, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: org, objectType: 'COMMITTEE', isDefault: true } });
    const stage = async (key: string) => (await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } })).id;
    const [formation, terms, active, dissolved] = [await stage('formation'), await stage('terms_review'), await stage('active'), await stage('dissolved')];
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q-${slug}` } })).id;
    const committee = (
      await prisma.committee.create({ data: { organizationId: org, nameEn: `${slug} committee`, typeValueId: 'type', orgUnitId: unit, quorumCount: 1, meetingFrequency: 'MONTHLY' } })
    ).id;
    const member = (await prisma.user.create({ data: { organizationId: org, email: `${slug}@example.test`, name: 'Member', status: 'ACTIVE' } })).id;
    await prisma.committeeMember.create({ data: { organizationId: org, committeeId: committee, userId: member, roleValueId: 'seat-member' } });
    await prisma.workflowStageAssignee.deleteMany({ where: { stageId: terms } });
    await prisma.workflowStageAssignee.create({ data: { organizationId: org, stageId: terms, order: 1, kind: 'SPECIFIC_USER', userId: member } });
    await prisma.workflowStage.update({ where: { id: terms }, data: { whoMode } });
    const move = (toStageId: string) => prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: terms, toStageId } });
    const moves = {
      advance: await move(active),
      back: await move(formation),
      end: await prisma.workflowTransition.create({
        data: { fromStageId: terms, toStageId: dissolved, labelEn: 'Reject the committee', labelAr: 'رفض اللجنة', kind: 'EXIT', mover: 'PERSON' },
      }),
    };
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committee, status: 'IN_PROGRESS', currentStageId: terms },
    });
    const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: terms } });
    return { org, member, instanceId: instance.id, entryId: entry.id, stages: { formation, terms, active, dissolved }, moves };
  }

  const history = (w: Awaited<ReturnType<typeof world>>) => workflow.getStageHistory(w.instanceId, w.org, ['committees:view'], w.member);

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it("arrivedBy is the previous visit's outcome when it was RETURNED or EXITED, and null otherwise", async () => {
    const w = await world('ANY_ONE');
    await prisma.workflowInstance.update({ where: { id: w.instanceId }, data: { currentStageId: w.stages.dissolved } });
    const t0 = Date.now();
    const path: [string, WorkflowInstanceStageOutcome][] = [
      [w.stages.formation, 'APPROVED'],
      [w.stages.terms, 'RETURNED'],
      [w.stages.formation, 'REJECTED'],
      [w.stages.terms, 'SKIPPED'],
      [w.stages.formation, 'EXITED'],
      [w.stages.dissolved, 'PENDING'],
    ];
    await prisma.workflowInstanceStage.deleteMany({ where: { workflowInstanceId: w.instanceId } });
    for (const [i, [stageId, outcome]] of path.entries()) {
      await prisma.workflowInstanceStage.create({
        data: {
          workflowInstanceId: w.instanceId,
          stageId,
          outcome,
          enteredAt: new Date(t0 + i * 1000),
          exitedAt: outcome === 'PENDING' ? null : new Date(t0 + i * 1000 + 500),
        },
      });
    }

    expect((await history(w)).visits.map((v) => v.arrivedBy)).toEqual([null, null, 'RETURNED', null, null, 'EXITED']);
  });

  it.each(['ANY_ONE', 'ALL'] as const)('on "%s", a real press of each kind still leaves an outcome the deployed client knows', async (whoMode) => {
    for (const kind of ['advance', 'back', 'end'] as const) {
      const w = await world(whoMode);
      await workflow.triggerTransition(w.instanceId, { transitionId: w.moves[kind].id }, w.org, w.member, ['committees:view']);
      const left = await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: w.entryId } });
      expect(left.exitedAt).not.toBeNull();
      expect(KNOWN_BEFORE_ACC202).toContain(left.outcome);
      // So stage history shows no "Sent back" or "Ended" for a move made by this PR's engine.
      expect((await history(w)).visits.map((v) => v.arrivedBy)).toEqual([null, null]);
    }
  });
});
