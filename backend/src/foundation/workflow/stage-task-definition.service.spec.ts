import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TaskService } from '../task/task.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowRefusalException } from './workflow-refusal';

// ACC-190 (CF-07) — task definitions on workflow stages: the definitions API's
// rules, the stage-deadline rule, and what a stage entry creates.

const ORG_A = 'org-a';
const ORG_B = 'org-b';
const ACTOR = 'actor-1';

// Default task SLA hours (tenant settings): CRITICAL 4, HIGH 16, MEDIUM 40, LOW 80.
const STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  slaWorkingHours: 40 as number | null,
  isFinal: false,
  workflowTemplate: { objectType: 'COMMITTEE' },
};

const DEFINITION = {
  id: 'def-1',
  organizationId: ORG_A,
  stageId: 'stage-1',
  order: 10,
  titleEn: 'Check the terms',
  titleAr: null as string | null,
  description: null as string | null,
  isMandatory: true,
  requiresEvidence: false,
  priority: 'HIGH',
  assignKind: 'POSITION',
  orgUnitId: 'unit-1' as string | null,
  positionId: 'pos-1' as string | null,
  userId: null as string | null,
  committeeId: null as string | null,
  committeeRoleValueId: null as string | null,
  createdById: ACTOR,
  updatedById: null,
  createdAt: new Date('2026-10-09T10:00:00Z'),
  updatedAt: new Date('2026-10-09T10:00:00Z'),
  orgUnit: { id: 'unit-1', nameEn: 'Quality', nameAr: null },
  position: { id: 'pos-1', nameEn: 'Quality Officer', nameAr: null },
  user: null,
  committee: null,
  committeeRoleValue: null,
};

const mockPrisma = {
  workflowStage: { findFirst: jest.fn() },
  workflowStageTaskDefinition: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  orgUnit: { findFirst: jest.fn() },
  orgPosition: { findFirst: jest.fn() },
  committee: { findFirst: jest.fn() },
  meeting: { findFirst: jest.fn() },
  lookupValue: { findFirst: jest.fn() },
  user: { findMany: jest.fn(), count: jest.fn() },
  committeeMember: { findMany: jest.fn(), count: jest.fn() },
  organization: { findFirst: jest.fn() },
  $transaction: jest.fn(),
};
const mockAuditLog = { log: jest.fn() };
const mockTaskService = {
  // The snapshot itself is TaskService's (task.manage.spec.ts); here it echoes
  // the draft so the engine-side resolution can be read back.
  // Status follows TaskService's rule: a pool, or someone to act, is PENDING;
  // otherwise UNASSIGNED.
  prepareStageEntryTask: jest.fn((draft: Record<string, unknown>, enteredAt: Date) => {
    const placement = draft['placement'] as { pooled: boolean; directUserIds: string[] } | null;
    const pooled = placement?.pooled ?? false;
    const actionable = pooled || (placement?.directUserIds.length ?? 0) > 0;
    return Promise.resolve({
      data: { ...draft, status: actionable ? 'PENDING' : 'UNASSIGNED', slaStartAt: enteredAt },
      eligibleAssigneeIds: placement?.directUserIds ?? [],
      delegations: new Map(),
      pooled,
    });
  }),
};

