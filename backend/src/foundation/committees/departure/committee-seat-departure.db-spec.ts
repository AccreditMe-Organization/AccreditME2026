/**
 * ACC-306 — a deactivated person's committee seats end with the deactivation,
 * against a REAL Postgres (npm run test:db).
 *
 *   - what ends: every active seat on an active committee, whatever its stage,
 *     each with one LEFT event (cause DEACTIVATION, approved by the actor) and
 *     an audit row; a Dissolved committee's roster, an inactive committee and a
 *     seat already left are untouched;
 *   - never blocked: the last Chairman of a committee in force still ends, and
 *     the committee then reads as missing the seat (ACC-286's own function);
 *   - in the deactivation's transaction: a refusal leaves every seat, and a
 *     failure after the seats ended rolls them back;
 *   - the race: a hand removal holding the committee row is waited for, and one
 *     LEFT event is written in all;
 *   - the lock order: a deactivation, a hand removal, and the lock sequences of
 *     a going-live transition and a change-request approve, all at once, finish;
 *   - another organisation's rows are never touched;
 *   - reactivation restores no seat; a later add reuses the row;
 *   - the officers are told, never the leaver or the actor.
 * Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditLogService } from '../../../common/services/audit-log.service';
import { DelegationLabelService } from '../../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { NotificationService } from '../../notification/notification.service';
import { TenantService } from '../../tenant/tenant.service';
import { LookupService } from '../../lookup/lookup.service';
import { RoleService } from '../../roles/role.service';
import { OrganizationService } from '../../organization/organization.service';
import { OrgUnitHeadService } from '../../organization/org-unit-head.service';
import { OrgPositionService } from '../../org-position/org-position.service';
import { TaskService } from '../../task/task.service';
import { TaskAuthorityService } from '../../task/task-authority.service';
import { TaskAssignmentService } from '../../task/task-assignment.service';
import { TaskSlaService } from '../../task/task-sla.service';
import { TaskClosedNoticeService } from '../../task/task-closed-notice.service';
import { WorkflowService } from '../../workflow/workflow.service';
import { StageTaskDefinitionService } from '../../workflow/stage-task-definition.service';
import { StageRulesService } from '../../workflow/stage-rules.service';
import { StagePoolService } from '../../workflow/stage-pool.service';
import { applyWorkflowSeed } from '../../workflow/workflow-seed-apply';
import { writeStartingAssignments } from '../../workflow/workflow-who';
import { SYSTEM_WORKFLOW_SEED } from '../../workflow/workflow.seed';
import type { AuthProvider } from '../../../providers/auth/auth.provider';
import { UserService } from '../../user/user.service';
import { ChangeRequestDepartureService } from '../change-requests/departure/change-request-departure.service';
import type { CommitteeTransferNoticeService } from '../transfer-notice/committee-transfer-notice.service';
import { CommitteesService } from '../committees.service';
import { emptyRequiredSeats } from '../committee-seat-rules';
import { CommitteeSeatDepartureService } from './committee-seat-departure.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const COMMITTEE_SEED = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
const MEMBER_WRITER = ['committees:view', 'committees:add_member', 'committees:remove_member', 'committees:change_member_role'];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('A deactivated person’s committee seats end with the deactivation, on a real database (ACC-306)', () => {
  const prisma = new PrismaService();
  /** A second connection, for the transactions that hold locks while the deactivation runs. */
  const other = new PrismaService();
  const audit = new AuditLogService(prisma);
  const labels = new DelegationLabelService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = new NotificationService(prisma, audit, { add: async () => undefined } as never);
  const tenant = { getTaskSla: async () => null } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = new LookupService(prisma, audit);
  const assignment = new TaskAssignmentService(prisma, authority, lookups);
  const sla = new TaskSlaService(prisma, calendar);
  const tasks = new TaskService(prisma, audit, labels, visibility, calendar, notifications, tenant, assignment, authority, sla, new TaskClosedNoticeService(prisma, notifications));
  const stageTasks = new StageTaskDefinitionService(prisma, audit, tasks);
  const queue = { add: async () => undefined } as never;
  const pools = new StagePoolService(prisma);
  const workflow = new WorkflowService(prisma, audit, labels, visibility, calendar, notifications, tasks, queue, stageTasks, pools);
  const committees = new CommitteesService(prisma, audit, workflow, new StageRulesService(prisma));
  const seatDeparture = new CommitteeSeatDepartureService(prisma, lookups, notifications);
  const users = new UserService(
    prisma,
    audit,
    notifications,
    { getUserPermissions: async () => [] } as unknown as RoleService,
    tasks,
    { resolveActingHeadForOrgUnit: async () => [], refreshOrgUnitHeadVacancy: async () => undefined } as unknown as OrganizationService,
    {} as unknown as AuthProvider,
    {} as OrgUnitHeadService,
    { validatePositionAssignment: async () => undefined } as unknown as OrgPositionService,
    pools,
    { schedule: () => Promise.resolve() } as unknown as CommitteeTransferNoticeService,
    new ChangeRequestDepartureService(prisma, workflow, tasks, audit),
    seatDeparture,
  );

  let seat: Record<string, string> = {};

  interface Org {
    id: string;
    actorId: string;
    unitId: string;
    templateId: string;
    person: (name: string) => Promise<string>;
    /** A committee at the seeded stage `key`, with `holders` seated (userId → seat key). */
    committeeAt: (key: string, holders: Record<string, string>, opts?: { inactive?: boolean }) => Promise<{ id: string; instanceId: string; members: Record<string, string> }>;
  }

  async function org(): Promise<Org> {
    const slug = `acc306-${randomUUID().slice(0, 8)}`;
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } });
    await applyWorkflowSeed(prisma, o.id, [COMMITTEE_SEED]);
    const template = await prisma.workflowTemplate.findFirstOrThrow({ where: { organizationId: o.id, objectType: 'COMMITTEE', isDefault: true } });
    let n = 0;
    const person = async (name: string) =>
      (await prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE' } })).id;
    const actorId = await person('Administrator');
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Root', code: `R-${slug}` } });
    await writeStartingAssignments(prisma, o.id, actorId, actorId);

    const committeeAt = async (key: string, holders: Record<string, string>, opts: { inactive?: boolean } = {}) => {
      const stage = await prisma.workflowStage.findFirstOrThrow({ where: { workflowTemplateId: template.id, key } });
      const c = await prisma.committee.create({
        data: {
          organizationId: o.id,
          nameEn: `Committee ${key} ${n++}`,
          nameAr: `لجنة ${n}`,
          typeValueId: 'type',
          orgUnitId: unit.id,
          quorumCount: 1,
          meetingFrequency: 'MONTHLY',
          isActive: !opts.inactive,
        },
      });
      const instance = await prisma.workflowInstance.create({
        data: { organizationId: o.id, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: c.id, status: 'IN_PROGRESS', currentStageId: stage.id },
      });
      await prisma.workflowInstanceStage.create({ data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date() } });
      const members: Record<string, string> = {};
      for (const [userId, seatKey] of Object.entries(holders)) {
        const m = await prisma.committeeMember.create({
          data: { organizationId: o.id, committeeId: c.id, userId, roleValueId: seat[seatKey]!, isActive: true },
        });
        members[userId] = m.id;
      }
      return { id: c.id, instanceId: instance.id, members };
    };
    return { id: o.id, actorId, unitId: unit.id, templateId: template.id, person, committeeAt };
  }

  const member = (id: string) => prisma.committeeMember.findUniqueOrThrow({ where: { id } });
  const leftEvents = (committeeId: string, userId: string) =>
    prisma.committeeMembershipEvent.findMany({ where: { committeeId, userId, action: 'LEFT' }, orderBy: { createdAt: 'asc' } });
  const outcome = (p: Promise<unknown>): Promise<unknown> =>
    p.then(
      () => 'OK',
      (e: { getResponse?: () => unknown; code?: string }) => e.getResponse?.() ?? `ERROR ${e.code ?? String(e)}`,
    );

  beforeAll(async () => {
    await prisma.onModuleInit();
    await other.onModuleInit();
    await lookups.seedSystemData();
    const values = await prisma.lookupValue.findMany({
      where: { organizationId: null, category: { key: 'committee_member_role', organizationId: null } },
      select: { id: true, key: true },
    });
    seat = Object.fromEntries(values.map((v) => [v.key, v.id]));
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
    await other.onModuleDestroy();
  });

  // ── What ends ────────────────────────────────────────────────────────────────

  it('ends every active seat on an active committee, whatever its stage, with one LEFT event and an audit row each', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'chairman' });
    const forming = await o.committeeAt('formation', { [leaver]: 'member' });
    const review = await o.committeeAt('terms_review', { [leaver]: 'member' });
    const dissolving = await o.committeeAt('dissolution_pending', { [leaver]: 'member' });

    await users.deactivate(leaver, o.id, o.actorId);

    for (const c of [live, forming, review, dissolving]) {
      const m = await member(c.members[leaver]!);
      expect(m.isActive).toBe(false);
      expect(m.leftAt).not.toBeNull();
      const events = await leftEvents(c.id, leaver);
      expect(events.map((e) => [e.cause, e.approvedBy, e.reason, e.effectiveDate.getTime()])).toEqual([
        ['DEACTIVATION', o.actorId, null, m.leftAt!.getTime()],
      ]);
      const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: o.id, objectType: 'CommitteeMember', objectId: c.members[leaver] } });
      expect(auditRow?.metadata).toEqual(expect.objectContaining({ cause: 'DEACTIVATION', userId: leaver, committeeId: c.id }));
    }
    const userAudit = await prisma.auditLog.findFirst({ where: { organizationId: o.id, objectType: 'User', objectId: leaver } });
    expect(userAudit?.metadata).toEqual(expect.objectContaining({ endedCommitteeSeats: 4 }));
  });

  it('leaves a Dissolved committee’s roster, an inactive committee and a seat already left as they were', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const dissolved = await o.committeeAt('dissolved', { [leaver]: 'member' });
    const inactive = await o.committeeAt('active', { [leaver]: 'member' }, { inactive: true });
    const earlier = await o.committeeAt('active', { [leaver]: 'member' });
    const leftAt = new Date('2026-10-01T08:00:00Z');
    await prisma.committeeMember.update({ where: { id: earlier.members[leaver]! }, data: { isActive: false, leftAt } });

    await users.deactivate(leaver, o.id, o.actorId);

    expect((await member(dissolved.members[leaver]!)).isActive).toBe(true);
    expect((await member(inactive.members[leaver]!)).isActive).toBe(true);
    expect((await member(earlier.members[leaver]!)).leftAt).toEqual(leftAt);
    for (const c of [dissolved, inactive, earlier]) expect(await leftEvents(c.id, leaver)).toEqual([]);
  });

  // ── Never blocked ───────────────────────────────────────────────────────────

  it('is never blocked: the last Chairman of a committee in force still ends, and the seat then reads as empty', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'chairman' });
    expect((await emptyRequiredSeats(prisma, o.id, live.id)).map((s) => s.key)).toEqual(['secretary']);

    await users.deactivate(leaver, o.id, o.actorId);

    expect((await member(live.members[leaver]!)).isActive).toBe(false);
    expect((await emptyRequiredSeats(prisma, o.id, live.id)).map((s) => s.key)).toEqual(['chairman', 'secretary']);
  });

  // ── Between prepare() and the transaction (P167) ────────────────────────────

  /** Runs `between` after the real prepare() has read, before the deactivation's transaction. */
  function betweenPrepareAndTransaction(between: () => Promise<void>): jest.SpyInstance {
    const real = seatDeparture.prepare.bind(seatDeparture);
    return jest.spyOn(seatDeparture, 'prepare').mockImplementation(async (...args) => {
      const prepared = await real(...args);
      await between();
      return prepared;
    });
  }

  it('ends a seat added between prepare() and the transaction', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const first = await o.committeeAt('active', { [leaver]: 'member' });
    const later = await o.committeeAt('active', {});
    let addedId = '';
    const spy = betweenPrepareAndTransaction(async () => {
      addedId = (
        await prisma.committeeMember.create({
          data: { organizationId: o.id, committeeId: later.id, userId: leaver, roleValueId: seat['member']!, isActive: true },
        })
      ).id;
    });
    try {
      await users.deactivate(leaver, o.id, o.actorId);
    } finally {
      spy.mockRestore();
    }
    expect((await member(first.members[leaver]!)).isActive).toBe(false);
    expect((await member(addedId)).isActive).toBe(false);
    expect((await leftEvents(later.id, leaver)).map((e) => e.cause)).toEqual(['DEACTIVATION']);
  });

  it('leaves a committee deactivated between prepare() and the transaction untouched', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const closing = await o.committeeAt('active', { [leaver]: 'member' });
    const staying = await o.committeeAt('active', { [leaver]: 'member' });
    const spy = betweenPrepareAndTransaction(async () => {
      await prisma.committee.update({ where: { id: closing.id }, data: { isActive: false } });
    });
    try {
      await users.deactivate(leaver, o.id, o.actorId);
    } finally {
      spy.mockRestore();
    }
    expect((await member(closing.members[leaver]!)).isActive).toBe(true);
    expect(await leftEvents(closing.id, leaver)).toEqual([]);
    expect((await member(staying.members[leaver]!)).isActive).toBe(false);
  });

  // ── In the deactivation's transaction ───────────────────────────────────────

  it('a refused deactivation (the account owner) leaves every seat and writes no event', async () => {
    const o = await org();
    const leaver = await o.person('Owner');
    await prisma.organization.update({ where: { id: o.id }, data: { ownerUserId: leaver } });
    const live = await o.committeeAt('active', { [leaver]: 'chairman' });

    expect(await outcome(users.deactivate(leaver, o.id, o.actorId))).toEqual(expect.objectContaining({ code: 'ACCOUNT_OWNER_PROTECTED' }));
    expect((await member(live.members[leaver]!)).isActive).toBe(true);
    expect(await leftEvents(live.id, leaver)).toEqual([]);
  });

  it('a failure after the seats ended rolls them back with the deactivation', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'member' });
    const real = seatDeparture.endSeatsInTx.bind(seatDeparture);
    const spy = jest.spyOn(seatDeparture, 'endSeatsInTx').mockImplementation(async (tx, prepared) => {
      await real(tx, prepared);
      throw new Error('after the seats');
    });
    try {
      expect(await outcome(users.deactivate(leaver, o.id, o.actorId))).toBe('ERROR Error: after the seats');
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaver } })).status).toBe('ACTIVE');
    expect((await member(live.members[leaver]!)).isActive).toBe(true);
    expect(await leftEvents(live.id, leaver)).toEqual([]);
  });

  it('rolls an ended seat’s audit row back with the transaction', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'member' });
    const real = seatDeparture.endSeatsInTx.bind(seatDeparture);
    const spy = jest.spyOn(seatDeparture, 'endSeatsInTx').mockImplementation(async (tx, prepared) => {
      await real(tx, prepared);
      // The audit row exists inside the transaction…
      expect(prepared.applied.map((s) => s.memberId)).toEqual([live.members[leaver]]);
      throw new Error('after the seats');
    });
    try {
      expect(await outcome(users.deactivate(leaver, o.id, o.actorId))).toBe('ERROR Error: after the seats');
    } finally {
      spy.mockRestore();
    }
    // …and none survives the rollback.
    expect(await prisma.auditLog.count({ where: { organizationId: o.id, objectType: 'CommitteeMember', objectId: live.members[leaver] } })).toBe(0);
  });

  // ── The race, and the lock order ─────────────────────────────────────────────

  it('waits for a hand removal holding the committee row, then skips the seat: one LEFT event in all', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'member' });
    const memberId = live.members[leaver]!;

    // A removal by hand, as removeMember() writes it, holding the committee row
    // FOR UPDATE for a second while the deactivation starts.
    let locked!: () => void;
    const holding = new Promise<void>((r) => (locked = r));
    const removal = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${live.id} AND "organizationId" = ${o.id} FOR UPDATE`;
        locked();
        await sleep(1000);
        const now = new Date();
        await tx.committeeMember.update({ where: { id: memberId }, data: { leftAt: now, isActive: false } });
        await tx.committeeMembershipEvent.create({
          data: { organizationId: o.id, committeeId: live.id, userId: leaver, roleValueId: seat['member']!, action: 'LEFT', effectiveDate: now, reason: 'Stepped down', approvedBy: o.actorId },
        });
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await holding;
    await Promise.all([removal, users.deactivate(leaver, o.id, o.actorId)]);

    const events = await leftEvents(live.id, leaver);
    expect(events.map((e) => [e.reason, e.cause])).toEqual([['Stepped down', null]]);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: leaver } })).status).toBe('INACTIVE');
  });

  it('finishes with no deadlock beside a hand removal, a going-live transition and a change-request approve on the same committees', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const colleague = await o.person('Colleague');
    // Two committees, so the deactivation locks two rows in id order.
    const a = await o.committeeAt('active', { [leaver]: 'member', [colleague]: 'member' });
    const b = await o.committeeAt('terms_review', { [leaver]: 'chairman' });
    const request = await prisma.workflowInstance.create({
      data: { organizationId: o.id, workflowTemplateId: o.templateId, objectType: 'COMMITTEE', objectId: randomUUID(), status: 'IN_PROGRESS' },
    });

    // The engine's sequences, exactly as their code takes them, each pausing
    // between its locks so the deactivation runs in between:
    //   going live (ACC-286): the committee's instance FOR UPDATE, then its row FOR SHARE;
    //   change-request approve (ACC-239): the request's instance, the committee's
    //   instance, then the committee's row, each FOR UPDATE.
    const goingLive = other.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id = ${b.instanceId} FOR UPDATE`;
        await sleep(400);
        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${b.id} AND "organizationId" = ${o.id} FOR SHARE`;
        await sleep(400);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    const approve = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id = ${request.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "WorkflowInstance" WHERE id = ${a.instanceId} FOR UPDATE`;
        await sleep(400);
        await tx.$queryRaw`SELECT id FROM "Committee" WHERE id = ${a.id} AND "organizationId" = ${o.id} FOR UPDATE`;
        await sleep(400);
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
    await sleep(100);
    const results = await Promise.all([
      outcome(users.deactivate(leaver, o.id, o.actorId)),
      outcome(committees.removeMember(a.id, a.members[colleague]!, { reason: 'Rotated off' }, o.id, o.actorId, MEMBER_WRITER)),
      outcome(goingLive),
      outcome(approve),
    ]);

    expect(results).toEqual(['OK', 'OK', 'OK', 'OK']);
    expect((await leftEvents(a.id, leaver)).map((e) => e.cause)).toEqual(['DEACTIVATION']);
    expect((await leftEvents(b.id, leaver)).map((e) => e.cause)).toEqual(['DEACTIVATION']);
    expect((await leftEvents(a.id, colleague)).map((e) => e.reason)).toEqual(['Rotated off']);
  });

  // ── Isolation ───────────────────────────────────────────────────────────────

  it('should NOT return records belonging to a different tenant', async () => {
    const mine = await org();
    const theirs = await org();
    const leaver = await mine.person('Leaver');
    const namesake = await theirs.person('Leaver');
    const theirCommittee = await theirs.committeeAt('active', { [namesake]: 'chairman' });
    // A crafted row in their organisation naming my leaver's id: still theirs.
    const crafted = await prisma.committeeMember.create({
      data: { organizationId: theirs.id, committeeId: (await theirs.committeeAt('active', {})).id, userId: leaver, roleValueId: seat['member']!, isActive: true },
    });
    await mine.committeeAt('active', { [leaver]: 'member' });

    const prepared = await seatDeparture.prepare(mine.id, leaver, mine.actorId);
    expect(prepared.seats.every((s) => s.memberId !== crafted.id)).toBe(true);

    await users.deactivate(leaver, mine.id, mine.actorId);

    expect((await member(theirCommittee.members[namesake]!)).isActive).toBe(true);
    expect((await member(crafted.id)).isActive).toBe(true);
    expect(await prisma.committeeMembershipEvent.count({ where: { organizationId: theirs.id } })).toBe(0);
  });

  // ── Reactivation ────────────────────────────────────────────────────────────

  it('reactivation restores no seat; adding the person again reuses the row with a JOINED event', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const live = await o.committeeAt('active', { [leaver]: 'member' });
    await users.deactivate(leaver, o.id, o.actorId);

    await users.reactivate(leaver, o.id, o.actorId);
    expect((await member(live.members[leaver]!)).isActive).toBe(false);

    const added = await committees.addMember(live.id, { userId: leaver, roleValueId: seat['member']! }, o.id, o.actorId, MEMBER_WRITER);
    expect(added.id).toBe(live.members[leaver]);
    expect((await member(added.id)).isActive).toBe(true);
    const events = await prisma.committeeMembershipEvent.findMany({ where: { committeeId: live.id, userId: leaver }, orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => [e.action, e.cause])).toEqual([
      ['LEFT', 'DEACTIVATION'],
      ['JOINED', null],
    ]);
  });

  // ── Who is told ─────────────────────────────────────────────────────────────

  it('tells the committee’s officers once each, never the leaver or the person deactivating', async () => {
    const o = await org();
    const leaver = await o.person('Leaver');
    const chair = await o.person('Chair');
    const secretary = await o.person('Secretary');
    const live = await o.committeeAt('active', { [leaver]: 'member', [chair]: 'chairman', [secretary]: 'secretary', [o.actorId]: 'member' });

    await users.deactivate(leaver, o.id, o.actorId);

    const told = await prisma.notification.findMany({
      where: { organizationId: o.id, userId: { in: [leaver, chair, secretary, o.actorId] }, titleEn: { contains: 'committee seats ended' } },
      select: { userId: true, titleEn: true, titleAr: true, objectType: true, objectId: true },
    });
    expect(told.map((t) => t.userId).sort()).toEqual([chair, secretary].sort());
    for (const t of told) {
      expect(t.titleEn).toContain("Leaver's account was deactivated");
      expect(t.titleAr).toContain('أُلغي تفعيل حساب «Leaver»');
      // A member of the committee may open it: named, and linked.
      expect(t.titleEn).toContain(`Committee active`);
      expect([t.objectType, t.objectId]).toEqual(['COMMITTEE', live.id]);
    }
  });
});
