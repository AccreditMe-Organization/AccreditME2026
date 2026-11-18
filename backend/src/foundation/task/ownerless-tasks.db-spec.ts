/**
 * ACC-86 — an open task with no current ACTIVE assignee is ownerless, whatever its
 * status, against a REAL Postgres (npm run test:db). Plan:
 * backend/Plans/step-86-ownerless-tasks.md.
 *
 * "Nobody is on it" means no current (removedAt null) row held by an ACTIVE user
 * (CURRENT_ACTIVE_ASSIGNEE, task-pool.ts). A row left current by someone who has
 * since become INACTIVE — a departure that stopped partway, or a co-assignee who
 * left first — puts nobody on it. Setup health (TASK_WITHOUT_OWNER) and the
 * Unassigned view read the same OWNERLESS_SQL; Available and Pick read the same
 * waiting rule; the departure, reject, release and pick count only ACTIVE others.
 *
 * Same guards as the other db-specs: it FAILS, never skips, without a database,
 * and refuses any database that is not on this machine.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { DelegationLabelService } from '../../common/services/delegation-label.service';
import { ObjectVisibilityService } from '../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TenantService } from '../tenant/tenant.service';
import { DEFAULT_TASK_SLA_SETTINGS } from '../tenant/task-sla-settings';
import { LookupService } from '../lookup/lookup.service';
import { SetupConditionDetectors } from '../setup-health/setup-condition.detectors';
import { TaskService } from './task.service';
import { TaskAuthorityService } from './task-authority.service';
import { TaskAssignmentService } from './task-assignment.service';
import { TaskSlaService } from './task-sla.service';
import { TaskClosedNoticeService } from './task-closed-notice.service';
import { TaskVisibilityService } from './task-visibility.service';
import { TaskRecordListService } from './task-record-list.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(180_000);

const MANAGER = ['committees:view', 'committees:view_all_tasks', 'committees:manage_tasks'];

describe('An open task with no current ACTIVE assignee is ownerless, on a real database (ACC-86)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const visibility = new ObjectVisibilityService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = { create: () => Promise.resolve({ id: randomUUID() }), createInAppMany: () => Promise.resolve(0) } as unknown as NotificationService;
  // The real defaults: a task going back to its pool restarts its pool clock from them.
  const tenant = { getTaskSla: () => Promise.resolve(DEFAULT_TASK_SLA_SETTINGS) } as unknown as TenantService;
  const authority = new TaskAuthorityService(prisma);
  const lookups = { getValues: () => Promise.resolve([]) } as unknown as LookupService;
  const tasks = new TaskService(
    prisma,
    audit,
    new DelegationLabelService(prisma),
    visibility,
    calendar,
    notifications,
    tenant,
    new TaskAssignmentService(prisma, authority, lookups),
    authority,
    new TaskSlaService(prisma, calendar),
    new TaskClosedNoticeService(prisma, notifications),
  );
  const detectors = new SetupConditionDetectors(prisma);
  const lists = new TaskRecordListService(prisma, visibility, tasks, new TaskVisibilityService(prisma, authority), calendar);

  interface Org {
    id: string;
    unit: string;
    committee: string;
    position: string;
    manager: string;
    person: (name: string, extra?: { status?: 'ACTIVE' | 'INACTIVE'; positionId?: string; primaryOrgUnitId?: string }) => Promise<string>;
    task: (
      title: string,
      opts: { status?: 'PENDING' | 'IN_PROGRESS' | 'ON_HOLD' | 'UNASSIGNED'; on?: { userId: string; pickedAt?: Date }[]; pool?: boolean },
    ) => Promise<string>;
  }

  async function org(): Promise<Org> {
    const slug = `acc86-${randomUUID().slice(0, 8)}`;
    const id = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    const unit = (await prisma.orgUnit.create({ data: { organizationId: id, nameEn: 'Quality', code: `Q-${slug}` } })).id;
    const committee = (await prisma.committee.create({ data: { organizationId: id, nameEn: 'Quality Committee', typeValueId: 'type', orgUnitId: unit } })).id;
    const position = (await prisma.orgPosition.create({ data: { organizationId: id, nameEn: 'Officer', grade: 5 } })).id;
    let n = 0;
    const person: Org['person'] = async (name, extra = {}) =>
      (
        await prisma.user.create({
          data: { organizationId: id, email: `${slug}-${n++}-${name}@example.test`, name, status: extra.status ?? 'ACTIVE', positionId: extra.positionId, primaryOrgUnitId: extra.primaryOrgUnitId },
        })
      ).id;
    const manager = await person('manager');
    const task: Org['task'] = async (title, opts) =>
      (
        await prisma.task.create({
          data: {
            organizationId: id,
            title,
            sourceType: 'COMMITTEE',
            sourceId: committee,
            createdById: manager,
            status: opts.status ?? 'PENDING',
            ...(opts.pool ? { assignedOrgUnitId: unit, assignedPositionId: position } : {}),
            assignees: { create: (opts.on ?? []).map((a) => ({ userId: a.userId, assignedById: manager, pickedAt: a.pickedAt ?? null })) },
          },
        })
      ).id;
    return { id, unit, committee, position, manager, person, task };
  }

  /** A departure that stopped partway: the person is INACTIVE, their rows still current. */
  const leaveWithoutReassigning = (userId: string) => prisma.user.update({ where: { id: userId }, data: { status: 'INACTIVE' } });
  const ownerless = async (o: Org) => (await detectors.tasksWithoutOwner(o.id)).map((c) => c.objectId).sort();
  const unassignedView = async (o: Org) => (await lists.list({ view: 'unassigned' } as never, o.id, { id: o.manager, permissions: MANAGER })).items.map((r) => r.id).sort();
  const current = (taskId: string) => prisma.taskAssignee.count({ where: { taskId, removedAt: null } });

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('the readers resolve it live', () => {
    it('an interrupted departure leaves PENDING, IN_PROGRESS and ON_HOLD tasks ownerless (Q-2), in Setup health and the Unassigned view alike', async () => {
      const o = await org();
      const leaver = await o.person('leaver');
      const ids = [
        await o.task('pending', { on: [{ userId: leaver }] }),
        await o.task('in progress', { status: 'IN_PROGRESS', on: [{ userId: leaver }] }),
        await o.task('on hold', { status: 'ON_HOLD', on: [{ userId: leaver }] }),
      ].sort();
      expect(await ownerless(o)).toEqual([]);

      await leaveWithoutReassigning(leaver);

      expect(await ownerless(o)).toEqual(ids);
      expect(await unassignedView(o)).toEqual(ids);
    });

    it('one ACTIVE and one INACTIVE current row: owned', async () => {
      const o = await org();
      const [stays, leaves] = [await o.person('stays'), await o.person('leaves')];
      await o.task('shared', { on: [{ userId: stays }, { userId: leaves }] });
      await leaveWithoutReassigning(leaves);
      expect(await ownerless(o)).toEqual([]);
      expect(await unassignedView(o)).toEqual([]);
    });

    it('a pool task held only by an INACTIVE user, its pool staffed: waiting in Available, pickable, and not ownerless — the pick ends the stale row', async () => {
      const o = await org();
      const picker = await o.person('picker', { positionId: o.position, primaryOrgUnitId: o.unit });
      const member = await o.person('member', { positionId: o.position, primaryOrgUnitId: o.unit });
      const t = await o.task('pool', { pool: true, on: [{ userId: picker, pickedAt: new Date() }] });
      await leaveWithoutReassigning(picker);

      expect(await ownerless(o)).toEqual([]);
      expect((await tasks.getAvailableToPick(member, o.id)).map((r) => r.id)).toEqual([t]);

      await tasks.pick(t, member, o.id);
      const rows = await prisma.taskAssignee.findMany({ where: { taskId: t, removedAt: null }, select: { userId: true } });
      expect(rows).toEqual([{ userId: member }]);
    });

    it('the same pool task with nobody in its pool: ownerless', async () => {
      const o = await org();
      const picker = await o.person('picker', { positionId: o.position, primaryOrgUnitId: o.unit });
      const t = await o.task('pool', { pool: true, on: [{ userId: picker, pickedAt: new Date() }] });
      await leaveWithoutReassigning(picker);
      expect(await ownerless(o)).toEqual([t]);
    });
  });

  describe('the writers count only ACTIVE others', () => {
    it('a departure leaving only an INACTIVE co-assignee makes the task UNASSIGNED and ends the stale row (Q-1), recorded on the audit row', async () => {
      const o = await org();
      const [first, second] = [await o.person('first'), await o.person('second')];
      const t = await o.task('shared', { on: [{ userId: first }, { userId: second }] });
      await leaveWithoutReassigning(first);
      await leaveWithoutReassigning(second);

      const result = await tasks.reassignAllForUser(second, null, o.id, o.manager);

      expect(result).toEqual({ reassignedCount: 0, unassignedCount: 1, returnedToPoolCount: 0 });
      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe('UNASSIGNED');
      expect(await current(t)).toBe(0);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: o.id, objectId: t, action: 'DELEGATE' } });
      expect(row.metadata).toMatchObject({ event: 'departure_reassignment', endedInactiveRows: 1 });
    });

    it('a pool task in the same shape returns to its pool, the stale row ended', async () => {
      const o = await org();
      const [first, second] = [await o.person('first'), await o.person('second')];
      await o.person('member', { positionId: o.position, primaryOrgUnitId: o.unit });
      const t = await o.task('pool', { pool: true, on: [{ userId: first }, { userId: second }] });
      await leaveWithoutReassigning(first);
      await leaveWithoutReassigning(second);

      expect(await tasks.reassignAllForUser(second, null, o.id, o.manager)).toEqual({ reassignedCount: 0, unassignedCount: 0, returnedToPoolCount: 1 });
      expect(await current(t)).toBe(0);
    });

    it('the last ACTIVE assignee rejecting, beside an INACTIVE one, makes the task REJECTED', async () => {
      const o = await org();
      const [active, gone] = [await o.person('active'), await o.person('gone')];
      const t = await o.task('shared', { on: [{ userId: active }, { userId: gone }] });
      await leaveWithoutReassigning(gone);

      await tasks.reject(t, { reason: 'Not ours' }, active, o.id);

      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe('REJECTED');
    });

    it('releasing a pool task beside an INACTIVE holder returns it to its pool, ends the stale row and records it', async () => {
      const o = await org();
      const [picker, gone] = [await o.person('picker', { positionId: o.position, primaryOrgUnitId: o.unit }), await o.person('gone')];
      const t = await o.task('pool', { pool: true, status: 'IN_PROGRESS', on: [{ userId: picker, pickedAt: new Date() }, { userId: gone }] });
      await leaveWithoutReassigning(gone);

      await tasks.release(t, { reason: 'Not mine after all' }, picker, o.id);

      expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe('PENDING');
      expect(await current(t)).toBe(0);
      const row = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: o.id, objectId: t, action: 'UPDATE' }, orderBy: { createdAt: 'desc' } });
      expect(row.metadata).toMatchObject({ event: 'released', returnedToPool: true, endedInactiveRows: 1 });
    });

    it('two departures of a task’s two assignees at once: UNASSIGNED exactly once, ten times over', async () => {
      for (let round = 0; round < 10; round++) {
        const o = await org();
        const [a, b] = [await o.person('a'), await o.person('b')];
        const t = await o.task('shared', { on: [{ userId: a }, { userId: b }] });
        await leaveWithoutReassigning(a);
        await leaveWithoutReassigning(b);

        const results = await Promise.all([tasks.reassignAllForUser(a, null, o.id, o.manager), tasks.reassignAllForUser(b, null, o.id, o.manager)]);

        expect({ round, unassigned: results.reduce((n, r) => n + r.unassignedCount, 0) }).toEqual({ round, unassigned: 1 });
        expect((await prisma.task.findUniqueOrThrow({ where: { id: t } })).status).toBe('UNASSIGNED');
        expect(await current(t)).toBe(0);
      }
    });
  });

  it('should NOT return records belonging to a different tenant', async () => {
    const mine = await org();
    const other = await org();
    const leaver = await other.person('leaver');
    const member = await other.person('member', { positionId: other.position, primaryOrgUnitId: other.unit });
    await other.task('theirs', { on: [{ userId: leaver }] });
    await other.task('their pool', { pool: true, on: [{ userId: leaver, pickedAt: new Date() }] });
    await leaveWithoutReassigning(leaver);
    void member;

    expect(await ownerless(mine)).toEqual([]);
    expect(await unassignedView(mine)).toEqual([]);
    const mineMember = await mine.person('member', { positionId: mine.position, primaryOrgUnitId: mine.unit });
    expect(await tasks.getAvailableToPick(mineMember, mine.id)).toEqual([]);
    // And the other organisation does see its own.
    expect((await ownerless(other)).length).toBe(1);
  });
});
