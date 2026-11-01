import { HttpException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { WorkflowTemplateService } from './workflow-template.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { StageTaskDefinitionService } from './stage-task-definition.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { CreateWorkflowStageDto } from './dto/create-workflow-stage.dto';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import { CreateWorkflowTransitionDto } from './dto/create-workflow-transition.dto';
import { whoRulesFor } from './stage-who';

/**
 * ACC-271 PR 5-be — what the stage screens (5a, 5b) read and write before they
 * ship: `whoRules` and each Fixed position entry's `holderCount` on the template
 * read, a stage created with `who`, and a move created with no trigger. Old
 * screens keep working against all of it.
 */

const ORG = 'org-a';
const ACTOR = 'actor-1';

const TEMPLATE = { id: 'template-1', organizationId: ORG, nameEn: 'Committees', nameAr: null, objectType: 'COMMITTEE', isDefault: true, isActive: true };

const STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  workflowTemplate: { objectType: 'COMMITTEE' },
  key: 'formation',
  nameEn: 'Formation',
  nameAr: null,
  description: null,
  order: 10,
  slaWorkingHours: null,
  isInitial: true,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'ROLE',
  assigneeUserId: null,
  assigneeRoleId: null,
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
  flags: [] as string[],
  whoMode: 'ANY_ONE' as string | null,
};

const entry = (over: Record<string, unknown>) => ({
  id: `entry-${Math.random().toString(36).slice(2, 8)}`,
  organizationId: ORG,
  stageId: 'stage-1',
  order: 1,
  kind: 'POSITION_IN_UNIT',
  userId: null,
  positionId: 'pos-1',
  orgUnitId: 'unit-1',
  committeeId: null,
  committeeRoleValueId: null,
  isStartingAssignment: false,
  createdAt: new Date('2026-10-30T00:00:00Z'),
  createdById: null,
  ...over,
});

function build() {
  const self: { current: unknown } = { current: null };
  const prisma = {
    workflowStage: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn() },
    workflowTemplate: { findFirst: jest.fn() },
    workflowTransition: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    workflowStageAssignee: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    workflowStageRecordAction: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    workflowInstance: { groupBy: jest.fn().mockResolvedValue([]) },
    user: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    orgPosition: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    orgUnit: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    committee: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    lookupValue: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    permission: { findFirst: jest.fn().mockResolvedValue({ id: 'perm' }) },
    rolePermission: { count: jest.fn().mockResolvedValue(1) },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(self.current)),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  self.current = prisma;
  const audit = { log: jest.fn() };
  const stageTasks = {
    summaryForStages: jest.fn().mockResolvedValue(new Map()),
    taskDueHours: jest.fn().mockResolvedValue({}),
    assertStageDeadlineFits: jest.fn(),
  };
  const service = new WorkflowTemplateService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
    stageTasks as unknown as StageTaskDefinitionService,
  );
  return { prisma, audit, service };
}

async function refusal(p: Promise<unknown>): Promise<Record<string, unknown> | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), ...(e.getResponse() as Record<string, unknown>) };
    throw e;
  }
}

const errorsOf = async (cls: new () => object, body: Record<string, unknown>) =>
  (await validate(plainToInstance(cls, body))).map((e) => e.property);

