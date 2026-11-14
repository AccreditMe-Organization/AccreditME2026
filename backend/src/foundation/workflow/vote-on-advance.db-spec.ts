/**
 * ACC-284 — on a stage decided together, the move's KIND says what a press is, and a
 * move goes through when its OWN threshold is met. Against a REAL Postgres
 * (npm run test:db). The rules (Ahmad, 10 Nov; backend/Plans/step-284-vote-on-advance.md):
 *
 *   kind      "All of them" (ALL)   Committee vote (COMMITTEE_VOTE)
 *   ADVANCE   a vote for the move   a vote for the move
 *   RETURN    acts at once          acts at once
 *   EXIT      acts at once          a vote for the move
 *
 * The committee template is provisioned by the seed's own code, and its moves are left
 * exactly as seeded: Approve Committee (Terms Review → Active) keeps `isApprovalPath`
 * false, which used to make one press move the committee alone. Terms Review's RETURN is
 * the seeded "Revise Terms". The template has no EXIT, so each world adds one, as a tenant
 * can (Terms Review → Dissolved).
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database, and
 * refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
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

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const CR_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE_CHANGE_REQUEST')!;

describe('A press on a stage decided together is a vote by the move’s kind, per move, on a real database (ACC-284)', () => {
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
  const queue = { add: async () => undefined } as never;
  const pools = new StagePoolService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, pools);

  /**
   * One organisation; one committee in Terms Review, worked by the committee itself
   * (`members` active members, quorum `quorum`), with the stage set to `whoMode`.
   */
  async function world(whoMode: 'ANY_ONE' | 'ALL' | 'COMMITTEE_VOTE', members: number, quorum = 1) {
    const slug = `acc284-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, org, [COMMITTEE_SEED, CR_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: org, objectType: 'COMMITTEE', isDefault: true } });
    const stage = async (key: string) => prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q-${slug}` } })).id;
    const committee = (
      await prisma.committee.create({
        data: { organizationId: org, nameEn: `${slug} committee`, typeValueId: 'type', orgUnitId: unit, quorumCount: quorum, meetingFrequency: 'MONTHLY' },
      })
    ).id;
    const people: string[] = [];
    for (let i = 0; i < members; i++) {
      const id = (await prisma.user.create({ data: { organizationId: org, email: `${slug}-m${i}@example.test`, name: `Member ${i}`, status: 'ACTIVE' } })).id;
      await prisma.committeeMember.create({ data: { organizationId: org, committeeId: committee, userId: id, roleValueId: 'seat-member' } });
      people.push(id);
    }

    const terms = await stage('terms_review');
    await prisma.workflowStageAssignee.deleteMany({ where: { stageId: terms.id } });
    await prisma.workflowStageAssignee.create({ data: { organizationId: org, stageId: terms.id, order: 1, kind: 'COMMITTEE', committeeId: committee } });
    await prisma.workflowStage.update({ where: { id: terms.id }, data: { whoMode } });

    const [active, formation, dissolved, suspended] = await Promise.all([stage('active'), stage('formation'), stage('dissolved'), stage('suspended')]);
    const move = (toStageId: string) => prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: terms.id, toStageId } });
    const approve = await move(active.id);
    const revise = await move(formation.id);
    // The template seeds no EXIT; a tenant can add one.
    const end = await prisma.workflowTransition.create({
      data: { fromStageId: terms.id, toStageId: dissolved.id, labelEn: 'Reject the committee', labelAr: 'رفض اللجنة', kind: 'EXIT', mover: 'PERSON' },
    });

    const instance = await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committee, status: 'IN_PROGRESS', currentStageId: terms.id },
    });
    const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: terms.id } });

    return {
      org,
      committee,
      people,
      instanceId: instance.id,
      entryId: entry.id,
      termsId: terms.id,
      stages: { active: active.id, formation: formation.id, dissolved: dissolved.id, suspended: suspended.id },
      moves: { approve, revise, end },
    };
  }
  type World = Awaited<ReturnType<typeof world>>;

  const press = (w: World, person: number, transitionId: string) =>
    workflow.triggerTransition(w.instanceId, { transitionId }, w.org, w.people[person]!, ['committees:view']);
  /** 'OK', or the refusal's code (else its message). */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { message?: string | string[]; code?: string } }) => {
        const r = e.getResponse?.();
        if (typeof r === 'string') return r;
        return (r?.code as string) ?? (Array.isArray(r?.message) ? r.message.join('; ') : r?.message) ?? `ERROR ${String(e)}`;
      },
    );
  const stageOf = async (w: World) => (await prisma.workflowInstance.findUniqueOrThrow({ where: { id: w.instanceId } })).currentStageId;
  const leftWith = async (w: World) => (await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: w.entryId } })).outcome;
  const votes = (w: World) =>
    prisma.workflowApproval.findMany({ where: { workflowInstanceStageId: w.entryId }, select: { approverId: true, decision: true, transitionId: true }, orderBy: { decidedAt: 'asc' } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  // ACC-202 — the ticket's own case: on "Any one of them" a person's press moves
  // the record at once, and the stage it left records the move's KIND. Before
  // ACC-202 every one of these stored APPROVED.
  describe('"Any one of them": the outcome is the move’s kind (ACC-202)', () => {
    it('ADVANCE leaves the stage APPROVED', async () => {
      const w = await world('ANY_ONE', 1);
      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await leftWith(w)).toBe('APPROVED');
      // A forward move shows nothing in stage history.
      const history = await workflow.getStageHistory(w.instanceId, w.org, ['committees:view'], w.people[0]!);
      expect(history.visits.map((v) => v.arrivedBy)).toEqual([null, null]);
    });

    it('RETURN leaves it RETURNED, and stage history says the next visit was arrived at by a send-back', async () => {
      const w = await world('ANY_ONE', 1);
      expect(await outcome(press(w, 0, w.moves.revise.id))).toBe('OK');
      expect(await leftWith(w)).toBe('RETURNED');
      const history = await workflow.getStageHistory(w.instanceId, w.org, ['committees:view'], w.people[0]!);
      expect(history.visits.map((v) => v.arrivedBy)).toEqual([null, 'RETURNED']);
    });

    it('EXIT leaves it EXITED, and the next visit was arrived at by an end', async () => {
      const w = await world('ANY_ONE', 1);
      expect(await outcome(press(w, 0, w.moves.end.id))).toBe('OK');
      expect(await leftWith(w)).toBe('EXITED');
      const history = await workflow.getStageHistory(w.instanceId, w.org, ['committees:view'], w.people[0]!);
      expect(history.visits.map((v) => v.arrivedBy)).toEqual([null, 'EXITED']);
    });
  });

  describe('"All of them"', () => {
    it('the seeded Approve (isApprovalPath false): the first press is a vote and the committee waits; the last press moves it', async () => {
      const w = await world('ALL', 2);
      expect(w.moves.approve.isApprovalPath).toBe(false); // as seeded, untouched

      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.termsId);
      expect(await votes(w)).toEqual([{ approverId: w.people[0], decision: 'APPROVED', transitionId: w.moves.approve.id }]);

      expect(await outcome(press(w, 1, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.active);
      expect(await leftWith(w)).toBe('APPROVED');
    });

    it('RETURN (the seeded "Revise Terms") acts at once on one press, and stores the send-back', async () => {
      const w = await world('ALL', 2);
      expect(await outcome(press(w, 0, w.moves.revise.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.formation);
      // ACC-202 — left with the move's kind's outcome: sent back.
      expect(await leftWith(w)).toBe('RETURNED');
      expect(await votes(w)).toEqual([{ approverId: w.people[0], decision: 'RETURNED', transitionId: w.moves.revise.id }]);
    });

    it('RETURN still acts at once with isApprovalPath set on it: the flag is not read', async () => {
      const w = await world('ALL', 2);
      await prisma.workflowTransition.update({ where: { id: w.moves.revise.id }, data: { isApprovalPath: true } });
      expect(await outcome(press(w, 0, w.moves.revise.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.formation);
    });

    it('EXIT acts at once on one press', async () => {
      const w = await world('ALL', 2);
      expect(await outcome(press(w, 0, w.moves.end.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.dissolved);
      expect(await leftWith(w)).toBe('EXITED');
    });

    it('votes count per move: two forward moves wait until everyone agrees on one, and pressing again changes a vote', async () => {
      const w = await world('ALL', 2);
      const suspend = await prisma.workflowTransition.create({
        data: { fromStageId: w.termsId, toStageId: w.stages.suspended, labelEn: 'Suspend', labelAr: 'تعليق', kind: 'ADVANCE', mover: 'PERSON' },
      });
      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await outcome(press(w, 1, suspend.id))).toBe('OK');
      // Everyone has voted, but not for the same move: nothing goes through.
      expect(await stageOf(w)).toBe(w.termsId);
      expect((await votes(w)).map((v) => v.transitionId)).toEqual([w.moves.approve.id, suspend.id]);

      // The second member changes their vote: still one vote each, now both for Approve.
      expect(await outcome(press(w, 1, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.active);
      expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: w.entryId } })).toBe(2);
    });

    it('a replaced vote is audited: the old move and the new move, who and when; the same move again adds nothing', async () => {
      const w = await world('ALL', 2);
      const suspend = await prisma.workflowTransition.create({
        data: { fromStageId: w.termsId, toStageId: w.stages.suspended, labelEn: 'Suspend', labelAr: 'تعليق', kind: 'ADVANCE', mover: 'PERSON' },
      });
      const rows = () =>
        prisma.auditLog.findMany({
          where: { organizationId: w.org, objectType: 'WorkflowApproval' },
          orderBy: { createdAt: 'asc' },
          select: { action: true, actorId: true, objectId: true, before: true, after: true, createdAt: true },
        });
      const started = new Date(Date.now() - 1000);

      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      const first = await rows();
      expect(first.length).toBe(1);
      expect(first[0]).toMatchObject({
        action: 'CREATE',
        actorId: w.people[0],
        after: { decision: 'APPROVED', move: { id: w.moves.approve.id, labelEn: w.moves.approve.labelEn, labelAr: w.moves.approve.labelAr } },
      });

      // The same member presses another move: their vote is replaced, and the change is recorded.
      expect(await outcome(press(w, 0, suspend.id))).toBe('OK');
      const second = await rows();
      expect(second.length).toBe(2);
      const vote = await prisma.workflowApproval.findFirstOrThrow({ where: { workflowInstanceStageId: w.entryId, approverId: w.people[0]! } });
      expect(second[1]).toMatchObject({
        action: 'UPDATE',
        actorId: w.people[0], // who
        objectId: vote.id,
        before: { decision: 'APPROVED', move: { id: w.moves.approve.id, labelEn: w.moves.approve.labelEn, labelAr: w.moves.approve.labelAr } },
        after: { decision: 'APPROVED', move: { id: suspend.id, labelEn: 'Suspend', labelAr: 'تعليق' } },
      });
      expect(second[1]!.createdAt.getTime()).toBeGreaterThanOrEqual(started.getTime()); // when
      expect(second[1]!.createdAt.getTime()).toBeGreaterThanOrEqual(second[0]!.createdAt.getTime());

      // Pressing the same move again changes nothing, and records nothing.
      expect(await outcome(press(w, 0, suspend.id))).toBe('OK');
      expect((await rows()).length).toBe(2);
    });

    it('the gate holds only the DECIDING vote: with a required task open, the first vote is recorded and the last is refused before it is', async () => {
      const w = await world('ALL', 2);
      await prisma.task.create({
        data: {
          organizationId: w.org,
          createdById: w.people[0]!,
          sourceType: 'COMMITTEE',
          sourceId: w.committee,
          title: 'Required before approval',
          status: 'PENDING',
          isMandatory: true,
          workflowInstanceStageId: w.entryId,
        } as never,
      });
      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await outcome(press(w, 1, w.moves.approve.id))).toBe('STAGE_TASKS_OPEN');
      expect((await votes(w)).length).toBe(1);
      expect(await stageOf(w)).toBe(w.termsId);
    });

    it('a vote cast before ACC-284 (no move recorded) counts for the forward move, as it did', async () => {
      const w = await world('ALL', 2);
      await prisma.workflowApproval.create({
        data: { workflowInstanceStageId: w.entryId, approverId: w.people[0]!, decision: 'APPROVED', decidedAt: new Date() },
      });
      expect(await outcome(press(w, 1, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.active);
    });
  });

  describe('a committee vote (three members, quorum 2)', () => {
    it('the seeded Approve: the first press is a vote and the committee waits; the second makes quorum with a majority and moves it', async () => {
      const w = await world('COMMITTEE_VOTE', 3, 2);
      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.termsId);
      expect(await outcome(press(w, 1, w.moves.approve.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.active);
      expect(await leftWith(w)).toBe('APPROVED');
    });

    it('EXIT is a vote here: the first press waits, and the committee threshold moves it', async () => {
      const w = await world('COMMITTEE_VOTE', 3, 2);
      expect(await outcome(press(w, 0, w.moves.end.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.termsId);
      expect(await votes(w)).toEqual([{ approverId: w.people[0], decision: 'APPROVED', transitionId: w.moves.end.id }]);
      expect(await outcome(press(w, 1, w.moves.end.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.dissolved);
      // ACC-202 — an EXIT that a vote decided is still ended, not rejected.
      expect(await leftWith(w)).toBe('EXITED');
    });

    it('votes count per move: quorum counts every vote cast, and a move needs more than half of them', async () => {
      const w = await world('COMMITTEE_VOTE', 3, 2);
      expect(await outcome(press(w, 0, w.moves.approve.id))).toBe('OK');
      expect(await outcome(press(w, 1, w.moves.end.id))).toBe('OK');
      // Quorum met (2 cast), but 1 of 2 is not a majority for either move.
      expect(await stageOf(w)).toBe(w.termsId);
      expect(await outcome(press(w, 2, w.moves.approve.id))).toBe('OK');
      // 3 cast, 2 for Approve: more than half.
      expect(await stageOf(w)).toBe(w.stages.active);
    });

    it('RETURN still acts at once on one member’s press', async () => {
      const w = await world('COMMITTEE_VOTE', 3, 2);
      expect(await outcome(press(w, 0, w.moves.revise.id))).toBe('OK');
      expect(await stageOf(w)).toBe(w.stages.formation);
      expect(await leftWith(w)).toBe('RETURNED');
    });
  });

  itEnforcesTenantIsolation('pressing another organisation’s move is the missing move, and records no vote', async () => {
    const a = await world('ALL', 2);
    const b = await world('ALL', 2);
    const foreign = await outcome(press(a, 0, b.moves.approve.id));
    const invented = await outcome(press(a, 0, 'no-such-transition'));
    expect(foreign).toBe(invented);
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: { in: [a.entryId, b.entryId] } } })).toBe(0);
    expect(await stageOf(a)).toBe(a.termsId);
    expect(await stageOf(b)).toBe(b.termsId);
  });
});
