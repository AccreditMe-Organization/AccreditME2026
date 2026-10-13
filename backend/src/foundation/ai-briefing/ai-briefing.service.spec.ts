import { ConflictException } from '@nestjs/common';
import { AiBriefingService, BriefingViewer } from './ai-briefing.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiService } from '../ai/ai.service';
import { AiRefusalException } from '../ai/ai-refusal';
import { TaskService } from '../task/task.service';
import { TaskRequestService } from '../task/task-request.service';
import { NotificationService } from '../notification/notification.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const ADMIN: BriefingViewer = { id: 'admin-1', permissions: ['tenant:manage_config', 'tenant:view'] };
const NON_ADMIN: BriefingViewer = { id: 'user-2', permissions: ['tasks:view'] };
const NOW = new Date('2026-10-13T06:00:00Z'); // 09:00 Riyadh

const AI_ON = {
  aiMonthlyCredits: 2000,
  aiPendingMonthlyCredits: null,
  aiCreditsUsed: 0,
  aiCreditsPeriodStart: new Date('2026-09-21T04:39:49Z'),
  aiCreditsRenewsAt: new Date('2099-10-21T00:00:00Z'),
  bootstrappedAt: new Date('2026-09-21T04:39:49Z'),
  createdAt: new Date('2026-09-21T04:38:14Z'),
  settings: null,
};
const OPEN_FEATURE = [{ featureKey: 'morning_briefing', creditCost: 5, restricted: true, allowedOrganizationIds: [ORG] }];

/** A mock's arguments for one call, typed so a spec never reads `any`. */
function argsOf(fn: jest.Mock, call = 0): unknown[] {
  return (fn.mock.calls as unknown[][])[call] ?? [];
}

