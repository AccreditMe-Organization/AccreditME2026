/**
 * ACC-282 — who may READ a record's workflow and who may ACT on it, against a
 * REAL Postgres (npm run test:db).
 *
 * The rule (Ahmad, 8 Nov):
 *
 *   - READ (the instance list, an instance, its stage history, its moves list):
 *     whoever may open the record by ACC-281's rule — committees:view, or an active
 *     member of THAT committee. workflows:view is not needed.
 *   - MOVES are listed only for someone in the current stage's pool; an empty list
 *     for anyone else who may open the record.
 *   - ACT (press a move — on a multi-approver stage that IS the vote — or vote):
 *     may open the record, then is in the pool.
 *   - Anyone who may not open the record gets exactly the refusal a missing record
 *     gets: the 404 where the instance is read first (and on pressing), the
 *     parent's 403 where the request names the record.
 *
 * Callers, none holding workflows:view except the holder:
 *   - a POOL MEMBER: an active member in the seat the pool names;
 *   - a MEMBER NOT IN THE POOL: an active member in another seat;
 *   - a FORMER MEMBER NAMED DIRECTLY in the pool (a SPECIFIC_USER entry): in the
 *     pool, but may not open the record;
 *   - a workflows:view HOLDER (with committees:view), not in the pool;
 *   - and another organisation's record.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
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
const NOT_FOUND = 'Workflow instance not found';
const PARENT_REFUSED = 'Required permission: committees:view';
const HOLDER = ['workflows:view', 'committees:view'];

interface Caller {
  id: string;
  permissions: string[];
}

describe('Pool members see and press their moves, against a real database (ACC-282)', () => {
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
   * One organisation, one committee sitting in Terms Review, whose pool is the
   * committee's CHAIR seat plus a former member named directly. Terms Review's
   * Approve leads to Active.
   */
  async function world(whoMode: 'ANY_ONE' | 'ALL' = 'ANY_ONE') {
    const slug = `acc282-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await applyWorkflowSeed(prisma, org, [COMMITTEE_SEED, CR_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: org, objectType: 'COMMITTEE', isDefault: true } });
    const stageId = async (key: string) => (await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: org, nameEn: 'Quality', code: `Q-${slug}` } })).id;
    const user = async (name: string) =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${name}@example.test`, name, status: 'ACTIVE' } })).id;
    const committee = (
      await prisma.committee.create({
        data: { organizationId: org, nameEn: `${slug} committee`, typeValueId: 'type', orgUnitId: unit, quorumCount: 1, meetingFrequency: 'MONTHLY' },
      })
    ).id;
    const ids = { chair: await user('Chair'), secondChair: await user('Second'), member: await user('Member'), former: await user('Former'), holder: await user('Holder') };
    const seat = async (userId: string, roleValueId: string, isActive = true) =>
      prisma.committeeMember.create({
        data: { organizationId: org, committeeId: committee, userId, roleValueId, isActive, ...(isActive ? {} : { leftAt: new Date() }) },
      });
    await seat(ids.chair, 'seat-chair');
    await seat(ids.member, 'seat-member');
    await seat(ids.former, 'seat-chair', false);

    const terms = await stageId('terms_review');
    await prisma.workflowStageAssignee.deleteMany({ where: { stageId: terms } });
    await prisma.workflowStageAssignee.createMany({
      data: [
        { organizationId: org, stageId: terms, order: 1, kind: 'COMMITTEE', committeeRoleValueId: 'seat-chair' },
        { organizationId: org, stageId: terms, order: 2, kind: 'SPECIFIC_USER', userId: ids.former },
      ],
    });
    await prisma.workflowStage.update({ where: { id: terms }, data: { whoMode } });

    const instance = await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: committee, status: 'IN_PROGRESS', currentStageId: terms },
    });
    const entry = await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: terms } });
    const approve = await prisma.workflowTransition.findFirstOrThrow({ where: { fromStageId: terms, toStage: { key: 'active' } } });
    const activeId = await stageId('active');

    return {
      org,
      committee,
      instanceId: instance.id,
      entryId: entry.id,
      approve,
      activeId,
      seat,
      poolMember: { id: ids.chair, permissions: [] } as Caller,
      secondChair: { id: ids.secondChair, permissions: [] } as Caller,
      notInPool: { id: ids.member, permissions: [] } as Caller,
      formerNamed: { id: ids.former, permissions: [] } as Caller,
      holder: { id: ids.holder, permissions: HOLDER } as Caller,
    };
  }

  /** 'OK', or the refusal: its code, else its message. */
  const outcome = (p: Promise<unknown>): Promise<string> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => string | { message?: string | string[]; code?: string } }) => {
        const r = e.getResponse?.();
        if (typeof r === 'string') return r;
        return (r?.code as string) ?? (Array.isArray(r?.message) ? r.message.join('; ') : r?.message) ?? `ERROR ${String(e)}`;
      },
    );

  type World = Awaited<ReturnType<typeof world>>;
  const reads = (w: World, c: Caller, instanceId = w.instanceId, committee = w.committee) => ({
    list: workflow.getInstancesByObject('COMMITTEE', committee, w.org, c.permissions, c.id),
    one: workflow.getInstanceByIdForViewer(instanceId, w.org, c.permissions, c.id),
    history: workflow.getStageHistory(instanceId, w.org, c.permissions, c.id),
    moves: workflow.getMovesForViewer(instanceId, w.org, c.permissions, c.id),
  });
  const press = (w: World, c: Caller, instanceId = w.instanceId) =>
    workflow.triggerTransition(instanceId, { transitionId: w.approve.id }, w.org, c.id, c.permissions);
  const vote = (w: World, c: Caller, entryId = w.entryId) => workflow.submitApproval(entryId, { decision: 'APPROVED' }, w.org, c.id, c.permissions);
  const stageOf = async (w: World) => (await prisma.workflowInstance.findUniqueOrThrow({ where: { id: w.instanceId } })).currentStageId;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('a POOL MEMBER reads the workflow, gets the move with its label and next stage, and presses it', async () => {
    const w = await world();
    const r = reads(w, w.poolMember);
    expect((await r.list).map((i) => i.id)).toEqual([w.instanceId]);
    expect((await r.one).id).toBe(w.instanceId);
    expect((await r.history).visits.length).toBeGreaterThan(0);
    const moves = await r.moves;
    expect(moves.transitionIds).toContain(w.approve.id);
    expect(moves.moves.find((m) => m.id === w.approve.id)).toEqual(
      expect.objectContaining({ labelEn: w.approve.labelEn, kind: w.approve.kind, toStageId: w.activeId, toStageNameEn: 'Active' }),
    );

    expect(await outcome(press(w, w.poolMember))).toBe('OK');
    expect(await stageOf(w)).toBe(w.activeId);
  });

  it('a MEMBER NOT IN THE POOL reads the workflow and its history, gets no moves, and is refused pressing as before', async () => {
    const w = await world();
    const r = reads(w, w.notInPool);
    expect(await outcome(r.list)).toBe('OK');
    expect(await outcome(r.one)).toBe('OK');
    expect(await outcome(r.history)).toBe('OK');
    expect(await r.moves).toEqual({ transitionIds: [], moves: [] });
    // They may open the record, so the pool's own refusal, unchanged (ACC-271).
    expect(await outcome(press(w, w.notInPool))).toBe('NOT_IN_STAGE_POOL');
    expect(await outcome(vote(w, w.notInPool))).toBe('NOT_IN_STAGE_POOL');
    expect(await stageOf(w)).not.toBe(w.activeId);
  });

  it('a FORMER MEMBER NAMED DIRECTLY in the pool may not open the record: the missing-record refusal everywhere, pressing too', async () => {
    const w = await world();
    const r = reads(w, w.formerNamed);
    expect(await outcome(r.list)).toBe(PARENT_REFUSED);
    expect(await outcome(r.one)).toBe(NOT_FOUND);
    expect(await outcome(r.history)).toBe(NOT_FOUND);
    expect(await outcome(r.moves)).toBe(NOT_FOUND);
    expect(await outcome(press(w, w.formerNamed))).toBe(NOT_FOUND);
    expect(await outcome(vote(w, w.formerNamed))).toBe(NOT_FOUND);
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: w.entryId } })).toBe(0);
    expect(await stageOf(w)).not.toBe(w.activeId);
  });

  it('…and each refusal is identical to the one for an invented id', async () => {
    const w = await world();
    const invented = 'no-such-instance';
    const real = reads(w, w.formerNamed);
    const fake = reads(w, w.formerNamed, invented, 'no-such-committee');
    expect(await outcome(fake.list)).toBe(await outcome(real.list));
    expect(await outcome(fake.one)).toBe(await outcome(real.one));
    expect(await outcome(fake.history)).toBe(await outcome(real.history));
    expect(await outcome(fake.moves)).toBe(await outcome(real.moves));
    expect(await outcome(press(w, w.formerNamed, invented))).toBe(await outcome(press(w, w.formerNamed)));
  });

  it('a workflows:view HOLDER outside the pool: every read as before, no moves, and the pool refuses the press', async () => {
    const w = await world();
    const r = reads(w, w.holder);
    expect(await outcome(r.list)).toBe('OK');
    expect(await outcome(r.one)).toBe('OK');
    expect(await outcome(r.history)).toBe('OK');
    expect(await r.moves).toEqual({ transitionIds: [], moves: [] });
    expect(await outcome(press(w, w.holder))).toBe('NOT_IN_STAGE_POOL');
  });

  it('on an ALL stage a pool member’s press is their vote, and the record moves on the last one', async () => {
    const w = await world('ALL');
    await w.seat(w.secondChair.id, 'seat-chair');
    // The pool is now both chairs and the former member named directly; the former
    // member may not open the record, so their vote can never be cast, and ALL
    // waits on everyone who may act. Remove the direct entry for this case.
    await prisma.workflowStageAssignee.deleteMany({ where: { kind: 'SPECIFIC_USER', userId: w.formerNamed.id } });
    // The seeded Approve is not an approval-path move, so on an ALL stage a single
    // press of it would fire at once (a pre-existing seed quirk; committee stages
    // are ANY_ONE). Mark it, so the press is a vote.
    await prisma.workflowTransition.update({ where: { id: w.approve.id }, data: { isApprovalPath: true } });

    expect(await outcome(press(w, w.poolMember))).toBe('OK');
    expect(await prisma.workflowApproval.count({ where: { workflowInstanceStageId: w.entryId, decision: 'APPROVED' } })).toBe(1);
    expect(await stageOf(w)).not.toBe(w.activeId);

    expect(await outcome(press(w, w.secondChair))).toBe('OK');
    expect(await stageOf(w)).toBe(w.activeId);
  });

  it("a member reads a change request's workflow; anyone else who may not open it gets the parent's refusal", async () => {
    const w = await world();
    const cr = await prisma.committeeChangeRequest.create({
      data: { organizationId: w.org, committeeId: w.committee, number: 1, requestedById: w.notInPool.id, reason: 'r', changes: {} },
    });
    expect(await outcome(workflow.getInstancesByObject('COMMITTEE_CHANGE_REQUEST', cr.id, w.org, [], w.notInPool.id))).toBe('OK');
    expect(await outcome(workflow.getInstancesByObject('COMMITTEE_CHANGE_REQUEST', cr.id, w.org, [], w.formerNamed.id))).toBe(PARENT_REFUSED);
  });

  itEnforcesTenantIsolation("another organisation's instance gets the identical not-found, on every read and on pressing", async () => {
    const a = await world();
    const b = await world();
    // A's pool member, asking for B's instance and committee, within A.
    const r = reads(a, a.poolMember, b.instanceId, b.committee);
    expect(await outcome(r.one)).toBe(NOT_FOUND);
    expect(await outcome(r.history)).toBe(NOT_FOUND);
    expect(await outcome(r.moves)).toBe(NOT_FOUND);
    expect(await outcome(press(a, a.poolMember, b.instanceId))).toBe(NOT_FOUND);
    expect(await outcome(vote(a, a.poolMember, b.entryId))).toBe('Workflow instance stage not found');
    // A committee of B is not A's: the parent check refuses it as a missing one.
    expect(await outcome(r.list)).toBe(PARENT_REFUSED);
    expect(await stageOf(b)).not.toBe(b.activeId);
  });
});
