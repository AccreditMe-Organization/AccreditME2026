/**
 * ACC-313 — the task SLA writes against a REAL Postgres (npm run test:db).
 *
 * The unit spec asserts the SQL's shape; only a database can prove what it is
 * for: that the Organization row lock keeps two section saves from losing
 * each other's fields, that jsonb_set writes settings.taskSla and nothing else,
 * and that the history reads the organisation's own rows, legacy ones included.
 *
 * It FAILS, never skips, without a database: a spec that quietly skips is a
 * vacuous pass (ACC-120). It also refuses any database that is not on this
 * machine — CI's ephemeral Postgres is on localhost — so it can never write to
 * the shared dev database.
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TaskSlaPolicyService } from './task-sla-policy.service';
import { DEFAULT_TASK_SLA_SETTINGS } from './task-sla-settings';
import { ITaskSlaSettings } from './interfaces/tenant.interface';

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

describe('Task SLA policy against a real database (ACC-313)', () => {
  const prisma = new PrismaService();
  const policy = new TaskSlaPolicyService(prisma, new AuditLogService(prisma));

  async function organisation(settings?: object): Promise<{ org: string; actor: string }> {
    const slug = `acc313-${randomUUID().slice(0, 8)}`;
    const org = (await prisma.organization.create({ data: { name: slug, slug, country: 'SA', ...(settings ? { settings } : {}) } })).id;
    const actor = (
      await prisma.user.create({ data: { organizationId: org, email: `${slug}@example.test`, name: 'Nora Al-Otaibi', status: 'ACTIVE' } })
    ).id;
    return { org, actor };
  }

  async function settingsOf(id: string): Promise<{ taskSla: ITaskSlaSettings } & Record<string, unknown>> {
    const row = await prisma.organization.findFirstOrThrow({ where: { id }, select: { settings: true } });
    return row.settings as { taskSla: ITaskSlaSettings } & Record<string, unknown>;
  }

  const limits = (due: number) => Object.fromEntries(PRIORITIES.map((p) => [p, { dueAfterHours: due }])) as Record<(typeof PRIORITIES)[number], { dueAfterHours: number }>;
  const escalation = (manager: number, head: number) =>
    Object.fromEntries(PRIORITIES.map((p) => [p, { managerEscalationAfterHours: manager, headEscalationAfterHours: head }])) as Record<
      (typeof PRIORITIES)[number],
      { managerEscalationAfterHours: number; headEscalationAfterHours: number }
    >;

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('a limits save and an escalation save at once never lose each other’s fields (ten rounds)', async () => {
    const { org, actor } = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

    for (let round = 1; round <= 10; round++) {
      await Promise.all([
        policy.saveLimits(org, limits(100 + round), actor),
        policy.saveEscalation(org, escalation(10 + round, 20 + round), actor),
      ]);
      const { taskSla } = await settingsOf(org);
      for (const p of PRIORITIES) {
        expect(taskSla[p]).toEqual({ dueAfterHours: 100 + round, managerEscalationAfterHours: 10 + round, headEscalationAfterHours: 20 + round });
      }
    }
  });

  it('writes settings.taskSla and nothing else: every other key survives', async () => {
    const { org, actor } = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS, modules: { documents: true }, ai: { enabled: false } });

    await policy.saveEscalation(org, escalation(5, 6), actor);

    const settings = await settingsOf(org);
    expect(settings['modules']).toEqual({ documents: true });
    expect(settings['ai']).toEqual({ enabled: false });
    expect(settings.taskSla.HIGH).toEqual({ dueAfterHours: 16, managerEscalationAfterHours: 5, headEscalationAfterHours: 6 });
  });

  it('an organisation with no settings at all gets the defaults merged with the section', async () => {
    const { org, actor } = await organisation();

    await policy.saveLimits(org, limits(30), actor);

    const { taskSla } = await settingsOf(org);
    expect(taskSla.LOW).toEqual({ ...DEFAULT_TASK_SLA_SETTINGS.LOW, dueAfterHours: 30 });
  });

  it('a save that changes nothing writes no audit row', async () => {
    const { org, actor } = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

    await policy.saveLimits(org, limits(77), actor);
    await policy.saveLimits(org, limits(77), actor);

    expect((await policy.history(org)).total).toBe(1);
  });

  it('the history: newest first, with the values, a legacy row without them, and paging', async () => {
    const { org, actor } = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS });
    // A save made before ACC-313: the Organization's own row, an event name only.
    await prisma.auditLog.create({
      data: { organizationId: org, actorId: actor, action: 'UPDATE', objectType: 'Organization', objectId: org, metadata: { event: 'task_sla_updated' }, createdAt: new Date('2026-11-01T08:00:00Z') },
    });
    await policy.saveLimits(org, limits(50), actor);
    await policy.saveEscalation(org, escalation(3, 4), actor);

    const page = await policy.history(org);
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.kind)).toEqual(['escalation', 'limits', 'legacy']);
    expect(page.rows[1]?.after).toEqual(limits(50));
    expect(page.rows[1]?.actorName).toBe('Nora Al-Otaibi');
    expect(page.rows[2]).toEqual(expect.objectContaining({ kind: 'legacy', before: null, after: null }));

    const second = await policy.history(org, 2, 2);
    expect(second.rows.map((r) => r.kind)).toEqual(['legacy']);
  });

  it('should NOT return records belonging to a different tenant — the task SLA history and writes', async () => {
    const a = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS });
    const b = await organisation({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

    await policy.saveLimits(a.org, limits(11), a.actor);

    expect((await policy.history(b.org)).total).toBe(0);
    expect((await settingsOf(b.org)).taskSla).toEqual(DEFAULT_TASK_SLA_SETTINGS);
  });
});
