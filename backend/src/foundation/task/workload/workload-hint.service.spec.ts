import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../prisma/prisma.service';
import { ObjectVisibilityService } from '../../../common/services/object-visibility.service';
import { WorkingCalendarService } from '../../working-calendar/working-calendar.service';
import { AiService, AiRunRequest } from '../../ai/ai.service';
import { AiRefusalException } from '../../ai/ai-refusal';
import { TaskAssignmentService } from '../task-assignment.service';
import { IAssignableHolder } from '../interfaces/task-assignment.interface';
import { WorkloadHintDto } from '../dto/workload-hint.dto';
import { TaskWorkloadService } from './task-workload.service';
import { WorkloadHintService } from './workload-hint.service';
import { WorkloadRefusalException } from './workload-refusal';

// ACC-199 — "✦ Suggest someone", pressed. Plan §7. The real TaskWorkloadService
// and the real ObjectVisibilityService run over a mocked Prisma, so the order
// of the checks and the record rule are the ones that ship.

const ORG = 'org-a';
const VIEWER = { id: 'assigner', permissions: ['tasks:create', 'tasks:view', 'committees:view'] };
const NAMES = { nora: 'Nora Al-Otaibi', sara: 'Sara Al-Mutairi', khalid: 'Khalid Al-Zahrani' };
const holder = (id: keyof typeof NAMES): IAssignableHolder => ({
  id,
  name: NAMES[id],
  positionNameEn: 'Quality Officer',
  positionNameAr: 'مسؤول الجودة',
  workload: null,
});

const DTO: WorkloadHintDto = {
  orgUnitId: 'unit-cardio',
  positionId: 'pos-qo',
  chosenUserId: 'nora',
  sourceType: 'COMMITTEE',
  sourceId: 'cmt-1',
  priority: 'HIGH',
};

function setup(options: { counts?: Record<string, number>; answer?: string; available?: boolean; committee?: boolean } = {}) {
  const counts = options.counts ?? { nora: 12, sara: 4, khalid: 7 };
  const rows = Object.entries(counts).flatMap(([userId, n]) =>
    Array.from({ length: n }, () => ({ userId, task: { status: 'PENDING', dueAt: null, priority: 'MEDIUM' } })),
  );
  const prisma = {
    committee: { findFirst: jest.fn().mockResolvedValue(options.committee === false ? null : { id: 'cmt-1' }) },
    meeting: { findFirst: jest.fn().mockResolvedValue(null) },
    taskAssignee: { findMany: jest.fn().mockResolvedValue(rows) },
    user: { findMany: jest.fn().mockResolvedValue(Object.keys(NAMES).map((id) => ({ id, outOfOfficeFrom: null, outOfOfficeTo: null }))) },
    organization: {
      findFirst: jest.fn().mockResolvedValue({
        aiMonthlyCredits: options.available === false ? 0 : 2000,
        aiPendingMonthlyCredits: null,
        aiCreditsUsed: 0,
        aiCreditsPeriodStart: new Date('2026-09-21T00:00:00.000Z'),
        aiCreditsRenewsAt: new Date('2099-01-01T00:00:00.000Z'),
        bootstrappedAt: new Date('2026-09-21T00:00:00.000Z'),
        createdAt: new Date('2026-09-21T00:00:00.000Z'),
        settings: {},
      }),
    },
    aiFeatureCost: {
      findMany: jest.fn().mockResolvedValue([{ featureKey: 'workload_balancing', creditCost: 1, restricted: false, allowedOrganizationIds: [] }]),
    },
  };
  const assignment = {
    listHolders: jest.fn().mockResolvedValue([holder('nora'), holder('sara'), holder('khalid')]),
    listCommitteeMembers: jest.fn().mockResolvedValue([holder('nora'), holder('sara'), holder('khalid')]),
  };
  const workingCalendar = {
    getOrCreate: jest.fn().mockResolvedValue({ workingHoursStart: '08:00', workingHoursEnd: '16:00' }),
    calculateDeadline: jest.fn().mockResolvedValue(DateTime.fromISO('2099-01-01T00:00:00Z')),
  };
  // Our labels are shuffled: answer with whichever label the prompt gave Sara's counts (open 4).
  const answerFor = (request: AiRunRequest): string => {
    if (options.answer !== undefined) return options.answer;
    const line = request.prompt.split('\n').find((l) => l.includes('— open 4,'))!;
    return `{"pick":"${line.split(' ')[0]}"}`;
  };
  const ai = {
    run: jest.fn().mockImplementation((_f: string, _c: unknown, request: AiRunRequest) => {
      const answer = answerFor(request);
      if (request.accept && !request.accept(answer, false)) return Promise.reject(new AiRefusalException('AI_PROVIDER_FAILED'));
      return Promise.resolve({ content: answer, interactionId: 'log-7', creditCost: 1, inputTokens: 200, outputTokens: 20, truncated: false });
    }),
  };
  const db = prisma as unknown as PrismaService;
  const workload = new TaskWorkloadService(
    db,
    assignment as unknown as TaskAssignmentService,
    new ObjectVisibilityService(db),
    workingCalendar as unknown as WorkingCalendarService,
  );
  const service = new WorkloadHintService(db, ai as unknown as AiService, workload);
  return { service, prisma, assignment, ai };
}