describe('WorkflowTemplateService — the backend for the stage screens (ACC-271 PR 5-be)', () => {
  describe('the template read', () => {
    function readWith(stages: unknown[]) {
      const ctx = build();
      ctx.prisma.workflowTemplate.findFirst.mockResolvedValue(TEMPLATE);
      ctx.prisma.workflowStage.findMany.mockResolvedValue(stages);
      return ctx;
    }
    const stageWith = (id: string, assignees: unknown[]) => ({ ...STAGE, id, transitionsFrom: [], recordActions: [], assignees });

    it("serves whoRules, built from the save's own constants", async () => {
      const { service } = readWith([stageWith('stage-1', [])]);
      expect((await service.getTemplateById('template-1', ORG)).whoRules).toEqual(whoRulesFor('COMMITTEE'));
    });

    it('gives each Fixed position entry its holder count, and every other kind null', async () => {
      const { prisma, service } = readWith([
        stageWith('stage-1', [
          entry({ positionId: 'pos-1', orgUnitId: 'unit-1', order: 1 }),
          entry({ positionId: 'pos-2', orgUnitId: 'unit-1', order: 2 }),
          entry({ kind: 'ORG_UNIT_HEAD', positionId: null, orgUnitId: 'unit-1', order: 3 }),
          entry({ kind: 'CREATOR', positionId: null, orgUnitId: null, order: 4 }),
        ]),
      ]);
      prisma.user.groupBy.mockResolvedValue([
        { positionId: 'pos-1', primaryOrgUnitId: 'unit-1', _count: { _all: 3 } },
        // A pair no entry names is ignored.
        { positionId: 'pos-2', primaryOrgUnitId: 'unit-9', _count: { _all: 5 } },
      ]);
      const read = await service.getTemplateById('template-1', ORG);
      expect(read.stages![0]!.who!.entries.map((e) => [e.kind, e.holderCount])).toEqual([
        ['POSITION_IN_UNIT', 3],
        ['POSITION_IN_UNIT', 0],
        ['ORG_UNIT_HEAD', null],
        ['CREATOR', null],
      ]);
    });

    it('counts holders in ONE grouped query, however many entries and stages there are', async () => {
      const many = (n: number, stage: string) =>
        Array.from({ length: n }, (_, i) => entry({ stageId: stage, positionId: `pos-${i}`, orgUnitId: `unit-${i % 3}`, order: i + 1 }));
      const small = readWith([stageWith('stage-1', many(1, 'stage-1'))]);
      await small.service.getTemplateById('template-1', ORG);
      const large = readWith([stageWith('stage-1', many(12, 'stage-1')), stageWith('stage-2', many(12, 'stage-2'))]);
      await large.service.getTemplateById('template-1', ORG);
      expect(small.prisma.user.groupBy).toHaveBeenCalledTimes(1);
      expect(large.prisma.user.groupBy).toHaveBeenCalledTimes(1);
    });

    it('reads no holders at all when no entry is a Fixed position', async () => {
      const { prisma, service } = readWith([stageWith('stage-1', [entry({ kind: 'CREATOR', positionId: null, orgUnitId: null })])]);
      await service.getTemplateById('template-1', ORG);
      expect(prisma.user.groupBy).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('the holder count reads only this organisation, by the holder rule (ACTIVE, the position, the unit as primary)', async () => {
      const { prisma, service } = readWith([stageWith('stage-1', [entry({})])]);
      await service.getTemplateById('template-1', ORG);
      expect(prisma.user.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['positionId', 'primaryOrgUnitId'],
          where: { organizationId: ORG, status: 'ACTIVE', positionId: { in: ['pos-1'] }, primaryOrgUnitId: { in: ['unit-1'] } },
        }),
      );
    });
  });

  describe('creating a stage with who', () => {
    const who = { mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'user-1' }, { kind: 'CREATOR' }] };

    function ready() {
      const ctx = build();
      ctx.prisma.workflowTemplate.findFirst.mockResolvedValue(TEMPLATE);
      ctx.prisma.user.findMany.mockResolvedValue([{ id: 'user-1', name: 'Huda', status: 'ACTIVE' }]);
      ctx.prisma.workflowStage.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...STAGE, id: 'stage-new', ...data, whoMode: data['whoMode'] ?? null }),
      );
      ctx.prisma.workflowStageAssignee.findMany
        .mockResolvedValueOnce([]) // inside the transaction, before the write
        .mockResolvedValueOnce([
          entry({ id: 'e1', stageId: 'stage-new', kind: 'SPECIFIC_USER', userId: 'user-1', positionId: null, orgUnitId: null, order: 1 }),
          entry({ id: 'e2', stageId: 'stage-new', kind: 'CREATOR', positionId: null, orgUnitId: null, order: 2 }),
        ]);
      return ctx;
    }

    it('converts the new stage in the transaction that creates it, and audits who like a who save', async () => {
      const { prisma, audit, service } = ready();
      const created = await service.addStage('template-1', { nameEn: 'Review', order: 20, who } as never, ORG, ACTOR);

      const data = prisma.workflowStage.create.mock.calls[0][0].data;
      expect(data.whoMode).toBe('ANY_ONE');
      // No old people value is written: the columns keep their defaults.
      expect(data).not.toHaveProperty('approvalMode');
      expect(data).not.toHaveProperty('assigneeStrategy');
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.workflowStageAssignee.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({ organizationId: ORG, stageId: 'stage-new', order: 1, kind: 'SPECIFIC_USER', userId: 'user-1', isStartingAssignment: false, createdById: ACTOR }),
          expect.objectContaining({ organizationId: ORG, stageId: 'stage-new', order: 2, kind: 'CREATOR', isStartingAssignment: false }),
        ],
      });
      expect(audit.log).toHaveBeenCalledTimes(1);
      expect(audit.log.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          action: 'CREATE',
          objectType: 'WorkflowStage',
          after: expect.objectContaining({ whoMode: 'ANY_ONE', whoEntries: ['1. Huda', '2. whoever created the record'] }),
        }),
      );
      expect(created.who).toEqual(expect.objectContaining({ mode: 'ANY_ONE' }));
      expect(created.whoSentence).toEqual({ en: 'Any one of: Huda, or whoever created the record.', ar: 'أيٌّ من: Huda، أو من أنشأ السجل.' });
    });

    it.each([
      ['assigneeStrategy', 'ROLE'],
      ['approvalMode', 'SINGLE'],
      ['assigneeRoleId', 'role-qm'],
      ['assigneeUserId', 'user-1'],
      ['parallelThreshold', 'ALL'],
      ['committeeId', 'committee-1'],
      ['assigneeCommitteeRoleValueId', 'role-chair'],
      ['assigneePositionId', 'pos-1'],
      ['assigneeOrgUnitId', 'unit-1'],
    ])('who sent with the old %s is refused with the translated sentence, creating nothing', async (field, value) => {
      const { prisma, service } = ready();
      const body = await refusal(service.addStage('template-1', { nameEn: 'Review', order: 20, who, [field]: value } as never, ORG, ACTOR));
      expect(body).toEqual(expect.objectContaining({ status: 400, code: 'WHO_MOVED_TO_STAGE', field, messageAr: expect.any(String) }));
      expect(prisma.workflowStage.create).not.toHaveBeenCalled();
    });

    it('an old field sent empty beside who says nothing, and is accepted', async () => {
      const { prisma, service } = ready();
      await service.addStage('template-1', { nameEn: 'Review', order: 20, who, assigneeRoleId: null, committeeId: '' } as never, ORG, ACTOR);
      expect(prisma.workflowStage.create).toHaveBeenCalledTimes(1);
    });

    it("a who of the wrong shape is refused before anything is read or written", async () => {
      const { prisma, service } = ready();
      const body = await refusal(
        service.addStage('template-1', { nameEn: 'Review', order: 20, who: { mode: 'COMMITTEE_VOTE', entries: [{ kind: 'CREATOR' }] } } as never, ORG, ACTOR),
      );
      expect(body).toEqual(expect.objectContaining({ code: 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' }));
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.workflowStage.create).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation("another organisation's person is refused like an invented one, and no stage is created", async () => {
      const { prisma, service } = ready();
      prisma.user.findMany.mockResolvedValue([]); // the read is scoped: another organisation's id is absent
      const body = await refusal(service.addStage('template-1', { nameEn: 'Review', order: 20, who } as never, ORG, ACTOR));
      expect(body).toEqual(expect.objectContaining({ status: 404, code: 'WHO_REFERENCE_NOT_FOUND', index: 0, field: 'userId' }));
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['user-1'] }, organizationId: ORG } }));
      expect(prisma.workflowStage.create).not.toHaveBeenCalled();
    });

    it('a stage created the old way, without who, is created exactly as before', async () => {
      const { prisma, audit, service } = ready();
      await service.addStage('template-1', { nameEn: 'Review', order: 20, approvalMode: 'SINGLE', assigneeStrategy: 'ROLE' } as never, ORG, ACTOR);
      const data = prisma.workflowStage.create.mock.calls[0][0].data;
      expect(data).toEqual(expect.objectContaining({ approvalMode: 'SINGLE', assigneeStrategy: 'ROLE' }));
      expect(data).not.toHaveProperty('whoMode');
      expect(prisma.workflowStageAssignee.createMany).not.toHaveBeenCalled();
      expect(audit.log.mock.calls[0][0].after).not.toHaveProperty('whoMode');
    });

    describe('the create DTO', () => {
      it('without who, approvalMode and assigneeStrategy are still required', async () => {
        expect(await errorsOf(CreateWorkflowStageDto, { nameEn: 'Review', order: 20 })).toEqual(
          expect.arrayContaining(['approvalMode', 'assigneeStrategy']),
        );
      });

      it('with who, neither is required', async () => {
        expect(await errorsOf(CreateWorkflowStageDto, { nameEn: 'Review', order: 20, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } })).toEqual([]);
      });

      it('the update DTO still takes who, and still takes nothing at all', async () => {
        expect(await errorsOf(UpdateWorkflowStageDto, { who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } })).toEqual([]);
        expect(await errorsOf(UpdateWorkflowStageDto, {})).toEqual([]);
        expect(await errorsOf(UpdateWorkflowStageDto, { approvalMode: 'NOPE' })).toEqual(['approvalMode']);
      });
    });
  });

  describe('creating a move', () => {
    const add = (service: WorkflowTemplateService, extra: Record<string, unknown>) =>
      service.addTransition({ fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Go', ...extra } as never, ORG, ACTOR);

    function from(whoMode: string | null) {
      const ctx = build();
      ctx.prisma.workflowStage.findFirst.mockResolvedValueOnce({ ...STAGE, whoMode }).mockResolvedValueOnce({ ...STAGE, id: 'stage-2' });
      ctx.prisma.workflowTransition.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 't-new', triggerCondition: 'ROLE_BASED', requiredPermission: null, triggerUserId: null, triggerRoleId: null, kind: 'ADVANCE', mover: null, ...data }),
      );
      return ctx;
    }

    it('out of a converted stage, no trigger is needed: the column keeps its default and the mover is PERSON', async () => {
      const { prisma, service } = from('ANY_ONE');
      await add(service, {});
      const data = prisma.workflowTransition.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('triggerCondition');
      expect(data.mover).toBe('PERSON');
    });

    it("out of a converted stage, the old Add dialog's ROLE_BASED (the column's own default) is accepted", async () => {
      const { prisma, service } = from('ANY_ONE');
      await add(service, { triggerCondition: 'ROLE_BASED' });
      expect(prisma.workflowTransition.create).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['triggerCondition', { triggerCondition: 'SPECIFIC_USER' }],
      ['triggerCondition', { triggerCondition: 'ANY_AUTHENTICATED' }],
      ['triggerCondition', { triggerCondition: 'ASSIGNEE_POOL' }],
      ['triggerCondition', { triggerCondition: 'SYSTEM_AUTOMATIC' }],
      ['triggerRoleId', { triggerRoleId: 'role-qm' }],
      ['triggerUserId', { triggerUserId: 'user-1' }],
      ['requiredPermission', { requiredPermission: 'committees:manage' }],
    ])('out of a converted stage, a people value (%s) is refused with WHO_MOVED_TO_STAGE, never ignored', async (field, extra) => {
      const { prisma, service } = from('ANY_ONE');
      expect(await refusal(add(service, extra))).toEqual(expect.objectContaining({ status: 400, code: 'WHO_MOVED_TO_STAGE', field, messageAr: expect.any(String) }));
      expect(prisma.workflowTransition.create).not.toHaveBeenCalled();
    });

    it('out of a stage not converted yet, the trigger is still required', async () => {
      const { prisma, service } = from(null);
      expect(await refusal(add(service, {}))).toEqual(expect.objectContaining({ status: 400 }));
      expect(prisma.workflowTransition.create).not.toHaveBeenCalled();
    });

    it('out of a stage not converted yet, an old move is created exactly as before', async () => {
      const { prisma, service } = from(null);
      await add(service, { triggerCondition: 'ANY_AUTHENTICATED' });
      const data = prisma.workflowTransition.create.mock.calls[0][0].data;
      expect(data.triggerCondition).toBe('ANY_AUTHENTICATED');
      expect(data).not.toHaveProperty('mover');
    });

    it('the create DTO no longer requires a trigger', async () => {
      expect(await errorsOf(CreateWorkflowTransitionDto, { fromStageId: 's1', toStageId: 's2', labelEn: 'Go' })).toEqual([]);
      expect(await errorsOf(CreateWorkflowTransitionDto, { fromStageId: 's1', toStageId: 's2', labelEn: 'Go', triggerCondition: 'NOPE' })).toEqual([
        'triggerCondition',
      ]);
    });
  });
});
