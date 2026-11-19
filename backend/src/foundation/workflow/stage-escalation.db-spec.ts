/**
 * ACC-105 — a stage's SLA escalation rules, against a REAL Postgres (npm run test:db).
 *
 * A stage entry past its deadline is read again on every sweep until each of
 * its rules has fired once (keyed on escalatedRuleIndexes), or it is left:
 *   - defect 1: rules at several thresholds each fire, across sweeps, once;
 *   - defect 2: a deadline that lapses outside working hours marks nothing,
 *     and the rule fires on the first sweep inside them;
 *   - defect 3: afterHours is WORKING hours after slaDueAt (working-time.ts);
 *   - recipients are ACTIVE people only, never twice for one rule, and a role
 *     with no active holder is skipped;
 *   - two sweeps at the same moment fire a rule once (the conditional claim).
 * The sweep reads the real calendar and writes real rows; the notices are
 * recorded by a stub. Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { useFixedClock } from '../../common/testing/fixed-clock';
import { SlaMonitorProcessor } from './sla-monitor.processor';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(120_000);
const HOUR = 3_600_000;

type Rule = { afterHours: number; notifyUserId?: string; notifyRoleId?: string };

describe('Stage SLA escalation fires each rule once, in working hours, on a real database (ACC-105)', () => {
  const prisma = new PrismaService();
  const audit = new AuditLogService(prisma);
  const calendar = new WorkingCalendarService(prisma, audit);
  const told: { userId: string; organizationId: string }[] = [];
  const notifications = {
    create: async (dto: { userId: string }, organizationId: string) => {
      told.push({ userId: dto.userId, organizationId });
      return { id: randomUUID() };
    },
  };
  const unused = {} as never;
  const processor = new SlaMonitorProcessor(
    prisma,
    audit,
    calendar,
    notifications as never,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused,
    unused, // ACC-316 PR 3b — the meeting invitee sync; this spec runs other sweeps only
    unused, // ACC-316 PR 4 — the meeting review reminder, likewise
  );
  const sweepAt = async (iso: string): Promise<void> => {
    useFixedClock(new Date(iso));
    try {
      await (processor as unknown as { sweepBreachedStageEscalations(now: Date): Promise<void> }).sweepBreachedStageEscalations(new Date(iso));
    } finally {
      jest.useRealTimers();
    }
  };

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  beforeEach(() => {
    told.length = 0;
  });

  const ALWAYS = { timezone: 'UTC', workingDays: [0, 1, 2, 3, 4, 5, 6], workingHoursStart: '00:00', workingHoursEnd: '23:59' };
  const OFFICE = { timezone: 'UTC', workingDays: [1, 2, 3, 4, 5], workingHoursStart: '08:00', workingHoursEnd: '16:00' };

  /** An organisation, its calendar and people, and one stage entry due at `slaDueAt` with `rules`. */
  async function entry(cal: typeof ALWAYS, slaDueAt: string, rules: (ids: People) => Rule[]): Promise<{ entryId: string; people: People }> {
    const slug = `acc105-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA' } })).id;
    await prisma.workingCalendar.create({ data: { organizationId: org, ...cal } });
    const user = async (key: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') =>
      (await prisma.user.create({ data: { organizationId: org, email: `${slug}-${key}@example.test`, name: key, status } })).id;
    const people: People = { org, a: await user('a'), b: await user('b'), gone: await user('gone', 'INACTIVE'), role: '', emptyRole: '' };
    people.role = (await prisma.role.create({ data: { organizationId: org, nameEn: 'Quality reviewers' } })).id;
    people.emptyRole = (await prisma.role.create({ data: { organizationId: org, nameEn: 'Nobody active' } })).id;
    await prisma.userRole.createMany({ data: [{ userId: people.a, roleId: people.role }, { userId: people.gone, roleId: people.role }, { userId: people.gone, roleId: people.emptyRole }] });
    const template = await prisma.workflowTemplate.create({ data: { organizationId: org, nameEn: 'Committee', objectType: 'COMMITTEE' } });
    const stage = await prisma.workflowStage.create({
      data: { workflowTemplateId: template.id, nameEn: 'Terms Review', order: 1, slaWorkingHours: 8, whoMode: 'ANY_ONE', escalationConfig: rules(people) },
    });
    const instance = await prisma.workflowInstance.create({
      data: { organizationId: org, workflowTemplateId: template.id, objectType: 'COMMITTEE', objectId: randomUUID(), currentStageId: stage.id },
    });
    const e = await prisma.workflowInstanceStage.create({
      data: { workflowInstanceId: instance.id, stageId: stage.id, enteredAt: new Date(Date.parse(slaDueAt) - 8 * HOUR), slaDueAt: new Date(slaDueAt) },
    });
    return { entryId: e.id, people };
  }
  interface People { org: string; a: string; b: string; gone: string; role: string; emptyRole: string }
  const toldIn = (org: string) => told.filter((t) => t.organizationId === org).map((t) => t.userId).sort();

  it('defect 1: rules at several thresholds each fire as their threshold passes, across sweeps, each once', async () => {
    const { entryId, people } = await entry(ALWAYS, '2026-11-16T09:00:00Z', (p) => [
      { afterHours: 1, notifyUserId: p.a },
      { afterHours: 5, notifyUserId: p.b },
    ]);
    await sweepAt('2026-11-16T11:00:00Z');
    expect(toldIn(people.org)).toEqual([people.a]);
    await sweepAt('2026-11-16T15:00:00Z');
    await sweepAt('2026-11-16T16:00:00Z');
    expect(toldIn(people.org)).toEqual([people.a, people.b].sort());
    const row = await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: entryId } });
    expect([row.slaBreached, [...row.escalatedRuleIndexes].sort()]).toEqual([true, [0, 1]]);
  });

  it('defect 2: a deadline that lapses outside working hours marks nothing, and fires once they resume', async () => {
    // Friday 20 Nov 2026, 17:00 UTC: after the office closes.
    const { entryId, people } = await entry(OFFICE, '2026-11-20T17:00:00Z', (p) => [{ afterHours: 1, notifyUserId: p.a }]);
    await sweepAt('2026-11-20T18:00:00Z'); // Friday evening
    await sweepAt('2026-11-21T10:00:00Z'); // Saturday
    expect(toldIn(people.org)).toEqual([]);
    expect((await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: entryId } })).escalatedRuleIndexes).toEqual([]);
    await sweepAt('2026-11-23T09:00:00Z'); // Monday: one working hour since the deadline
    expect(toldIn(people.org)).toEqual([people.a]);
  });

  it('defect 2: a rule whose threshold passed during the day waits for working hours, marking nothing meanwhile', async () => {
    // Due Friday 10:00 with a 2-hour rule: its threshold passes at 12:00, but no
    // sweep runs until 18:00, after the office closes.
    const { entryId, people } = await entry(OFFICE, '2026-11-20T10:00:00Z', (p) => [{ afterHours: 2, notifyUserId: p.a }]);
    await sweepAt('2026-11-20T18:00:00Z');
    expect(toldIn(people.org)).toEqual([]);
    expect((await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: entryId } })).escalatedRuleIndexes).toEqual([]);
    await sweepAt('2026-11-23T08:15:00Z'); // Monday, inside working hours
    expect(toldIn(people.org)).toEqual([people.a]);
  });

  it('defect 3: afterHours counts WORKING hours after the deadline, not clock hours', async () => {
    // Due Friday 15:00; 4 working hours later is Monday 11:00 (1 on Friday, 3 on Monday).
    const { people } = await entry(OFFICE, '2026-11-20T15:00:00Z', (p) => [{ afterHours: 4, notifyUserId: p.a }]);
    await sweepAt('2026-11-23T08:30:00Z'); // 65.5 clock hours, 1.5 working hours
    expect(toldIn(people.org)).toEqual([]);
    await sweepAt('2026-11-23T11:00:00Z');
    expect(toldIn(people.org)).toEqual([people.a]);
  });

  it('only ACTIVE people are told, never twice for one rule, and a role with no active holder is skipped', async () => {
    const { entryId, people } = await entry(ALWAYS, '2026-11-16T09:00:00Z', (p) => [
      { afterHours: 1, notifyUserId: p.gone },
      { afterHours: 1, notifyUserId: p.a, notifyRoleId: p.role },
      { afterHours: 1, notifyRoleId: p.emptyRole },
    ]);
    await sweepAt('2026-11-16T11:00:00Z');
    expect(toldIn(people.org)).toEqual([people.a]);
    // Every rule is done, told or not: it is not tried again.
    expect([...(await prisma.workflowInstanceStage.findUniqueOrThrow({ where: { id: entryId } })).escalatedRuleIndexes].sort()).toEqual([0, 1, 2]);
    await sweepAt('2026-11-16T12:00:00Z');
    expect(toldIn(people.org)).toEqual([people.a]);
  });

  it('two sweeps at the same moment fire a rule once', async () => {
    const { people } = await entry(ALWAYS, '2026-11-16T09:00:00Z', (p) => [{ afterHours: 1, notifyUserId: p.a }]);
    useFixedClock(new Date('2026-11-16T11:00:00Z'));
    try {
      const sweep = (processor as unknown as { sweepBreachedStageEscalations(now: Date): Promise<void> }).sweepBreachedStageEscalations.bind(processor);
      await Promise.all([sweep(new Date('2026-11-16T11:00:00Z')), sweep(new Date('2026-11-16T11:00:00Z'))]);
    } finally {
      jest.useRealTimers();
    }
    expect(toldIn(people.org)).toEqual([people.a]);
  });

  it('an entry that has been left is not read', async () => {
    const { entryId, people } = await entry(ALWAYS, '2026-11-16T09:00:00Z', (p) => [{ afterHours: 1, notifyUserId: p.a }]);
    await prisma.workflowInstanceStage.update({ where: { id: entryId }, data: { exitedAt: new Date('2026-11-16T10:00:00Z') } });
    await sweepAt('2026-11-16T11:00:00Z');
    expect(toldIn(people.org)).toEqual([]);
  });
});