const requestOf = (ai: { run: jest.Mock }): AiRunRequest => (ai.run.mock.calls[0] as [string, unknown, AiRunRequest])[2];

describe('WorkloadHintService.suggest (ACC-199)', () => {
  it('suggests the person the model picked, with both people\'s counts on the record', async () => {
    const { service, ai } = setup();
    const hint = await service.suggest(VIEWER, ORG, DTO);
    expect(hint).toEqual({
      interactionId: 'log-7',
      chosen: { userId: 'nora', openCount: 12, overdueCount: 0 },
      suggestion: {
        userId: 'sara',
        name: 'Sara Al-Mutairi',
        positionNameEn: 'Quality Officer',
        positionNameAr: 'مسؤول الجودة',
        openCount: 4,
        overdueCount: 0,
        dueSoonCount: 0,
      },
      // Nobody here has work due soon (the fixture's tasks have no due date).
      dueSoonSeen: false,
    });
    const [feature, context] = ai.run.mock.calls[0] as [string, unknown];
    expect(feature).toBe('workload_balancing');
    expect(context).toEqual({ organizationId: ORG, actorId: 'assigner' });
  });

  it('says whether the model saw work due soon, and the suggested person\'s own due-soon count, so the screen can explain the pick', async () => {
    const { service, prisma } = setup();
    const tomorrow = new Date(Date.now() + 86_400_000);
    prisma.taskAssignee.findMany.mockResolvedValue([
      ...Array.from({ length: 12 }, (_, i) => ({ userId: 'nora', task: { status: 'PENDING', dueAt: i < 2 ? tomorrow : null, priority: 'MEDIUM' } })),
      ...Array.from({ length: 4 }, () => ({ userId: 'sara', task: { status: 'PENDING', dueAt: null, priority: 'MEDIUM' } })),
      ...Array.from({ length: 7 }, () => ({ userId: 'khalid', task: { status: 'PENDING', dueAt: tomorrow, priority: 'MEDIUM' } })),
    ]);
    const hint = await service.suggest(VIEWER, ORG, DTO);
    expect(hint.dueSoonSeen).toBe(true);
    expect(hint.suggestion).toEqual(expect.objectContaining({ userId: 'sara', dueSoonCount: 0 }));
  });

  it('the model is told no name, no user id, no record id and no unit or position — only labels and counts', async () => {
    const { service, ai } = setup();
    await service.suggest(VIEWER, ORG, DTO);
    const { system, prompt } = requestOf(ai);
    for (const secret of [...Object.values(NAMES), ...Object.keys(NAMES), 'cmt-1', 'unit-cardio', 'pos-qo', 'Quality Officer', 'مسؤول الجودة']) {
      expect(`${system}\n${prompt}`).not.toContain(secret);
    }
    expect(prompt).toContain('priority HIGH');
    expect(prompt).toContain('on this committee only');
    expect(prompt.match(/^P\d+ — /gm)).toHaveLength(2);
  });

  it("the log's description is ids and counts only: no name", async () => {
    const { service, ai } = setup();
    await service.suggest(VIEWER, ORG, DTO);
    const { description } = requestOf(ai);
    expect(description).toBe('workload hint · COMMITTEE cmt-1 · POSITION · 2 eligible · chosen nora');
    for (const name of Object.values(NAMES)) expect(description).not.toContain(name);
  });

  describe('refused before the model is called — nothing is charged', () => {
    it('without tasks:view: 403 naming it, before anything is read', async () => {
      const { service, prisma, assignment, ai } = setup();
      const error = await service
        .suggest({ id: 'x', permissions: ['tasks:create', 'committees:view'] }, ORG, DTO)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toBe('Required permission: tasks:view');
      expect(prisma.committee.findFirst).not.toHaveBeenCalled();
      expect(assignment.listHolders).not.toHaveBeenCalled();
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('without the record\'s own permission: 403 naming it, before the record is read', async () => {
      const { service, prisma, ai } = setup();
      const error = await service.suggest({ id: 'x', permissions: ['tasks:create', 'tasks:view'] }, ORG, DTO).catch((e: unknown) => e);
      expect((error as Error).message).toBe('Required permission: committees:view');
      expect(prisma.committee.findFirst).not.toHaveBeenCalled();
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('should NOT return records belonging to a different tenant', async () => {
      // The committee is another organisation's: 404, and nothing is counted.
      const { service, prisma, ai } = setup({ committee: false });
      const error = await service.suggest(VIEWER, 'org-b', DTO).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NotFoundException);
      expect(prisma.committee.findFirst).toHaveBeenCalledWith({ where: { id: 'cmt-1', organizationId: 'org-b' }, select: { id: true } });
      expect(prisma.taskAssignee.findMany).not.toHaveBeenCalled();
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('a committee role on another record: 400, as resolvePlacement() refuses it', async () => {
      const { service, ai } = setup();
      const dto = { ...DTO, orgUnitId: undefined, positionId: undefined, committeeId: 'cmt-OTHER', roleValueId: 'role-1' };
      await expect(service.suggest(VIEWER, ORG, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('a chosen person who cannot take it here: 400', async () => {
      const { service, ai } = setup();
      await expect(service.suggest(VIEWER, ORG, { ...DTO, chosenUserId: 'stranger' })).rejects.toBeInstanceOf(BadRequestException);
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('the picker\'s own rule applies, with the task named for Reassign', async () => {
      const { service, assignment } = setup();
      await service.suggest(VIEWER, ORG, { ...DTO, taskId: 'task-9' });
      expect(assignment.listHolders).toHaveBeenCalledWith(VIEWER, ORG, 'unit-cardio', 'pos-qo', 'task-9');
    });

    it('not past the threshold any more: WORKLOAD_NO_SUGGESTION, and no call', async () => {
      const { service, ai } = setup({ counts: { nora: 5, sara: 4, khalid: 4 } });
      const error = await service.suggest(VIEWER, ORG, DTO).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkloadRefusalException);
      expect((error as WorkloadRefusalException).code).toBe('WORKLOAD_NO_SUGGESTION');
      expect(ai.run).not.toHaveBeenCalled();
    });

    it('AI not available for the organisation: the gateway\'s AI_NOT_ENABLED, and no call', async () => {
      const { service, ai } = setup({ available: false });
      const error = await service.suggest(VIEWER, ORG, DTO).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AiRefusalException);
      expect((error as AiRefusalException).code).toBe('AI_NOT_ENABLED');
      expect(ai.run).not.toHaveBeenCalled();
    });
  });

  describe('an answer we cannot use — the gateway refunds it', () => {
    it('"nobody is clearly better placed" → WORKLOAD_NO_SUGGESTION', async () => {
      const { service } = setup({ answer: '{"pick":null}' });
      const error = await service.suggest(VIEWER, ORG, DTO).catch((e: unknown) => e);
      expect((error as WorkloadRefusalException).code).toBe('WORKLOAD_NO_SUGGESTION');
    });

    it.each(['{"pick":"P9"}', '', 'Sara looks free.'])('%j → AI_PROVIDER_FAILED (Try again)', async (answer) => {
      const { service } = setup({ answer });
      const error = await service.suggest(VIEWER, ORG, DTO).catch((e: unknown) => e);
      expect((error as AiRefusalException).code).toBe('AI_PROVIDER_FAILED');
    });

    it('accept() refuses a cut-short answer and the chosen person\'s own label', async () => {
      const { service, ai } = setup();
      await service.suggest(VIEWER, ORG, DTO);
      const { accept, prompt } = requestOf(ai);
      const chosenLabel = prompt.split('\n').find((l) => l.startsWith('Currently chosen: '))!.split(' ')[2]!;
      expect(accept!('{"pick":"P1"}', true)).toBe(false);
      expect(accept!(`{"pick":"${chosenLabel}"}`, false)).toBe(false);
    });
  });

  it('nobody out of office is offered, and at most 15 others are sent, the least loaded first', async () => {
    const { service, prisma, assignment, ai } = setup();
    const many = Array.from({ length: 20 }, (_, i) => ({ ...holder('sara'), id: `p${i}`, name: `Person ${i}` }));
    assignment.listHolders.mockResolvedValue([holder('nora'), ...many]);
    prisma.taskAssignee.findMany.mockResolvedValue([
      ...Array.from({ length: 30 }, () => ({ userId: 'nora', task: { status: 'PENDING', dueAt: null, priority: 'LOW' } })),
      ...many.flatMap((p, i) => Array.from({ length: i }, () => ({ userId: p.id, task: { status: 'PENDING', dueAt: null, priority: 'LOW' } }))),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'p0', outOfOfficeFrom: new Date(Date.now() - 86_400_000), outOfOfficeTo: new Date(Date.now() + 86_400_000) },
    ]);
    // Answer with any label from the others.
    ai.run.mockImplementation((_f: string, _c: unknown, request: AiRunRequest) => {
      const label = request.prompt.split('\n').filter((l) => /^P\d+ — /.test(l))[0]!.split(' ')[0]!;
      request.accept!(`{"pick":"${label}"}`, false);
      return Promise.resolve({ content: `{"pick":"${label}"}`, interactionId: 'log-8', creditCost: 1, inputTokens: 1, outputTokens: 1, truncated: false });
    });
    await service.suggest(VIEWER, ORG, DTO);
    const { prompt } = requestOf(ai);
    const sent = prompt.split('\n').filter((l) => /^P\d+ — /.test(l)).map((l) => Number(/open (\d+)/.exec(l)![1]));
    expect(sent).toHaveLength(15);
    // p0 (0 open) is out of office: the least loaded sent is p1 (1 open), up to p15 (15 open).
    expect(Math.min(...sent)).toBe(1);
    expect(Math.max(...sent)).toBe(15);
  });
});

describe('WorkloadHintService.availability (ACC-199)', () => {
  it('answers whether the feature is open, and nothing about the balance', async () => {
    expect(await setup().service.availability(ORG)).toEqual({ available: true });
    expect(await setup({ available: false }).service.availability(ORG)).toEqual({ available: false });
  });
});
