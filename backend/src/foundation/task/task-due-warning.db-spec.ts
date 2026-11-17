/**
 * ACC-313 PR 4 — the due-soon reminder against a REAL Postgres (npm run test:db).
 *
 * The unit spec asserts the SQL's shape; only a database can prove what it is
 * for: that the conditional claim (`… AND "dueWarnedAt" IS NULL RETURNING id`)
 * lets two workers running the same pass remind a task's people exactly once,
 * that a waiting pool's members are reminded by the pool's own rule, and that
 * another organisation's tasks are never read or stamped.
 *
 * It FAILS, never skips, without a database, and refuses any database that is
 * not on this machine — CI's ephemeral Postgres is on localhost — so it can
 * never write to the shared dev database.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { TaskDueWarningService } from './task-due-warning.service';
import { DEFAULT_TASK_SLA_NOTICES, DEFAULT_TASK_SLA_SETTINGS } from '../tenant/task-sla-settings';
import { DUE_WARNING_CLEARED } from './task-request-lifecycle';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

// Tuesday 17 Nov 2026, 10:00 in Riyadh (07:00 UTC): inside the default working day.
const NOW = new Date('2026-11-17T07:00:00.000Z');
const IN_ONE_HOUR = new Date('2026-11-17T08:00:00.000Z');
const IN_THREE_HOURS = new Date('2026-11-17T10:00:00.000Z');

describe('The due-soon reminder against a real database (ACC-313)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const notifications = new NotificationService(prisma, audit, { add: async () => undefined } as never);
  const worker = () => new TaskDueWarningService(prisma, calendar, notifications);

  /** An organisation with High warned 2 working hours before due (or every warning Off). */
  async function org(warned = true) {
    const slug = `acc313w-${randomUUID().slice(0, 8)}`;
    const settings = {
      taskSla: DEFAULT_TASK_SLA_SETTINGS,
      taskSlaNotices: { ...DEFAULT_TASK_SLA_NOTICES, warnBeforeDue: { ...DEFAULT_TASK_SLA_NOTICES.warnBeforeDue, HIGH: warned ? 'H2' : 'OFF' } },
    };
    const o = await prisma.organization.create({ data: { name: slug, slug, country: 'SA', settings } });
    const unit = await prisma.orgUnit.create({ data: { organizationId: o.id, nameEn: 'Quality', code: `Q-${randomUUID().slice(0, 6)}` } });
    const officer = await prisma.orgPosition.create({ data: { organizationId: o.id, nameEn: 'Quality Officer', grade: 2 } });
    let n = 0;
    const user = (name: string, extra: Record<string, unknown> = {}) =>
      prisma.user.create({ data: { organizationId: o.id, email: `${slug}-${n++}@example.test`, name, status: 'ACTIVE', ...extra } });
    const creator = await user('Creator');
    const holder = await user('Holder');
    const bea = await user('Bea', { positionId: officer.id, primaryOrgUnitId: unit.id });
    const dana = await user('Dana', { positionId: officer.id, primaryOrgUnitId: unit.id });
    return { id: o.id, unit: unit.id, officer: officer.id, creator: creator.id, holder: holder.id, bea: bea.id, dana: dana.id };
  }
  type Org = Awaited<ReturnType<typeof org>>;

  /** A High task due `dueAt`, held by `holder`, or waiting in the Quality Officer pool. */
  async function task(o: Org, dueAt: Date, holder: string | null) {
    return prisma.task.create({
      data: {
        organizationId: o.id,
        title: 'Collect the audit sample',
        sourceType: 'COMMITTEE',
        sourceId: randomUUID(),
        createdById: o.creator,
        priority: 'HIGH',
        status: 'PENDING',
        dueAt,
        ...(holder
          ? { assignees: { create: [{ userId: holder, assignedById: o.creator }] } }
          : { assignedOrgUnitId: o.unit, assignedPositionId: o.officer }),
      },
    });
  }
  const reminders = (taskId: string) =>
    prisma.notification.findMany({ where: { objectType: 'Task', objectId: taskId, titleEn: 'Task due soon' }, select: { userId: true } });
  const stampOf = async (taskId: string) => (await prisma.task.findFirstOrThrow({ where: { id: taskId }, select: { dueWarnedAt: true } })).dueWarnedAt;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('two workers running the same pass remind a task’s holder exactly once (ten rounds)', async () => {
    for (let round = 1; round <= 10; round++) {
      const o = await org();
      const t = await task(o, IN_ONE_HOUR, o.holder);

      await Promise.all([worker().sweep(NOW), worker().sweep(NOW)]);

      expect(await reminders(t.id)).toEqual([{ userId: o.holder }]);
      expect(await stampOf(t.id)).toEqual(NOW);
    }
  });

  it('a second pass reminds nobody again; a re-armed stamp reminds again', async () => {
    const o = await org();
    const t = await task(o, IN_ONE_HOUR, o.holder);

    await worker().sweep(NOW);
    await worker().sweep(NOW);
    expect(await reminders(t.id)).toHaveLength(1);

    // What every clearing path writes (DUE_WARNING_CLEARED, plan §3.3).
    await prisma.task.update({ where: { id: t.id }, data: DUE_WARNING_CLEARED });
    await worker().sweep(NOW);
    expect(await reminders(t.id)).toHaveLength(2);
  });

  it('a task outside its window is left unstamped and unreminded', async () => {
    const o = await org();
    const t = await task(o, IN_THREE_HOURS, o.holder);

    await worker().sweep(NOW);

    expect(await reminders(t.id)).toEqual([]);
    expect(await stampOf(t.id)).toBeNull();
  });

  it('a task still waiting in its pool reminds every member of the pool, once', async () => {
    const o = await org();
    const t = await task(o, IN_ONE_HOUR, null);

    await worker().sweep(NOW);
    await worker().sweep(NOW);

    expect((await reminders(t.id)).map((r) => r.userId).sort()).toEqual([o.bea, o.dana].sort());
  });

  it('should NOT return records belonging to a different tenant — the due-soon sweep stamps and reminds only its own organisation’s tasks', async () => {
    const a = await org();
    const b = await org(false);
    const mine = await task(a, IN_ONE_HOUR, a.holder);
    const theirs = await task(b, IN_ONE_HOUR, b.holder);

    await worker().sweep(NOW);

    expect(await reminders(mine.id)).toEqual([{ userId: a.holder }]);
    expect(await reminders(theirs.id)).toEqual([]);
    expect(await stampOf(theirs.id)).toBeNull();
  });
});