function setup() {
  const prisma = {
    organization: { findFirst: jest.fn().mockResolvedValue(AI_ON) },
    aiFeatureCost: { findMany: jest.fn().mockResolvedValue(OPEN_FEATURE) },
    aiBriefing: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    task: { findMany: jest.fn().mockResolvedValue([]) },
    taskRequest: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([{ id: 'row-1' }]),
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const ai = {
    run: jest.fn().mockResolvedValue({
      content: '{"lead": "One task is overdue.", "focus": [{"key": "T1", "reason": "It is a week late."}, {"key": "ZZ", "reason": "invented"}]}',
      creditCost: 5,
      inputTokens: 100,
      outputTokens: 60,
      truncated: false,
    }),
  };
  const tasks = {
    getMyTasks: jest.fn().mockResolvedValue([
      { id: 'task-1', title: 'Close CAPA-0912', status: 'PENDING', dueAt: new Date('2026-10-06T09:00:00Z'), description: 'SECRET-DESCRIPTION' },
    ]),
    getAvailableToPick: jest.fn().mockResolvedValue([]),
  };
  const requests = { awaitingDecision: jest.fn().mockResolvedValue([]) };
  const notifications = { getForUser: jest.fn().mockResolvedValue({ data: [] }) };
  const calendar = { getEffectiveTimeZone: jest.fn().mockResolvedValue('Asia/Riyadh') };
  const service = new AiBriefingService(
    prisma as unknown as PrismaService,
    ai as unknown as AiService,
    tasks as unknown as TaskService,
    requests as unknown as TaskRequestService,
    notifications as unknown as NotificationService,
    calendar as unknown as WorkingCalendarService,
  );
  return { service, prisma, ai, tasks, requests, notifications };
}

async function refusal(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected a refusal');
}

describe('AiBriefingService.make (ACC-198)', () => {
  it('gathers only the caller\'s own work, calls the gateway with morning_briefing and a counts-only description, and saves', async () => {
    const { service, prisma, ai, tasks, requests, notifications } = setup();
    await service.make(ADMIN, ORG, 'en', NOW);

    expect(tasks.getMyTasks).toHaveBeenCalledWith(ADMIN.id, ORG, {}, ADMIN.permissions);
    expect(tasks.getAvailableToPick).toHaveBeenCalledWith(ADMIN.id, ORG, ADMIN.permissions);
    expect(requests.awaitingDecision).toHaveBeenCalledWith({ id: ADMIN.id, permissions: ADMIN.permissions }, ORG);
    expect(notifications.getForUser).toHaveBeenCalledWith(ADMIN.id, ORG, { status: 'UNREAD', pageSize: 20 });

    const [feature, context, request] = ai.run.mock.calls[0] as [string, { organizationId: string; actorId: string }, { prompt: string; system: string; description: string }];
    expect(feature).toBe('morning_briefing');
    expect(context).toEqual({ organizationId: ORG, actorId: ADMIN.id });
    expect(request.description).toBe('Home briefing · 1 overdue, 0 due today, 0 decisions, 0 pool, 0 notifications');
    expect(request.prompt).toContain('T1 | Close CAPA-0912');
    expect(request.prompt).not.toContain('SECRET-DESCRIPTION');
    expect(request.prompt).not.toContain('task-1');
    expect(request.system).toContain('English');

    const saved = (argsOf(prisma.aiBriefing.update)[0] as { data: Record<string, unknown> }).data;
    expect(saved).toEqual(
      expect.objectContaining({
        language: 'en',
        lead: 'One task is overdue.',
        creditCost: 5,
        generatingSince: null,
        focus: [{ key: 'T1', reason: 'It is a week late.' }], // the invented ZZ dropped
      }),
    );
  });

  it('a quiet day calls no model, costs nothing, and reads the drawing\'s sentence', async () => {
    const { service, prisma, ai, tasks } = setup();
    tasks.getMyTasks.mockResolvedValue([]);
    await service.make(ADMIN, ORG, 'ar', NOW);
    expect(ai.run).not.toHaveBeenCalled();
    expect((argsOf(prisma.aiBriefing.update)[0] as { data: Record<string, unknown> }).data).toEqual(
      expect.objectContaining({ creditCost: 0, lead: 'لا شيء متأخر أو مستحق اليوم، ولا شيء بانتظارك.', focus: [], groups: [] }),
    );
  });

  it('a run already in flight for this user is refused 409, and nothing is called', async () => {
    const { service, prisma, ai } = setup();
    prisma.$queryRaw.mockResolvedValue([]);
    const e = await refusal(service.make(ADMIN, ORG, 'en', NOW));
    expect(e).toBeInstanceOf(ConflictException);
    expect(((e as ConflictException).getResponse() as { code: string }).code).toBe('AI_BRIEFING_IN_PROGRESS');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('the claim is one INSERT … ON CONFLICT that only takes a free or stale claim', async () => {
    const { service, prisma } = setup();
    await service.make(ADMIN, ORG, 'en', NOW);
    const sql = (argsOf(prisma.$queryRaw)[0] as TemplateStringsArray).join('?');
    expect(sql).toContain('INSERT INTO "AiBriefing"');
    expect(sql).toContain('ON CONFLICT ("organizationId", "userId") DO UPDATE');
    expect(sql).toContain('"generatingSince" IS NULL OR "AiBriefing"."generatingSince" <');
  });

  it('a refusal from the gateway passes through unchanged, the claim is released, and nothing is saved', async () => {
    const { service, prisma, ai } = setup();
    ai.run.mockRejectedValue(new AiRefusalException('AI_CREDITS_EXHAUSTED', { creditCost: 5, creditsRemaining: 2, renewsAt: '2026-10-21T00:00:00.000Z' }));
    const e = await refusal(service.make(ADMIN, ORG, 'en', NOW));
    expect((e as AiRefusalException).code).toBe('AI_CREDITS_EXHAUSTED');
    expect(prisma.aiBriefing.update).not.toHaveBeenCalled();
    const release = (argsOf(prisma.$executeRaw)[0] as TemplateStringsArray).join('?');
    expect(release).toContain('SET "generatingSince" = NULL WHERE "id" = ? AND "generatingSince" = ?');
    expect(argsOf(prisma.$executeRaw).slice(1)).toEqual(['row-1', NOW]);
  });

  it('not available here (feature not open, or AI off) → AI_NOT_ENABLED before any claim', async () => {
    const { service, prisma } = setup();
    prisma.aiFeatureCost.findMany.mockResolvedValue([]);
    expect(((await refusal(service.make(ADMIN, ORG, 'en', NOW))) as AiRefusalException).details.reason).toBe('FEATURE_NOT_AVAILABLE');
    prisma.aiFeatureCost.findMany.mockResolvedValue(OPEN_FEATURE);
    prisma.organization.findFirst.mockResolvedValue({ ...AI_ON, aiMonthlyCredits: 0 });
    expect(((await refusal(service.make(ADMIN, ORG, 'en', NOW))) as AiRefusalException).details.reason).toBe('NO_ALLOWANCE');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('AiBriefingService.read (ACC-198)', () => {
  const row = (generatedAt: string) => ({
    id: 'row-1',
    organizationId: ORG,
    userId: ADMIN.id,
    language: 'ar',
    lead: 'لديك مهمة متأخرة.',
    creditCost: 5,
    generatedAt: new Date(generatedAt),
    focus: [{ key: 'T1', reason: 'متأخرة أسبوعًا' }, { key: 'GONE', reason: 'x' }],
    groups: [
      { kind: 'overdue', items: [{ key: 'T1', type: 'TASK', id: 'task-1', title: 'Close CAPA-0912', link: { target: 'task', id: 'task-1' } }] },
      { kind: 'notification', items: [{ key: 'N1', type: 'NOTIFICATION', id: 'n-1', title: 'Hi', link: null }] },
    ],
  });

  it('today\'s briefing, with live done markers and the focus resolved to our own items', async () => {
    const { service, prisma } = setup();
    prisma.aiBriefing.findFirst.mockResolvedValue(row('2026-10-13T05:00:00Z'));
    prisma.task.findMany.mockResolvedValue([{ id: 'task-1' }]); // completed since
    const view = await service.read(ADMIN, ORG, NOW);

    expect(view.available).toBe(true);
    expect(view.creditCost).toBe(5);
    expect(view.greeting).toBe('morning');
    expect(view.briefing!.language).toBe('ar');
    expect(view.briefing!.focus).toEqual([{ item: expect.objectContaining({ id: 'task-1', done: true }) as unknown, reason: 'متأخرة أسبوعًا' }]);
    expect(view.briefing!.groups[1]!.items[0]!.done).toBe(false);
  });

  it('yesterday\'s briefing is not shown (D3)', async () => {
    const { service, prisma } = setup();
    prisma.aiBriefing.findFirst.mockResolvedValue(row('2026-10-12T20:00:00Z')); // 23:00 Riyadh, 12 Oct
    expect((await service.read(ADMIN, ORG, NOW)).briefing).toBeNull();
  });

  it('a user without tenant:manage_config may not press, and is not asked about features', async () => {
    const { service, prisma } = setup();
    const view = await service.read(NON_ADMIN, ORG, NOW);
    expect(view.available).toBe(false);
    expect(prisma.aiFeatureCost.findMany).not.toHaveBeenCalled();
  });

  it('credits used up still counts as available — pressing says why', async () => {
    const { service, prisma } = setup();
    prisma.organization.findFirst.mockResolvedValue({ ...AI_ON, aiCreditsUsed: 2000 });
    expect((await service.read(ADMIN, ORG, NOW)).available).toBe(true);
  });

  it('should NOT return records belonging to a different tenant — reads, claims and done markers are scoped to the caller\'s organisation and user', async () => {
    const { service, prisma } = setup();
    prisma.aiBriefing.findFirst.mockResolvedValue(row('2026-10-13T05:00:00Z'));
    await service.read(ADMIN, ORG, NOW);
    await service.make(ADMIN, ORG, 'en', NOW);
    expect(prisma.aiBriefing.findFirst).toHaveBeenCalledWith({ where: { organizationId: ORG, userId: ADMIN.id, generatedAt: { not: null } } });
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG }) as unknown }));
    expect(prisma.notification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG, userId: ADMIN.id }) as unknown }));
    const claimParams = argsOf(prisma.$queryRaw).slice(1);
    expect(claimParams).toContain(ORG);
    expect(claimParams).toContain(ADMIN.id);
    expect(claimParams).not.toContain(OTHER_ORG);
  });
});