describe('StageTaskDefinitionService (ACC-190)', () => {
  let service: StageTaskDefinitionService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.workflowStage.findFirst.mockResolvedValue(STAGE);
    mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([]);
    mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue(null);
    mockPrisma.workflowStageTaskDefinition.create.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...DEFINITION, ...data, id: 'def-new' }),
    );
    mockPrisma.workflowStageTaskDefinition.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({ ...DEFINITION, ...data }),
    );
    mockPrisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-1' });
    mockPrisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-1', isSingleAssignee: false });
    mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-1', orgUnitId: 'unit-of-committee' });
    mockPrisma.lookupValue.findFirst.mockResolvedValue({ id: 'role-secretary' });
    mockPrisma.user.findMany.mockResolvedValue([{ id: 'holder-1' }]);
    mockPrisma.user.count.mockResolvedValue(1);
    mockPrisma.committeeMember.findMany.mockResolvedValue([{ userId: 'member-1' }]);
    mockPrisma.organization.findFirst.mockResolvedValue({ settings: null });
    mockPrisma.$transaction.mockResolvedValue([]);

    const module = await Test.createTestingModule({
      providers: [
        StageTaskDefinitionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: TaskService, useValue: mockTaskService },
      ],
    }).compile();
    service = module.get(StageTaskDefinitionService);
  });

  const createDto = (over: Record<string, unknown> = {}) =>
    ({
      titleEn: 'Check the terms',
      isMandatory: true,
      priority: 'HIGH',
      assignKind: 'POSITION',
      orgUnitId: 'unit-1',
      positionId: 'pos-1',
      ...over,
    }) as never;
  const refusalCode = (error: unknown) => (error as WorkflowRefusalException).code;

  // ── Create ─────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('stores the definition after the last one, and audits it in full', async () => {
      mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue({ order: 20 });

      const saved = await service.create('stage-1', createDto({ titleAr: 'مراجعة الشروط' }), ORG_A, ACTOR);

      expect(mockPrisma.workflowStageTaskDefinition.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: ORG_A,
            stageId: 'stage-1',
            order: 30,
            titleEn: 'Check the terms',
            titleAr: 'مراجعة الشروط',
            isMandatory: true,
            priority: 'HIGH',
            assignKind: 'POSITION',
            orgUnitId: 'unit-1',
            positionId: 'pos-1',
            userId: null,
            committeeId: null,
            committeeRoleValueId: null,
            createdById: ACTOR,
          }),
        }),
      );
      expect(saved.definition.dueAfterHours).toBe(16);
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          objectType: 'WorkflowStageTaskDefinition',
          tenantId: ORG_A,
          after: expect.objectContaining({ titleEn: 'Check the terms', priority: 'HIGH', assignKind: 'POSITION' }),
        }),
      );
    });

    it('warns, without refusing, when nobody holds the chosen position (ACC-55 contract)', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      const saved = await service.create('stage-1', createDto(), ORG_A, ACTOR);
      expect(saved.warning).toBe('POSITION_HAS_NO_HOLDER');
      expect(mockPrisma.workflowStageTaskDefinition.create).toHaveBeenCalled();
    });

    it('warns POOL_EMPTY for a committee role nobody holds', async () => {
      mockPrisma.committeeMember.findMany.mockResolvedValue([]);
      const saved = await service.create(
        'stage-1',
        createDto({ assignKind: 'COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeId: 'committee-1', committeeRoleValueId: 'role-secretary' }),
        ORG_A,
        ACTOR,
      );
      expect(saved.warning).toBe('POOL_EMPTY');
    });

    // The route a kind needs, and nothing it does not use.
    it.each([
      ['POSITION without its position', { positionId: undefined }],
      ['POSITION with a committee', { committeeId: 'committee-1' }],
      ['RECORD_UNIT_POSITION with a fixed unit', { assignKind: 'RECORD_UNIT_POSITION' }],
      ['RECORD_UNIT_POSITION with a person', { assignKind: 'RECORD_UNIT_POSITION', orgUnitId: undefined, userId: 'u' }],
      ['COMMITTEE_ROLE without its role', { assignKind: 'COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeId: 'committee-1' }],
      ['RECORD_COMMITTEE_ROLE with a fixed committee', { assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeId: 'c', committeeRoleValueId: 'r' }],
    ])('refuses %s with STAGE_TASK_ROUTE_INCOMPLETE, before anything is written', async (_label, over) => {
      const error = await service.create('stage-1', createDto(over), ORG_A, ACTOR).catch((e: unknown) => e);
      expect(refusalCode(error)).toBe('STAGE_TASK_ROUTE_INCOMPLETE');
      expect(mockPrisma.workflowStageTaskDefinition.create).not.toHaveBeenCalled();
    });

    it("refuses a relative route on a record type with no unit or committee of its own yet (fails closed)", async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, workflowTemplate: { objectType: 'INCIDENT' } });
      const error = await service
        .create('stage-1', createDto({ assignKind: 'RECORD_UNIT_POSITION', orgUnitId: undefined }), ORG_A, ACTOR)
        .catch((e: unknown) => e);
      expect(refusalCode(error)).toBe('STAGE_TASK_ROUTE_NOT_AVAILABLE');
    });

    it('accepts the relative routes for a committee', async () => {
      await service.create('stage-1', createDto({ assignKind: 'RECORD_UNIT_POSITION', orgUnitId: undefined }), ORG_A, ACTOR);
      await service.create(
        'stage-1',
        createDto({ assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeRoleValueId: 'role-secretary' }),
        ORG_A,
        ACTOR,
      );
      expect(mockPrisma.workflowStageTaskDefinition.create).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['STAGE_TASK_UNIT_NOT_FOUND', () => mockPrisma.orgUnit.findFirst.mockResolvedValue(null), {}],
      ['STAGE_TASK_POSITION_NOT_FOUND', () => mockPrisma.orgPosition.findFirst.mockResolvedValue(null), {}],
      [
        'STAGE_TASK_COMMITTEE_NOT_FOUND',
        () => mockPrisma.committee.findFirst.mockResolvedValue(null),
        { assignKind: 'COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeId: 'gone', committeeRoleValueId: 'role-secretary' },
      ],
      [
        'STAGE_TASK_ROLE_NOT_FOUND',
        () => mockPrisma.lookupValue.findFirst.mockResolvedValue(null),
        { assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: undefined, positionId: undefined, committeeRoleValueId: 'gone' },
      ],
    ])('refuses %s', async (code, arrange, over) => {
      arrange();
      const error = await service.create('stage-1', createDto(over), ORG_A, ACTOR).catch((e: unknown) => e);
      expect(refusalCode(error)).toBe(code);
      expect((error as WorkflowRefusalException).getStatus()).toBe(404);
    });

    it('refuses a chosen person who does not hold that position in that unit', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      const error = await service.create('stage-1', createDto({ userId: 'outsider' }), ORG_A, ACTOR).catch((e: unknown) => e);
      expect(refusalCode(error)).toBe('STAGE_TASK_USER_NOT_IN_POSITION');
    });

    it('refuses a definition on a final stage', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, isFinal: true });
      const error = await service.create('stage-1', createDto(), ORG_A, ACTOR).catch((e: unknown) => e);
      expect(refusalCode(error)).toBe('STAGE_TASK_ON_FINAL_STAGE');
    });

    it('is a 404 for a stage of another tenant', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(null);
      await expect(service.create('stage-1', createDto(), ORG_B, ACTOR)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowStage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'stage-1', workflowTemplate: { organizationId: ORG_B } } }),
      );
    });

    itEnforcesTenantIsolation('every route reference checked by stage task definitions', async () => {
      await service.create('stage-1', createDto({ userId: 'holder-1' }), ORG_B, ACTOR).catch(() => undefined);
      for (const lookup of [mockPrisma.orgUnit.findFirst, mockPrisma.orgPosition.findFirst]) {
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }));
      }
      expect(mockPrisma.user.count).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }));
    });
  });

  // ── The stage-deadline rule ─────────────────────────────────────────────────
  describe('the stage-deadline rule', () => {
    it.each([
      ['MEDIUM', 40, true],
      ['HIGH', 40, true],
      ['LOW', 40, false],
      ['LOW', 80, true],
    ])('a %s task on a %i-hour stage — allowed: %s', async (priority, stageHours, allowed) => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, slaWorkingHours: stageHours });
      const outcome = await service.create('stage-1', createDto({ priority }), ORG_A, ACTOR).then(
        () => 'saved',
        (e: unknown) => refusalCode(e),
      );
      expect(outcome).toBe(allowed ? 'saved' : 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE');
    });

    it('names both numbers and the priority in the refusal', async () => {
      const error = await service.create('stage-1', createDto({ priority: 'LOW' }), ORG_A, ACTOR).catch((e: unknown) => e);
      expect((error as WorkflowRefusalException).getResponse()).toEqual(
        expect.objectContaining({ code: 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE', taskHours: 80, stageHours: 40, priority: 'LOW' }),
      );
    });

    it("reads the tenant's own task SLA hours, not the defaults", async () => {
      mockPrisma.organization.findFirst.mockResolvedValue({
        settings: { taskSla: { LOW: { dueAfterHours: 30 }, MEDIUM: { dueAfterHours: 20 }, HIGH: { dueAfterHours: 10 }, CRITICAL: { dueAfterHours: 2 } } },
      });
      await expect(service.create('stage-1', createDto({ priority: 'LOW' }), ORG_A, ACTOR)).resolves.toBeDefined();
    });

    it('a stage with no deadline accepts any priority (Ahmad, 9 Oct, D)', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue({ ...STAGE, slaWorkingHours: null });
      await expect(service.create('stage-1', createDto({ priority: 'LOW' }), ORG_A, ACTOR)).resolves.toBeDefined();
    });

    describe("from the stage's side: assertStageDeadlineFits", () => {
      it('refuses a deadline shorter than the longest task, naming which', async () => {
        mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([
          { id: 'def-high', priority: 'HIGH' },
          { id: 'def-medium', priority: 'MEDIUM' },
        ]);
        const error = await service.assertStageDeadlineFits('stage-1', 20, ORG_A).catch((e: unknown) => e);
        expect((error as WorkflowRefusalException).getResponse()).toEqual(
          expect.objectContaining({ code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 20, longestTaskHours: 40, definitionIds: ['def-medium'] }),
        );
      });

      it('accepts a deadline equal to the longest task, and clearing the deadline', async () => {
        mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([{ id: 'def-medium', priority: 'MEDIUM' }]);
        await expect(service.assertStageDeadlineFits('stage-1', 40, ORG_A)).resolves.toBeUndefined();
        await expect(service.assertStageDeadlineFits('stage-1', null, ORG_A)).resolves.toBeUndefined();
      });

      itEnforcesTenantIsolation('definitions read by assertStageDeadlineFits', async () => {
        await service.assertStageDeadlineFits('stage-1', 4, ORG_B);
        expect(mockPrisma.workflowStageTaskDefinition.findMany).toHaveBeenCalledWith(
          expect.objectContaining({ where: { stageId: 'stage-1', organizationId: ORG_B } }),
        );
      });
    });
  });

  // ── Update, delete, reorder ─────────────────────────────────────────────────
  describe('update, delete, reorder', () => {
    it('keeps the stored route when no kind is sent, and audits before and after in full', async () => {
      mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue(DEFINITION);

      await service.update('def-1', { priority: 'MEDIUM' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowStageTaskDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'def-1' },
          data: expect.objectContaining({ priority: 'MEDIUM', orgUnitId: 'unit-1', positionId: 'pos-1', updatedById: ACTOR }),
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: expect.objectContaining({ priority: 'HIGH' }),
          after: expect.objectContaining({ priority: 'MEDIUM' }),
        }),
      );
    });

    it("a new kind brings its own route, clearing the old kind's fields", async () => {
      mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue(DEFINITION);

      await service.update('def-1', { assignKind: 'RECORD_COMMITTEE_ROLE', committeeRoleValueId: 'role-secretary' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowStageTaskDefinition.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: null, positionId: null, committeeRoleValueId: 'role-secretary' }),
        }),
      );
    });

    it('applies the deadline rule to an edited priority', async () => {
      mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue(DEFINITION);
      const error = await service.update('def-1', { priority: 'LOW' } as never, ORG_A, ACTOR).catch((e: unknown) => e);
      expect(refusalCode(error)).toBe('STAGE_TASK_DUE_AFTER_STAGE_DEADLINE');
      expect(mockPrisma.workflowStageTaskDefinition.update).not.toHaveBeenCalled();
    });

    it('deletes outright and audits it — tasks already created keep their snapshot', async () => {
      mockPrisma.workflowStageTaskDefinition.findFirst.mockResolvedValue(DEFINITION);
      await service.remove('def-1', ORG_A, ACTOR);
      expect(mockPrisma.workflowStageTaskDefinition.delete).toHaveBeenCalledWith({ where: { id: 'def-1' } });
      expect(mockAuditLog.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'DELETE', before: expect.objectContaining({ id: 'def-1' }) }));
    });

    it('refuses an order that does not list every definition of the stage exactly once', async () => {
      mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([{ id: 'def-1' }, { id: 'def-2' }]);
      for (const ids of [['def-1'], ['def-1', 'def-1'], ['def-1', 'def-3'], ['def-1', 'def-2', 'def-3']]) {
        const error = await service.reorder('stage-1', ids, ORG_A, ACTOR).catch((e: unknown) => e);
        expect(refusalCode(error)).toBe('STAGE_TASK_ORDER_MISMATCH');
      }
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('a definition read by id for update and delete', async () => {
      await expect(service.update('def-1', {} as never, ORG_B, ACTOR)).rejects.toThrow(NotFoundException);
      await expect(service.remove('def-1', ORG_B, ACTOR)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowStageTaskDefinition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'def-1', organizationId: ORG_B } }),
      );
      expect(mockPrisma.workflowStageTaskDefinition.update).not.toHaveBeenCalled();
      expect(mockPrisma.workflowStageTaskDefinition.delete).not.toHaveBeenCalled();
    });
  });

  // ── What a stage entry creates ──────────────────────────────────────────────
  describe('prepareEntryTasks', () => {
    const COMMITTEE_RECORD = { objectType: 'COMMITTEE' as const, objectId: 'committee-1' };
    const enteredAt = new Date('2026-10-09T08:00:00Z');
    const stageRow = { ...STAGE } as never;
    const entry = (definitions: Record<string, unknown>[]) => {
      mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue(definitions);
      return service.prepareEntryTasks(stageRow, COMMITTEE_RECORD, 'COMMITTEE', enteredAt, ORG_A);
    };
    const placementOf = (index = 0) =>
      (mockTaskService.prepareStageEntryTask.mock.calls[index] as unknown as [{ placement: unknown }])[0].placement;

    it("snapshots each definition, in order, onto the record's source and this stage, timed from the entry", async () => {
      const result = await entry([DEFINITION, { ...DEFINITION, id: 'def-2', titleEn: 'Collect CVs', isMandatory: false }]);

      expect(result.tasks).toHaveLength(2);
      expect(mockTaskService.prepareStageEntryTask).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          title: 'Check the terms',
          isMandatory: true,
          priority: 'HIGH',
          sourceType: 'COMMITTEE',
          sourceId: 'committee-1',
          sourceStageId: 'stage-1',
          stageTaskDefinitionId: 'def-1',
        }),
        enteredAt,
        ORG_A,
      );
      expect(mockTaskService.prepareStageEntryTask).toHaveBeenNthCalledWith(2, expect.objectContaining({ title: 'Collect CVs', isMandatory: false }), enteredAt, ORG_A);
      expect(mockPrisma.workflowStageTaskDefinition.findMany).toHaveBeenCalledWith({
        where: { stageId: 'stage-1', organizationId: ORG_A },
        orderBy: { order: 'asc' },
      });
    });

    it('creates nothing, and asks for nothing more, when the stage has no definitions', async () => {
      const result = await entry([]);
      expect(result).toEqual({ tasks: [], warnings: [] });
      expect(mockTaskService.prepareStageEntryTask).not.toHaveBeenCalled();
    });

    // ── Pools from definitions (ACC-167's rules) ──
    it('a multi-holder position pools, with its target', async () => {
      await entry([DEFINITION]);
      expect(placementOf()).toEqual({ target: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-1' }, pooled: true, directUserIds: [] });
    });

    it('a single-holder position goes straight to its holder, keeping the target', async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ isSingleAssignee: true });
      await entry([DEFINITION]);
      expect(placementOf()).toEqual({ target: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-1' }, pooled: false, directUserIds: ['holder-1'] });
    });

    it('a chosen person still in the position gets it directly', async () => {
      await entry([{ ...DEFINITION, userId: 'holder-1' }]);
      expect(placementOf()).toEqual(expect.objectContaining({ pooled: false, directUserIds: ['holder-1'] }));
    });

    it('a chosen person who has LEFT the position does not get it: the position decides', async () => {
      mockPrisma.user.count.mockResolvedValue(0);
      await entry([{ ...DEFINITION, userId: 'left' }]);
      expect(placementOf()).toEqual(expect.objectContaining({ pooled: true, directUserIds: [] }));
    });

    it("the record's unit: the committee's own unit, never a parent unit (Ahmad, 9 Oct, C)", async () => {
      mockPrisma.orgPosition.findFirst.mockResolvedValue({ isSingleAssignee: true });
      mockPrisma.user.findMany.mockResolvedValue([]); // vacant

      const result = await entry([{ ...DEFINITION, assignKind: 'RECORD_UNIT_POSITION', orgUnitId: null }]);

      expect(placementOf()).toEqual({ target: { kind: 'POSITION', orgUnitId: 'unit-of-committee', positionId: 'pos-1' }, pooled: false, directUserIds: [] });
      expect(mockPrisma.orgUnit.findFirst).not.toHaveBeenCalled(); // no walk up the tree
      expect(result.warnings).toEqual(['"Check the terms" was created with nobody to act on it']);
    });

    it("the record's committee, and a fixed committee: always a pool on the role", async () => {
      await entry([
        { ...DEFINITION, assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: null, positionId: null, committeeRoleValueId: 'role-secretary' },
        { ...DEFINITION, id: 'def-2', assignKind: 'COMMITTEE_ROLE', orgUnitId: null, positionId: null, committeeId: 'other-committee', committeeRoleValueId: 'role-chair' },
      ]);
      expect(placementOf(0)).toEqual({ target: { kind: 'COMMITTEE_ROLE', committeeId: 'committee-1', roleValueId: 'role-secretary' }, pooled: true, directUserIds: [] });
      expect(placementOf(1)).toEqual({ target: { kind: 'COMMITTEE_ROLE', committeeId: 'other-committee', roleValueId: 'role-chair' }, pooled: true, directUserIds: [] });
    });

    it('a pool nobody is in is told to the actor as a warning', async () => {
      mockPrisma.committeeMember.findMany.mockResolvedValue([]);
      const result = await entry([{ ...DEFINITION, assignKind: 'RECORD_COMMITTEE_ROLE', orgUnitId: null, positionId: null, committeeRoleValueId: 'role-secretary' }]);
      expect(result.warnings).toEqual(['"Check the terms" went to a pool nobody is in yet']);
    });

    it('a record kind with no task source creates nothing', async () => {
      mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([DEFINITION]);
      const result = await service.prepareEntryTasks(stageRow, COMMITTEE_RECORD, null, enteredAt, ORG_A);
      expect(result.tasks).toEqual([]);
    });

    itEnforcesTenantIsolation("a stage's definitions and the record's unit read at entry", async () => {
      mockPrisma.workflowStageTaskDefinition.findMany.mockResolvedValue([{ ...DEFINITION, assignKind: 'RECORD_UNIT_POSITION', orgUnitId: null }]);
      await service.prepareEntryTasks(stageRow, COMMITTEE_RECORD, 'COMMITTEE', enteredAt, ORG_B);
      expect(mockPrisma.workflowStageTaskDefinition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { stageId: 'stage-1', organizationId: ORG_B } }));
      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'committee-1', organizationId: ORG_B } }));
    });
  });
});
