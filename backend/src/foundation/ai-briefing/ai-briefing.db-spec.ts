/**
 * ACC-198 — the double press, against a REAL Postgres (npm run test:db).
 *
 * The claim is one INSERT … ON CONFLICT on AiBriefing's (organizationId,
 * userId) key; only a database can prove that two presses at the same moment
 * make ONE model call. The gateway is a counting stub (no model, no credits);
 * everything else — the claim, the save, the release — is the real service on
 * real rows. Fails, never skips, without a local database (ACC-120).
 */
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AiBriefingService, CLAIM_STALE_MS } from './ai-briefing.service';
import { AiService } from '../ai/ai.service';
import { TaskService } from '../task/task.service';
import { TaskRequestService } from '../task/task-request.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('test:db needs DATABASE_URL — it fails rather than skips without a database (ACC-120).');
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`test:db refuses a non-local database (${host}). It writes rows and must never reach a shared database.`);
}

jest.setTimeout(60_000);

const NOW = new Date('2026-10-13T06:00:00Z');

describe('AI briefing claim against a real database (ACC-198)', () => {
  const prisma = new PrismaService();
  let modelCalls = 0;

  // A slow, counting stand-in for the gateway: long enough that both presses
  // are in flight together.
  const ai = {
    run: async () => {
      modelCalls += 1;
      await new Promise((r) => setTimeout(r, 300));
      return { content: '{"lead": "One task is overdue.", "focus": []}', creditCost: 5, inputTokens: 1, outputTokens: 1, truncated: false };
    },
  };
  const tasks = {
    getMyTasks: async () => [{ id: 'task-1', title: 'Late', status: 'PENDING', dueAt: new Date('2026-10-01T00:00:00Z') }],
    getAvailableToPick: async () => [],
  };
  const service = new AiBriefingService(
    prisma,
    ai as unknown as AiService,
    tasks as unknown as TaskService,
    { awaitingDecision: async () => [] } as unknown as TaskRequestService,
    { getForUser: async () => ({ data: [] }) } as unknown as NotificationService,
    { getEffectiveTimeZone: async () => 'Asia/Riyadh' } as unknown as WorkingCalendarService,
  );
  const ADMIN_PERMS = ['tenant:manage_config'];

  async function tenantWithAdmins(n: number): Promise<{ org: string; users: string[] }> {
    const slug = `acc198-${randomUUID().slice(0, 8)}`;
    const org = await prisma.organization.create({
      data: {
        name: slug,
        slug,
        country: 'SA',
        bootstrappedAt: new Date('2026-09-21T04:39:49Z'),
        aiMonthlyCredits: 2000,
        aiCreditsPeriodStart: new Date('2026-09-21T04:39:49Z'),
        aiCreditsRenewsAt: new Date('2099-01-01T00:00:00Z'),
      },
    });
    await prisma.aiFeatureCost.upsert({
      where: { featureKey: 'morning_briefing' },
      // Open to every organisation on this throwaway database, whatever an
      // earlier run (or a seed proof) left the row as.
      update: { creditCost: 5, restricted: false, allowedOrganizationIds: [] },
      create: { featureKey: 'morning_briefing', creditCost: 5, restricted: false },
    });
    const users: string[] = [];
    for (let i = 0; i < n; i++) {
      const u = await prisma.user.create({ data: { organizationId: org.id, email: `${slug}-${i}@example.test`, name: `Admin ${i}` } });
      users.push(u.id);
    }
    return { org: org.id, users };
  }

  beforeAll(async () => {
    await prisma.onModuleInit();
  });
  afterAll(async () => {
    await prisma.onModuleDestroy();
  });
  beforeEach(() => {
    modelCalls = 0;
  });

  it('two presses by one user at the same moment → ONE model call, one briefing, the other refused 409', async () => {
    const { org, users } = await tenantWithAdmins(1);
    const viewer = { id: users[0]!, permissions: ADMIN_PERMS };

    const results = await Promise.allSettled([service.make(viewer, org, 'en', NOW), service.make(viewer, org, 'en', NOW)]);

    expect(modelCalls).toBe(1);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { getResponse(): { code: string } }).getResponse().code).toBe('AI_BRIEFING_IN_PROGRESS');
    const rows = await prisma.aiBriefing.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.generatingSince).toBeNull();
    expect(rows[0]!.creditCost).toBe(5);
  });

  it('two admins in one organisation each get their own run (the claim is per user, D7)', async () => {
    const { org, users } = await tenantWithAdmins(2);
    await Promise.all(users.map((id) => service.make({ id, permissions: ADMIN_PERMS }, org, 'en', NOW)));
    expect(modelCalls).toBe(2);
    expect(await prisma.aiBriefing.count({ where: { organizationId: org } })).toBe(2);
  });

  it('a claim left by a crashed run is taken over once stale, and not before', async () => {
    const { org, users } = await tenantWithAdmins(1);
    const userId = users[0]!;
    await prisma.aiBriefing.create({
      data: { organizationId: org, userId, language: 'en', lead: '', focus: [], groups: [], creditCost: 0, generatingSince: NOW },
    });
    await expect(service.make({ id: userId, permissions: ADMIN_PERMS }, org, 'en', new Date(NOW.getTime() + 60_000))).rejects.toBeDefined();
    expect(modelCalls).toBe(0);

    await service.make({ id: userId, permissions: ADMIN_PERMS }, org, 'en', new Date(NOW.getTime() + CLAIM_STALE_MS + 1_000));
    expect(modelCalls).toBe(1);
  });

  it('a press after a finished run makes a new one, replacing the last (one row per user)', async () => {
    const { org, users } = await tenantWithAdmins(1);
    const viewer = { id: users[0]!, permissions: ADMIN_PERMS };
    await service.make(viewer, org, 'en', NOW);
    await service.make(viewer, org, 'ar', new Date(NOW.getTime() + 1_000));
    expect(modelCalls).toBe(2);
    const rows = await prisma.aiBriefing.findMany({ where: { organizationId: org } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.language).toBe('ar');
  });

  it('should NOT return records belonging to a different tenant — one organisation\'s claim never blocks another\'s', async () => {
    const a = await tenantWithAdmins(1);
    const b = await tenantWithAdmins(1);
    await Promise.all([
      service.make({ id: a.users[0]!, permissions: ADMIN_PERMS }, a.org, 'en', NOW),
      service.make({ id: b.users[0]!, permissions: ADMIN_PERMS }, b.org, 'en', NOW),
    ]);
    expect(modelCalls).toBe(2);
    expect((await service.read({ id: a.users[0]!, permissions: ADMIN_PERMS }, b.org, NOW)).briefing).toBeNull();
  });
});
