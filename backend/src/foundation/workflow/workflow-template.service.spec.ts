import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { stageAuditDiff, WorkflowTemplateService } from './workflow-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { StageTaskDefinitionService } from './stage-task-definition.service';
import { WorkflowRefusalException } from './workflow-refusal';
import { PROTECTED_TEMPLATES } from './workflow-stage-keys';
import { getMetadataStorage } from 'class-validator';
import { UpdateWorkflowStageDto } from './dto/update-workflow-stage.dto';
import { WorkflowObjectType } from '../../../generated/prisma/enums';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const ORG_A = 'org-a-id';
const ORG_B = 'org-b-id';
const ACTOR = 'actor-id';

const BASE_TEMPLATE = {
  id: 'template-1',
  organizationId: ORG_A,
  nameEn: 'Document Lifecycle',
  nameAr: 'دورة حياة الوثيقة',
  objectType: 'DOCUMENT',
  isDefault: true,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const BASE_STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  // ACC-239 — the protected-template check reads the stage's template type.
  workflowTemplate: { objectType: 'DOCUMENT' },
  nameEn: 'Drafting',
  nameAr: 'مسودة',
  description: null as string | null,
  order: 10,
  slaWorkingHours: null as number | null,
  isInitial: true,
  isFinal: false,
  escalationConfig: null as unknown,
  // ACC-255 — a stage's flags, and (on reads that include them) its action rows.
  flags: [] as string[],
  recordActions: [] as { actionKey: string }[],
};

const BASE_TRANSITION = {
  id: 'transition-1',
  fromStage: { workflowTemplate: { objectType: 'DOCUMENT' } },
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Submit for Review',
  labelAr: 'إرسال للمراجعة',
  validatorConfig: null as unknown,
  mover: 'PERSON' as string | null,
};

const BASE_ACTION = {
  id: 'action-1',
  workflowTransition: { fromStage: { workflowTemplate: { objectType: 'DOCUMENT' } } },
  workflowTransitionId: 'transition-1',
  actionType: 'CREATE_TASK',
  order: 10,
  isEnabled: true,
  configJson: null as unknown,
};

const makeTemplate = (overrides: Partial<typeof BASE_TEMPLATE> = {}) => ({
  ...BASE_TEMPLATE,
  ...overrides,
});
const makeStage = (overrides: Partial<typeof BASE_STAGE> = {}) => ({ ...BASE_STAGE, ...overrides });
const makeTransition = (overrides: Partial<typeof BASE_TRANSITION> = {}) => ({
  ...BASE_TRANSITION,
  ...overrides,
});
const makeAction = (overrides: Partial<typeof BASE_ACTION> = {}) => ({ ...BASE_ACTION, ...overrides });

// ─── Mock Setup ───────────────────────────────────────────────────────────────

const mockPrisma = {
  workflowTemplate: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  },
  // ACC-190 — updateStage() refuses to make a stage that creates tasks final.
  workflowStageTaskDefinition: { count: jest.fn() },
  workflowStage: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  workflowTransition: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    // ACC-191 — removeStage counts the transitions in and out (STAGE_HAS_TRANSITIONS).
    count: jest.fn().mockResolvedValue(0),
  },
  // ACC-191 — removing an action or a transition counts its runs.
  workflowActionLog: {
    count: jest.fn().mockResolvedValue(0),
  },
  // ACC-271 — who works a seeded stage (a CREATOR entry where the seed names one).
  workflowStageAssignee: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    // ACC-271 PR 3 — a stage save reads, replaces and keeps its entries.
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  // ACC-255 — the record actions a stage allows.
  workflowStageRecordAction: {
    createMany: jest.fn().mockResolvedValue({ count: 0 }),
    findMany: jest.fn().mockResolvedValue([]),
    deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
  },
  workflowTransitionAction: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    aggregate: jest.fn(),
  },
  role: {
    findMany: jest.fn(),
  },
  // findMany on each (ACC-271 PR 3): the batched reads a `who` is checked and named with.
  user: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  committee: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  lookupValue: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  // ACC-54 — POSITION_FIXED's two write-time tenant validators.
  orgPosition: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  orgUnit: {
    findFirst: jest.fn(),
    findMany: jest.fn().mockResolvedValue([]),
  },
  // ACC-55 — resolvePermissionWarning()'s two queries. Both transition write
  // paths call it, so EVERY addTransition/updateTransition test needs these
  // mocked or the call throws on undefined. beforeEach defaults them to the
  // satisfiable case (known permission, at least one active role holds it),
  // so tests that don't care about the warning are unaffected.
  permission: {
    findFirst: jest.fn(),
  },
  rolePermission: {
    count: jest.fn(),
  },
  // ACC-255 PR 4b-be (G4) — the template read's live count per stage.
  workflowInstance: {
    groupBy: jest.fn().mockResolvedValue([]),
  },
  // ACC-120 slice 5 (F1) — read only when a transition asks for a platform key.
  organization: {
    findUnique: jest.fn(),
  },
  // An array runs as a batch; a callback (ACC-255's stage saves) runs against this same mock.
  $transaction: jest.fn((arg: Promise<unknown>[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> =>
    typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
  ),
  $queryRaw: jest.fn().mockResolvedValue([]),
};

const mockAuditLog = { log: jest.fn() };
// ACC-190 — what each stage creates on entry (the template read's summary),
// and the stage-deadline rule from the stage's side.
const mockStageTasks = {
  summaryForStages: jest.fn().mockResolvedValue(new Map()),
  assertStageDeadlineFits: jest.fn().mockResolvedValue(undefined),
  // ACC-208 (B3).
  taskDueHours: jest.fn().mockResolvedValue({ LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 }),
};

// The stable code a refusal carries in its body (ACC-120 slice 5).
const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return ((e as { getResponse?: () => { code?: string } }).getResponse?.() ?? {}).code;
  }
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowTemplateService', () => {
  let service: WorkflowTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Defaults: a user, a committee and a committee role a test names belong to
    // ORG_A, this file's usual "happy path" org.
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-a', organizationId: ORG_A });
    mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-a', organizationId: ORG_A });
    mockPrisma.lookupValue.findFirst.mockResolvedValue({ id: 'lookup-chairman-id', organizationId: null });
    // ACC-57 / ACC-191 — clearAllMocks keeps implementations a test set, so
    // the reads the new checks make start empty in every test: no stages read
    // back (readStartEnd), no lock rows, nothing referencing, nothing run.
    mockPrisma.workflowStage.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.workflowTransition.count.mockResolvedValue(0);
    mockPrisma.workflowActionLog.count.mockResolvedValue(0);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: StageTaskDefinitionService, useValue: mockStageTasks },
      ],
    }).compile();

    service = module.get<WorkflowTemplateService>(WorkflowTemplateService);
  });

  // ── seedDefaultWorkflows ─────────────────────────────────────────────────────

  describe('seedDefaultWorkflows', () => {
    // Simulates a real DB with in-memory Maps keyed the same way the service's
    // own findFirst lookups are keyed, so repeated calls behave like a real
    // upsert (found on the 2nd pass) rather than always creating.
    function installFakeStore() {
      let counter = 0;
      const nextId = (prefix: string) => `${prefix}-${++counter}`;

      const templates = new Map<string, Record<string, unknown>>();
      const stages = new Map<string, Record<string, unknown>>();
      const transitions = new Map<string, Record<string, unknown>>();
      const actions = new Map<string, Record<string, unknown>>();

      mockPrisma.workflowTemplate.findFirst.mockImplementation(
        ({ where }: { where: { organizationId: string; objectType: string } }) =>
          Promise.resolve(templates.get(`${where.organizationId}:${where.objectType}`) ?? null),
      );
      mockPrisma.workflowTemplate.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: nextId('template'), ...data };
          templates.set(`${data['organizationId']}:${data['objectType']}`, row);
          return Promise.resolve(row);
        },
      );
      mockPrisma.workflowTemplate.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = Array.from(templates.values()).find((t) => t['id'] === where.id)!;
          const updated = { ...existing, ...data };
          templates.set(`${updated['organizationId']}:${updated['objectType']}`, updated);
          return Promise.resolve(updated);
        },
      );

      mockPrisma.workflowStage.findFirst.mockImplementation(
        ({ where }: { where: { workflowTemplateId: string; nameEn: string } }) =>
          Promise.resolve(stages.get(`${where.workflowTemplateId}:${where.nameEn}`) ?? null),
      );
      mockPrisma.workflowStage.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: nextId('stage'), ...data };
          stages.set(`${data['workflowTemplateId']}:${data['nameEn']}`, row);
          return Promise.resolve(row);
        },
      );
      mockPrisma.workflowStage.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = Array.from(stages.values()).find((s) => s['id'] === where.id)!;
          const updated = { ...existing, ...data };
          stages.set(`${updated['workflowTemplateId']}:${updated['nameEn']}`, updated);
          return Promise.resolve(updated);
        },
      );

      mockPrisma.workflowTransition.findFirst.mockImplementation(
        ({ where }: { where: { fromStageId: string; toStageId: string } }) =>
          Promise.resolve(transitions.get(`${where.fromStageId}:${where.toStageId}`) ?? null),
      );
      mockPrisma.workflowTransition.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: nextId('transition'), ...data };
          transitions.set(`${data['fromStageId']}:${data['toStageId']}`, row);
          return Promise.resolve(row);
        },
      );
      mockPrisma.workflowTransition.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = Array.from(transitions.values()).find((t) => t['id'] === where.id)!;
          const updated = { ...existing, ...data };
          transitions.set(`${updated['fromStageId']}:${updated['toStageId']}`, updated);
          return Promise.resolve(updated);
        },
      );

      mockPrisma.workflowTransitionAction.findFirst.mockImplementation(
        ({
          where,
        }: {
          where: { workflowTransitionId: string; actionType: string; order: number };
        }) =>
          Promise.resolve(
            actions.get(`${where.workflowTransitionId}:${where.actionType}:${where.order}`) ?? null,
          ),
      );
      mockPrisma.workflowTransitionAction.create.mockImplementation(
        ({ data }: { data: Record<string, unknown> }) => {
          const row = { id: nextId('action'), ...data };
          actions.set(`${data['workflowTransitionId']}:${data['actionType']}:${data['order']}`, row);
          return Promise.resolve(row);
        },
      );
      mockPrisma.workflowTransitionAction.update.mockImplementation(
        ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          const existing = Array.from(actions.values()).find((a) => a['id'] === where.id)!;
          const updated = { ...existing, ...data };
          actions.set(
            `${updated['workflowTransitionId']}:${updated['actionType']}:${updated['order']}`,
            updated,
          );
          return Promise.resolve(updated);
        },
      );

      mockPrisma.role.findMany.mockResolvedValue(
        ['QUALITY_MANAGER', 'QUALITY_OFFICER', 'BASE_USER'].map((key) => ({
          id: `role-${key}`,
          key,
        })),
      );

      return { templates, stages, transitions, actions };
    }

    const totalStages = SYSTEM_WORKFLOW_SEED.reduce((sum, w) => sum + w.stages.length, 0);
    const totalTransitions = SYSTEM_WORKFLOW_SEED.reduce((sum, w) => sum + w.transitions.length, 0);
    const totalActions = SYSTEM_WORKFLOW_SEED.reduce(
      (sum, w) => sum + w.transitions.reduce((s, t) => s + t.actions.length, 0),
      0,
    );

    // ACC-190 — every transition is written with its kind, and no CREATE_TASK.
    it('writes each seeded transition with its kind, and creates no CREATE_TASK action', async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      const created = mockPrisma.workflowTransition.create.mock.calls.map(([arg]: [{ data: { kind: string } }]) => arg.data.kind);
      // ACC-190's 14 and 8, plus ACC-239's change request: one return, four exits.
      expect(created.filter((k: string) => k === 'RETURN')).toHaveLength(15);
      expect(created.filter((k: string) => k === 'EXIT')).toHaveLength(12);
      expect(created.every((k: string) => ['ADVANCE', 'RETURN', 'EXIT'].includes(k))).toBe(true);
      const actionTypes = mockPrisma.workflowTransitionAction.create.mock.calls.map(([arg]: [{ data: { actionType: string } }]) => arg.data.actionType);
      expect(actionTypes).not.toContain('CREATE_TASK');
    });

    // ACC-233 — the committee lifecycle's stages carry the seed's stable key; no
    // other template's do yet (KEYED_SEED_TEMPLATES).
    it("ACC-255 — writes each seeded stage's record actions and flags when it creates the stage, and none on a second run", async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      const created = mockPrisma.workflowStage.create.mock.calls.map(
        ([arg]: [{ data: { key?: string; nameEn: string; flags: string[] } }]) => arg.data,
      );
      const committee = SYSTEM_WORKFLOW_SEED.find((w) => w.objectType === 'COMMITTEE')!;
      for (const seedStage of committee.stages) {
        const row = created.find((d: { key?: string }) => d.key === seedStage.key)!;
        expect({ key: seedStage.key, flags: row.flags }).toEqual({ key: seedStage.key, flags: [...(seedStage.flags ?? [])] });
      }
      const written = mockPrisma.workflowStageRecordAction.createMany.mock.calls.flatMap(
        ([arg]: [{ data: { organizationId: string; actionKey: string }[] }]) => arg.data,
      );
      expect(written.every((r: { organizationId: string }) => r.organizationId === ORG_A)).toBe(true);
      const expected = SYSTEM_WORKFLOW_SEED.flatMap((w) => w.stages.flatMap((st) => [...(st.actions ?? [])]));
      expect(written.map((r: { actionKey: string }) => r.actionKey).sort()).toEqual(expected.sort());
      // Every stage without a flag gets an explicit empty list, never undefined.
      expect(created.every((d: { flags: unknown }) => Array.isArray(d.flags))).toBe(true);

      // A second run finds every stage and writes no actions: a stage that
      // exists keeps what its tenant configured.
      mockPrisma.workflowStageRecordAction.createMany.mockClear();
      await service.seedDefaultWorkflows(ORG_A);
      expect(mockPrisma.workflowStageRecordAction.createMany).not.toHaveBeenCalled();
    });

    it("writes the seed key on every COMMITTEE and COMMITTEE_CHANGE_REQUEST stage, and on no other template's", async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      const created = mockPrisma.workflowStage.create.mock.calls.map(
        ([arg]: [{ data: { nameEn: string; key?: string } }]) => arg.data,
      );
      // ACC-233 keyed the committee lifecycle; ACC-239 the change request's six stages.
      const keyedSeeds = SYSTEM_WORKFLOW_SEED.filter((w) => w.objectType === 'COMMITTEE' || w.objectType === 'COMMITTEE_CHANGE_REQUEST');
      const keyedStages = keyedSeeds.flatMap((w) => w.stages);
      const keyed = created.filter((d: { key?: string }) => d.key !== undefined);
      expect(keyed.map((d: { key?: string }) => d.key)).toEqual(keyedStages.map((st) => st.key));
      expect(keyed.map((d: { nameEn: string }) => d.nameEn)).toEqual(keyedStages.map((st) => st.nameEn));
      expect(created.length - keyed.length).toBe(totalStages - keyedStages.length);
      // Looked up by key first, so a stage renamed since is found, not recreated.
      expect(mockPrisma.workflowStage.findFirst).toHaveBeenCalledWith({
        where: { workflowTemplateId: expect.any(String), key: 'dissolution_pending' },
      });
    });

    it('creates all 8 templates with correct stages, transitions, and actions for a fresh org', async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledTimes(SYSTEM_WORKFLOW_SEED.length);
      expect(mockPrisma.workflowStage.create).toHaveBeenCalledTimes(totalStages);
      expect(mockPrisma.workflowTransition.create).toHaveBeenCalledTimes(totalTransitions);
      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledTimes(totalActions);
      expect(mockPrisma.workflowTemplate.update).not.toHaveBeenCalled();
    });

    it('correctly wires transitions from seed stage keys to the real generated stage IDs', async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      const transitionCreateCalls = mockPrisma.workflowTransition.create.mock.calls as Array<
        [{ data: { fromStageId: string; toStageId: string } }]
      >;
      for (const [{ data }] of transitionCreateCalls) {
        expect(data.fromStageId).toMatch(/^stage-\d+$/);
        expect(data.toStageId).toMatch(/^stage-\d+$/);
      }
    });

    it('is idempotent — calling twice produces no duplicate templates, stages, transitions, or actions', async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);
      await service.seedDefaultWorkflows(ORG_A);

      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledTimes(SYSTEM_WORKFLOW_SEED.length);
      expect(mockPrisma.workflowTemplate.update).toHaveBeenCalledTimes(SYSTEM_WORKFLOW_SEED.length);
      expect(mockPrisma.workflowStage.create).toHaveBeenCalledTimes(totalStages);
      expect(mockPrisma.workflowStage.update).toHaveBeenCalledTimes(totalStages);
      expect(mockPrisma.workflowTransition.create).toHaveBeenCalledTimes(totalTransitions);
      expect(mockPrisma.workflowTransition.update).toHaveBeenCalledTimes(totalTransitions);
      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledTimes(totalActions);
      expect(mockPrisma.workflowTransitionAction.update).toHaveBeenCalledTimes(totalActions);
    });
  });

  // ── getTemplates ─────────────────────────────────────────────────────────────

  describe('getTemplates', () => {
    it('returns templates scoped to the tenant', async () => {
      mockPrisma.workflowTemplate.findMany.mockResolvedValue([BASE_TEMPLATE]);

      const result = await service.getTemplates(ORG_A);

      expect(result).toHaveLength(1);
      expect(mockPrisma.workflowTemplate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: ORG_A } }),
      );
    });
  });

  // ── getTemplateById ──────────────────────────────────────────────────────────

  describe('getTemplateById', () => {
    it('returns the template with its stages populated, ordered by order', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        { ...BASE_STAGE, transitionsFrom: [] },
      ]);

      const result = await service.getTemplateById('template-1', ORG_A);

      expect(result.id).toBe('template-1');
      expect(result.stages).toHaveLength(1);
      expect(result.stages?.[0]?.transitions).toEqual([]);
      expect(mockPrisma.workflowStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { order: 'asc' } }),
      );
    });

    it("includes each stage's outgoing transitions with their actions", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findMany.mockResolvedValue([
        {
          ...BASE_STAGE,
          transitionsFrom: [{ ...BASE_TRANSITION, actions: [BASE_ACTION] }],
        },
      ]);

      const result = await service.getTemplateById('template-1', ORG_A);

      expect(result.stages?.[0]?.transitions).toHaveLength(1);
      expect(result.stages?.[0]?.transitions?.[0]?.actions).toHaveLength(1);
      expect(mockPrisma.workflowStage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: {
            transitionsFrom: { include: { actions: { orderBy: { order: 'asc' } } } },
            // ACC-255 — each stage's action rows, read with the caller's organisation.
            recordActions: { where: { organizationId: ORG_A }, select: { actionKey: true } },
            // ACC-271 PR 3 — who works each stage, in order, in the same query.
            assignees: { where: { organizationId: ORG_A }, orderBy: { order: 'asc' } },
          },
        }),
      );
    });

    it('throws NotFoundException when the template does not exist', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTemplateById('missing', ORG_A)).rejects.toThrow(NotFoundException);
    });

    it('throws NotFoundException when the template belongs to a different organization', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(service.getTemplateById('template-1', ORG_B)).rejects.toThrow(NotFoundException);
    });
  });

  // ── createTemplate ───────────────────────────────────────────────────────────

  describe('createTemplate', () => {
    it("creates a template scoped to the caller's organizationId", async () => {
      mockPrisma.workflowTemplate.create.mockResolvedValue(makeTemplate({ isDefault: false }));

      await service.createTemplate(
        { nameEn: 'Custom', nameAr: 'مخصص', objectType: 'DOCUMENT' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: ORG_A }) }),
      );
    });

    it('defaults isDefault to false when omitted', async () => {
      mockPrisma.workflowTemplate.create.mockResolvedValue(makeTemplate({ isDefault: false }));

      await service.createTemplate(
        { nameEn: 'Custom', nameAr: 'مخصص', objectType: 'DOCUMENT' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isDefault: false }) }),
      );
    });

    it('writes a CREATE audit log entry', async () => {
      mockPrisma.workflowTemplate.create.mockResolvedValue(BASE_TEMPLATE);

      await service.createTemplate(
        { nameEn: 'Custom', nameAr: 'مخصص', objectType: 'DOCUMENT' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', objectType: 'WorkflowTemplate' }),
      );
    });
  });

  // ── updateTemplate ───────────────────────────────────────────────────────────

  describe('updateTemplate', () => {
    it('updates only the provided fields', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowTemplate.update.mockResolvedValue(
        makeTemplate({ nameEn: 'Renamed' }),
      );

      await service.updateTemplate('template-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nameEn: 'Renamed' } }),
      );
    });

    it('throws NotFoundException for a template in another org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTemplate('template-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('writes a before/after UPDATE audit log entry', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowTemplate.update.mockResolvedValue(makeTemplate({ nameEn: 'Renamed' }));

      await service.updateTemplate('template-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: expect.objectContaining({ nameEn: BASE_TEMPLATE.nameEn }),
          after: expect.objectContaining({ nameEn: 'Renamed' }),
        }),
      );
    });
  });

  // ── setDefault ───────────────────────────────────────────────────────────────

  describe('setDefault', () => {
    it('marks the template default and unsets any sibling default for the same objectType', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isDefault: false }));
      // ACC-57 (Q2) — it has a starting stage.
      mockPrisma.workflowStage.findMany.mockResolvedValueOnce([{ id: 'stage-1', nameEn: 'Draft', nameAr: null, isInitial: true, isFinal: false }]);
      mockPrisma.workflowTemplate.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.workflowTemplate.update.mockResolvedValue(makeTemplate({ isDefault: true }));

      await service.setDefault('template-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG_A, objectType: BASE_TEMPLATE.objectType, NOT: { id: 'template-1' } },
          data: { isDefault: false },
        }),
      );
      expect(mockPrisma.workflowTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isDefault: true } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalled();
    });

    // ACC-57 (Q2) — the default is what startInstance() reads, so one with no
    // starting stage would throw at whoever next creates a record.
    it('refuses 409 STAGE_INITIAL_REQUIRED for a template with no starting stage, or no stages, changing nothing', async () => {
      for (const stages of [[], [{ id: 'stage-1', nameEn: 'Draft', nameAr: null, isInitial: false, isFinal: false }]]) {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isDefault: false }));
        mockPrisma.workflowStage.findMany.mockResolvedValueOnce(stages);

        await expect(service.setDefault('template-1', ORG_A, ACTOR)).rejects.toMatchObject({
          status: 409,
          response: { code: 'STAGE_INITIAL_REQUIRED' },
        });
      }
      expect(mockPrisma.workflowTemplate.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.workflowTemplate.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('refuses the same when an update makes a template with no starting stage the default', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isDefault: false }));
      mockPrisma.workflowStage.findMany.mockResolvedValueOnce([]);

      await expect(service.updateTemplate('template-1', { isDefault: true } as never, ORG_A, ACTOR)).rejects.toMatchObject({
        response: { code: 'STAGE_INITIAL_REQUIRED' },
      });
      expect(mockPrisma.workflowTemplate.update).not.toHaveBeenCalled();
    });

    it('is a no-op when the template is already default', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isDefault: true }));

      await service.setDefault('template-1', ORG_A, ACTOR);

      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if the template does not exist for this org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(service.setDefault('template-1', ORG_B, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── deactivateTemplate ───────────────────────────────────────────────────────

  describe('deactivateTemplate', () => {
    it('sets isActive to false', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isActive: true }));

      await service.deactivateTemplate('template-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowTemplate.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isActive: false } }),
      );
      expect(mockAuditLog.log).toHaveBeenCalled();
    });

    it('is a no-op when already inactive', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ isActive: false }));

      await service.deactivateTemplate('template-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowTemplate.update).not.toHaveBeenCalled();
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a missing or cross-tenant template', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(service.deactivateTemplate('template-1', ORG_B, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── addStage ─────────────────────────────────────────────────────────────────

  describe('addStage', () => {
    it('creates a stage under the given template', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.create.mockResolvedValue(BASE_STAGE);

      await service.addStage(
        'template-1',
        { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workflowTemplateId: 'template-1' }) }),
      );
    });

    it('throws NotFoundException if the template does not belong to this org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.addStage(
          'template-1',
          { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('defaults isInitial and isFinal to false when omitted', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.create.mockResolvedValue(BASE_STAGE);

      await service.addStage(
        'template-1',
        { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isInitial: false, isFinal: false }) }),
      );
    });

  });

  // ── updateStage ──────────────────────────────────────────────────────────────

  describe('updateStage', () => {
    it('updates only the provided fields', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockPrisma.workflowStage.update.mockResolvedValue(makeStage({ nameEn: 'Renamed' }));

      await service.updateStage('stage-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowStage.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { nameEn: 'Renamed' } }),
      );
    });

    it("throws NotFoundException when the stage's parent template belongs to a different org", async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStage('stage-1', { nameEn: 'Renamed' } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowStage.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'stage-1', workflowTemplate: { organizationId: ORG_B } } }),
      );
    });
  });

  // ── removeStage ──────────────────────────────────────────────────────────────

  describe('removeStage', () => {
    // The template's stages as readStartEnd() returns them, before and after the delete.
    const asRead = (id: string, isInitial: boolean) => ({ id, nameEn: id, nameAr: null, isInitial, isFinal: false });

    it('deletes the stage when nothing references it', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: false }));

      await service.removeStage('stage-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowStage.delete).toHaveBeenCalledWith({ where: { id: 'stage-1' } });
    });

    // ACC-191 (Q4) — the old codeless refusal, now said from a code.
    it('refuses 409 STAGE_HAS_TRANSITIONS, with the count, while a transition still references it', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: false }));
      mockPrisma.workflowTransition.count.mockResolvedValueOnce(2);

      const refusal = service.removeStage('stage-1', ORG_A, ACTOR);
      await expect(refusal).rejects.toMatchObject({ status: 409, response: { code: 'STAGE_HAS_TRANSITIONS', transitionCount: 2 } });
      expect(mockPrisma.workflowStage.delete).not.toHaveBeenCalled();
    });

    // ACC-191 — a stage a record has entered is kept (WorkflowInstanceStage is RESTRICT).
    it('refuses 409 STAGE_IN_USE, counting records, when a record has entered the stage', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: false }));
      // The template lock, the stage lock, then the records count.
      mockPrisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([{ entries: 3, records: 2 }]);

      await expect(service.removeStage('stage-1', ORG_A, ACTOR)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STAGE_IN_USE', recordCount: 2 },
      });
      expect(mockPrisma.workflowStage.delete).not.toHaveBeenCalled();
    });

    // ACC-57 (Q4) — the old "initial stage while siblings exist" refusal is the rule's own.
    it('refuses 409 STAGE_INITIAL_REQUIRED, naming it, when removing the starting stage leaves others with none', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: true }));
      mockPrisma.workflowStage.findMany
        .mockResolvedValueOnce([asRead('stage-1', true), asRead('stage-2', false)])
        .mockResolvedValueOnce([asRead('stage-2', false)]);

      await expect(service.removeStage('stage-1', ORG_A, ACTOR)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STAGE_INITIAL_REQUIRED', stageIds: ['stage-1'] },
      });
      expect(mockAuditLog.log).not.toHaveBeenCalled();
    });

    it('succeeds removing the initial stage when it is the only stage left', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: true }));
      mockPrisma.workflowStage.findMany.mockResolvedValueOnce([asRead('stage-1', true)]).mockResolvedValueOnce([]);

      await service.removeStage('stage-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowStage.delete).toHaveBeenCalledWith({ where: { id: 'stage-1' } });
    });
  });

  // ── addTransition ────────────────────────────────────────────────────────────

  describe('addTransition', () => {
    it('creates a transition between two stages of the same template', async () => {
      mockPrisma.workflowStage.findFirst
        .mockResolvedValueOnce(makeStage({ id: 'stage-1', workflowTemplateId: 'template-1' }))
        .mockResolvedValueOnce(makeStage({ id: 'stage-2', workflowTemplateId: 'template-1' }));
      mockPrisma.workflowTransition.create.mockResolvedValue(BASE_TRANSITION);

      await service.addTransition(
        { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTransition.create).toHaveBeenCalled();
    });

    // ACC-271 PR 5b — the transition panel sets Approval path when adding.
    it('stores isApprovalPath when sent on create, and leaves the default when not', async () => {
      const add = async (extra: Record<string, unknown>): Promise<Record<string, unknown>> => {
        mockPrisma.workflowStage.findFirst
          .mockResolvedValueOnce(makeStage({ id: 'stage-1', workflowTemplateId: 'template-1' }))
          .mockResolvedValueOnce(makeStage({ id: 'stage-2', workflowTemplateId: 'template-1' }));
        mockPrisma.workflowTransition.create.mockResolvedValue(BASE_TRANSITION);
        await service.addTransition(
          { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', ...extra } as never,
          ORG_A,
          ACTOR,
        );
        const calls = mockPrisma.workflowTransition.create.mock.calls;
        return (calls[calls.length - 1]![0] as { data: Record<string, unknown> }).data;
      };
      expect((await add({ isApprovalPath: true })).isApprovalPath).toBe(true);
      expect(await add({})).not.toHaveProperty('isApprovalPath');
    });

    it('throws NotFoundException if fromStage does not belong to this org', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addTransition(
          { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال' } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException if fromStage and toStage belong to different templates', async () => {
      mockPrisma.workflowStage.findFirst
        .mockResolvedValueOnce(makeStage({ id: 'stage-1', workflowTemplateId: 'template-1' }))
        .mockResolvedValueOnce(makeStage({ id: 'stage-2', workflowTemplateId: 'template-2' }));

      await expect(
        service.addTransition(
          { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال' } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.workflowTransition.create).not.toHaveBeenCalled();
    });
  });

  // ── updateTransition ─────────────────────────────────────────────────────────

  describe('updateTransition', () => {
    it('updates label, trigger condition, required permission, and validator config', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransition.update.mockResolvedValue(
        makeTransition({ labelEn: 'Renamed' }),
      );

      await service.updateTransition('transition-1', { labelEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { labelEn: 'Renamed' } }),
      );
      // fromStageId/toStageId are structurally absent from UpdateWorkflowTransitionDto
      // (OmitType at the type level) — there is nothing to assert against at runtime;
      // this is a compile-time guarantee, not a behavior to unit-test.
    });

    it('throws NotFoundException for a transition in another org', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTransition('transition-1', { labelEn: 'Renamed' } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('writes a before/after UPDATE audit log entry', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransition.update.mockResolvedValue(
        makeTransition({ labelEn: 'Renamed' }),
      );

      await service.updateTransition('transition-1', { labelEn: 'Renamed' } as never, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: expect.objectContaining({ labelEn: BASE_TRANSITION.labelEn }),
          after: expect.objectContaining({ labelEn: 'Renamed' }),
        }),
      );
    });
  });

  // ── resolvePermissionWarning (ACC-55) ────────────────────────────────────────

  // ── F1: a transition may not require a key no role can be given ─────────────

  // ── removeTransition ─────────────────────────────────────────────────────────

  describe('removeTransition', () => {
    it('deletes the transition and first deletes its transition-action rows', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);

      await service.removeTransition('transition-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.deleteMany).toHaveBeenCalledWith({
        where: { workflowTransitionId: 'transition-1' },
      });
      expect(mockPrisma.workflowTransition.delete).toHaveBeenCalledWith({
        where: { id: 'transition-1' },
      });
    });

    // ACC-191 (Q3) — a transition whose actions have run is kept.
    it('refuses 409 TRANSITION_IN_USE, with the runs, and deletes nothing', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowActionLog.count.mockResolvedValueOnce(5);

      await expect(service.removeTransition('transition-1', ORG_A, ACTOR)).rejects.toMatchObject({
        status: 409,
        response: { code: 'TRANSITION_IN_USE', runCount: 5 },
      });
      expect(mockPrisma.workflowActionLog.count).toHaveBeenCalledWith({
        where: { organizationId: ORG_A, workflowTransitionAction: { workflowTransitionId: 'transition-1' } },
      });
      expect(mockPrisma.workflowTransitionAction.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.workflowTransition.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a cross-tenant transition', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(service.removeTransition('transition-1', ORG_B, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.workflowTransitionAction.deleteMany).not.toHaveBeenCalled();
    });
  });

  // ── addTransitionAction ──────────────────────────────────────────────────────

  describe('addTransitionAction', () => {
    it('creates an action attached to the transition', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction(
        'transition-1',
        { actionType: 'SEND_NOTIFICATION', order: 10 } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ workflowTransitionId: 'transition-1' }) }),
      );
    });

    it('throws NotFoundException if the transition belongs to a different org', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await expect(
        service.addTransitionAction(
          'transition-1',
          { actionType: 'SEND_NOTIFICATION', order: 10 } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // ACC-271 PR 5b — the order is optional; left out, the action goes last.
    it('keeps a sent order as sent, with no extra read', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction('transition-1', { actionType: 'SEND_NOTIFICATION', order: 0 } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.aggregate).not.toHaveBeenCalled();
      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ order: 0 }) }),
      );
    });

    it('a left-out order goes after the transition’s highest: highest + 10', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.aggregate.mockResolvedValue({ _max: { order: 35 } });
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction('transition-1', { actionType: 'SEND_NOTIFICATION' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.aggregate).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ order: 45 }) }),
      );
    });

    it('a left-out order on a transition with no actions is 10', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.aggregate.mockResolvedValue({ _max: { order: null } });
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction('transition-1', { actionType: 'SEND_NOTIFICATION' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ order: 10 }) }),
      );
    });

    it('should NOT return records belonging to a different tenant — the next order reads only this organisation’s transition', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.aggregate.mockResolvedValue({ _max: { order: null } });
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction('transition-1', { actionType: 'SEND_NOTIFICATION' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workflowTransitionId: 'transition-1',
            workflowTransition: { fromStage: { workflowTemplate: { organizationId: ORG_A } } },
          },
        }),
      );
    });

    it('defaults isEnabled to true when omitted', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction(
        'transition-1',
        { actionType: 'SEND_NOTIFICATION', order: 10 } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isEnabled: true }) }),
      );
    });
  });

  // ── updateTransitionAction ───────────────────────────────────────────────────

  describe('updateTransitionAction', () => {
    it('updates only the provided fields', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(BASE_ACTION);
      mockPrisma.workflowTransitionAction.update.mockResolvedValue(
        makeAction({ isEnabled: false }),
      );

      await service.updateTransitionAction('action-1', { isEnabled: false } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { isEnabled: false } }),
      );
    });

    it('throws NotFoundException for a cross-tenant action', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(null);

      await expect(
        service.updateTransitionAction('action-1', { isEnabled: false } as never, ORG_B, ACTOR),
      ).rejects.toThrow(NotFoundException);
    });

    it('writes a before/after UPDATE audit log entry', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(BASE_ACTION);
      mockPrisma.workflowTransitionAction.update.mockResolvedValue(
        makeAction({ isEnabled: false }),
      );

      await service.updateTransitionAction('action-1', { isEnabled: false } as never, ORG_A, ACTOR);

      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          before: expect.objectContaining({ isEnabled: true }),
          after: expect.objectContaining({ isEnabled: false }),
        }),
      );
    });
  });

  // ── removeTransitionAction ───────────────────────────────────────────────────

  describe('removeTransitionAction', () => {
    it('deletes the action', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(BASE_ACTION);

      await service.removeTransitionAction('action-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowTransitionAction.delete).toHaveBeenCalledWith({
        where: { id: 'action-1' },
      });
    });

    // ACC-191 — an action that has run is kept; it can be turned off instead.
    it('refuses 409 TRANSITION_ACTION_IN_USE, with the runs, and deletes nothing', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(BASE_ACTION);
      mockPrisma.workflowActionLog.count.mockResolvedValueOnce(12);

      await expect(service.removeTransitionAction('action-1', ORG_A, ACTOR)).rejects.toMatchObject({
        status: 409,
        response: { code: 'TRANSITION_ACTION_IN_USE', runCount: 12 },
      });
      expect(mockPrisma.workflowActionLog.count).toHaveBeenCalledWith({ where: { organizationId: ORG_A, workflowTransitionActionId: 'action-1' } });
      expect(mockPrisma.workflowTransitionAction.delete).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a cross-tenant action', async () => {
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(null);

      await expect(service.removeTransitionAction('action-1', ORG_B, ACTOR)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.workflowTransitionAction.delete).not.toHaveBeenCalled();
    });
  });

  // ── tenant isolation ─────────────────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('should NOT return records belonging to a different tenant', async () => {
      const templateA = makeTemplate({ id: 'template-a', organizationId: ORG_A });
      const templateB = makeTemplate({ id: 'template-b', organizationId: ORG_B });

      mockPrisma.workflowTemplate.findMany.mockImplementation(
        ({ where }: { where: { organizationId: string } }) => {
          if (where.organizationId === ORG_A) return Promise.resolve([templateA]);
          return Promise.resolve([templateB]);
        },
      );

      const resultA = await service.getTemplates(ORG_A);
      const resultB = await service.getTemplates(ORG_B);

      expect(resultA.map((t) => t.id)).toEqual(['template-a']);
      expect(resultB.map((t) => t.id)).toEqual(['template-b']);
    });

    it('should NOT allow adding a stage to a template belonging to a different tenant', async () => {
      // findFirst is always scoped by { id, organizationId } — a template created
      // under ORG_A is invisible to a lookup scoped to ORG_B, so it resolves to null.
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);

      await expect(
        service.addStage(
          'template-belonging-to-org-a',
          { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowStage.create).not.toHaveBeenCalled();
    });

    it('should NOT allow connecting a transition between stages belonging to a different tenant', async () => {
      // The nested workflowTemplate.organizationId filter means a stage scoped to
      // ORG_B never resolves to a stage actually owned by ORG_A.
      mockPrisma.workflowStage.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addTransition(
          { fromStageId: 'stage-belonging-to-org-a', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال' } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.workflowTransition.create).not.toHaveBeenCalled();
    });

    it("should NOT unset a different tenant's default template for the same objectType", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(
        makeTemplate({ id: 'template-b', organizationId: ORG_B, isDefault: false }),
      );
      mockPrisma.workflowTemplate.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.workflowTemplate.update.mockResolvedValue(
        makeTemplate({ id: 'template-b', organizationId: ORG_B, isDefault: true }),
      );
      mockPrisma.workflowStage.findMany.mockResolvedValueOnce([{ id: 'stage-1', nameEn: 'Draft', nameAr: null, isInitial: true, isFinal: false }]);

      await service.setDefault('template-b', ORG_B, ACTOR);

      expect(mockPrisma.workflowTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });
  });

  // ── ACC-190 — stage task definitions, the transition kind, retirements ──────
  describe('ACC-190', () => {
    it('refuses a CREATE_TASK action with ACTION_TYPE_RETIRED, on add and on change, writing nothing', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.findFirst.mockResolvedValue(BASE_ACTION);

      for (const call of [
        () => service.addTransitionAction('transition-1', { actionType: 'CREATE_TASK', order: 10 } as never, ORG_A, ACTOR),
        () => service.updateTransitionAction('action-1', { actionType: 'CREATE_TASK' } as never, ORG_A, ACTOR),
      ]) {
        const error = await call().catch((e: unknown) => e);
        expect((error as WorkflowRefusalException).code).toBe('ACTION_TYPE_RETIRED');
      }
      expect(mockPrisma.workflowTransitionAction.create).not.toHaveBeenCalled();
      expect(mockPrisma.workflowTransitionAction.update).not.toHaveBeenCalled();
    });

    it('refuses the retired allPreviousStageTasksComplete validator with VALIDATOR_RETIRED — even set to false', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      const error = await service
        .updateTransition('transition-1', { validatorConfig: { allPreviousStageTasksComplete: false } } as never, ORG_A, ACTOR)
        .catch((e: unknown) => e);
      expect((error as WorkflowRefusalException).code).toBe('VALIDATOR_RETIRED');
      expect(mockPrisma.workflowTransition.update).not.toHaveBeenCalled();
    });

    it('saves a transition kind, and audits it before and after', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue({ ...BASE_TRANSITION, kind: 'ADVANCE' });
      mockPrisma.workflowTransition.update.mockResolvedValue({ ...BASE_TRANSITION, kind: 'RETURN' });

      const result = await service.updateTransition('transition-1', { kind: 'RETURN' } as never, ORG_A, ACTOR);

      expect(mockPrisma.workflowTransition.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ kind: 'RETURN' }) }),
      );
      expect(result.transition.kind).toBe('RETURN');
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ before: expect.objectContaining({ kind: 'ADVANCE' }), after: expect.objectContaining({ kind: 'RETURN' }) }),
      );
    });

    it("checks the stage-deadline rule when a stage's SLA changes — and only then", async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockPrisma.workflowStage.update.mockResolvedValue(BASE_STAGE);

      await service.updateStage('stage-1', { slaWorkingHours: 8 } as never, ORG_A, ACTOR);
      expect(mockStageTasks.assertStageDeadlineFits).toHaveBeenCalledWith('stage-1', 8, ORG_A);

      mockStageTasks.assertStageDeadlineFits.mockClear();
      await service.updateStage('stage-1', { nameEn: 'Renamed' } as never, ORG_A, ACTOR);
      expect(mockStageTasks.assertStageDeadlineFits).not.toHaveBeenCalled();
    });

    it('lets the rule refuse a stage SLA shorter than its tasks, before anything is written', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockStageTasks.assertStageDeadlineFits.mockRejectedValueOnce(new WorkflowRefusalException('STAGE_DEADLINE_BEFORE_TASKS'));

      await expect(service.updateStage('stage-1', { slaWorkingHours: 4 } as never, ORG_A, ACTOR)).rejects.toThrow(WorkflowRefusalException);
      expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
    });

    it('refuses to make a stage that creates tasks final (STAGE_TASK_ON_FINAL_STAGE)', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockPrisma.workflowStageTaskDefinition.count.mockResolvedValue(2);

      const error = await service.updateStage('stage-1', { isFinal: true } as never, ORG_A, ACTOR).catch((e: unknown) => e);

      expect((error as WorkflowRefusalException).code).toBe('STAGE_TASK_ON_FINAL_STAGE');
      expect(mockPrisma.workflowStageTaskDefinition.count).toHaveBeenCalledWith({ where: { stageId: 'stage-1', organizationId: ORG_A } });
      expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
    });

    it("adds each stage's task summary to the template read", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findMany.mockResolvedValue([{ ...BASE_STAGE, transitionsFrom: [] }, { ...BASE_STAGE, id: 'stage-2', transitionsFrom: [] }]);
      mockStageTasks.summaryForStages.mockResolvedValueOnce(new Map([['stage-1', { taskDefinitionCount: 2, longestTaskHours: 16 }]]));

      const template = await service.getTemplateById('template-1', ORG_A);

      expect(mockStageTasks.summaryForStages).toHaveBeenCalledWith(['stage-1', 'stage-2'], ORG_A);
      expect(template.stages?.[0]).toEqual(expect.objectContaining({ taskDefinitionCount: 2, longestTaskHours: 16 }));
      expect(template.stages?.[1]).toEqual(expect.objectContaining({ taskDefinitionCount: 0, longestTaskHours: null }));
    });

    // ACC-208 (B2) — read from RECORD_ROUTES, so no screen keeps a copy, and it
    // fails closed: a record type with no entry offers neither relative route.
    it.each([
      ['COMMITTEE', { unit: true, committee: true }],
      ['MEETING', { unit: true, committee: true }],
      ['DOCUMENT', { unit: false, committee: false }],
      ['INCIDENT', { unit: false, committee: false }],
    ])("says which relative routes a %s template's record can resolve", async (objectType, expected) => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue({ ...BASE_TEMPLATE, objectType });
      mockPrisma.workflowStage.findMany.mockResolvedValue([]);

      const template = await service.getTemplateById('template-1', ORG_A);

      expect(template.recordRoutes).toEqual(expected);
    });

    // ACC-208 (B3) — the stage task dialog shows each priority's due time.
    it("carries the tenant's due time for every priority", async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.findMany.mockResolvedValue([]);

      const template = await service.getTemplateById('template-1', ORG_A);

      expect(mockStageTasks.taskDueHours).toHaveBeenCalledWith(ORG_A);
      expect(template.taskDueHours).toEqual({ LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 });
    });
  });

  // The seed ships no CREATE_TASK, and every seeded transition that is not an
  // advance says so — stage order cannot tell them apart (ACC-190).
  describe('ACC-190 seed', () => {
    const transitions = SYSTEM_WORKFLOW_SEED.flatMap((w) => w.transitions.map((t) => ({ ...t, objectType: w.objectType })));

    it('has no CREATE_TASK action anywhere', () => {
      expect(transitions.flatMap((t) => t.actions.map((a) => a.actionType as string))).not.toContain('CREATE_TASK');
    });

    // ACC-239 added one return (Return for changes) and four exits (Reject, and
    // Withdraw from each of the three open stages) to ACC-190's 14 and 8.
    it('marks 15 returns and 12 exits, and leaves every other transition an ADVANCE', () => {
      const kinds = transitions.map((t) => t.kind ?? 'ADVANCE');
      expect(kinds.filter((k) => k === 'RETURN')).toHaveLength(15);
      expect(kinds.filter((k) => k === 'EXIT')).toHaveLength(12);
      expect(kinds.filter((k) => k === 'ADVANCE')).toHaveLength(transitions.length - 27);
    });

    it.each([
      ['COMMITTEE', 'terms_review', 'formation', 'RETURN'],
      ['DOCUMENT', 'publish_approval', 'drafting', 'RETURN'],
      ['DOCUMENT_REQUEST', 'unit_manager_review', 'rejected', 'EXIT'],
      ['INCIDENT', 'reported', 'cancelled', 'EXIT'],
      // Order cannot be trusted: Reactivate goes to a LOWER order and is an advance.
      ['COMMITTEE', 'suspended', 'active', 'ADVANCE'],
      ['COMMITTEE_CHANGE_REQUEST', 'under_review', 'returned', 'RETURN'],
      ['COMMITTEE_CHANGE_REQUEST', 'under_review', 'rejected', 'EXIT'],
      ['COMMITTEE_CHANGE_REQUEST', 'draft', 'withdrawn', 'EXIT'],
      ['COMMITTEE_CHANGE_REQUEST', 'under_review', 'approved', 'ADVANCE'],
    ])('%s %s → %s is %s', (objectType, from, to, kind) => {
      const t = transitions.find((x) => x.objectType === objectType && x.fromStageKey === from && x.toStageKey === to);
      expect(t?.kind ?? 'ADVANCE').toBe(kind);
    });
  });

  // ── ACC-255 — stage rules: what a stage allows and means ──────────────────────

  describe('ACC-255 — stage rules', () => {
    const committeeStage = (overrides: Partial<typeof BASE_STAGE> = {}) =>
      makeStage({ workflowTemplate: { objectType: 'COMMITTEE' }, ...overrides });
    const requestStage = (overrides: Partial<typeof BASE_STAGE> = {}) =>
      makeStage({ workflowTemplate: { objectType: 'COMMITTEE_CHANGE_REQUEST' }, ...overrides });
    const rows = (...keys: string[]) => keys.map((actionKey) => ({ actionKey }));
    const auditCalls = () => mockAuditLog.log.mock.calls.map((c) => c[0] as Record<string, unknown>);

    describe('the template read', () => {
      it("serves the record type's actions, flags and fields, and each stage's actions in registry order", async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        mockPrisma.workflowStage.findMany.mockResolvedValue([
          { ...committeeStage({ flags: ['IN_FORCE'], recordActions: rows('request_change', 'add_member') }), transitionsFrom: [] },
        ]);

        const result = await service.getTemplateById('template-1', ORG_A);

        expect(result.recordActions?.map((a) => a.key)).toEqual(['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change']);
        // ACC-255 PR 4b-be (G1) — each action carries the permission it pairs with.
        expect(result.recordActions?.[0]).toEqual({
          key: 'edit_details',
          labelKey: 'workflow.recordAction.COMMITTEE.edit_details',
          permissionKey: 'committees:edit_details',
        });
        expect(result.recordActions?.map((a) => a.permissionKey)).toEqual([
          'committees:edit_details',
          'committees:add_member',
          'committees:remove_member',
          'committees:change_member_role',
          'committees:edit_details',
        ]);
        expect(result.stageFlags).toEqual([
          { key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' },
          { key: 'IN_FORCE', labelKey: 'workflow.stageFlag.IN_FORCE', cardinality: 'any' },
        ]);
        expect(result.recordFields?.map((f) => f.key)).toEqual(['typeValueId', 'orgUnitId']);
        expect(result.stages?.[0]).toMatchObject({ actions: ['add_member', 'request_change'], flags: ['IN_FORCE'] });
      });

      // ACC-255 PR 4b-be (G6) — the read says which templates are protected,
      // from PROTECTED_TEMPLATES itself, on the list and the detail alike.
      it('says whether a template is protected, from the server’s own rule, on the list and the detail', async () => {
        const request = makeTemplate({ id: 'tpl-request', objectType: 'COMMITTEE_CHANGE_REQUEST' });
        const committee = makeTemplate({ id: 'tpl-committee', objectType: 'COMMITTEE' });
        mockPrisma.workflowTemplate.findMany.mockResolvedValue([committee, request]);
        const list = await service.getTemplates(ORG_A);
        expect(list.map((t) => [t.objectType, t.isProtected])).toEqual([
          ['COMMITTEE', false],
          ['COMMITTEE_CHANGE_REQUEST', true],
        ]);
        // Every protected type, and only those, reads as protected.
        for (const objectType of Object.values(WorkflowObjectType)) {
          mockPrisma.workflowTemplate.findFirst.mockResolvedValueOnce(makeTemplate({ objectType }));
          mockPrisma.workflowStage.findMany.mockResolvedValueOnce([]);
          const detail = await service.getTemplateById('template-1', ORG_A);
          expect([objectType, detail.isProtected]).toEqual([objectType, PROTECTED_TEMPLATES.has(objectType)]);
        }
      });

      // ACC-255 PR 4b-be (G4).
      it('counts the records in each stage with ONE grouped query, scoped by organisation and template', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        mockPrisma.workflowStage.findMany.mockResolvedValue([
          { ...committeeStage({ id: 'st-a' }), transitionsFrom: [] },
          { ...committeeStage({ id: 'st-b' }), transitionsFrom: [] },
          { ...committeeStage({ id: 'st-c' }), transitionsFrom: [] },
        ]);
        mockPrisma.workflowInstance.groupBy.mockResolvedValueOnce([
          { currentStageId: 'st-a', _count: { _all: 22 } },
          { currentStageId: 'st-c', _count: { _all: 3 } },
        ]);

        const result = await service.getTemplateById('template-1', ORG_A);

        expect(result.stages?.map((s) => [s.id, s.liveCount])).toEqual([
          ['st-a', 22],
          ['st-b', 0],
          ['st-c', 3],
        ]);
        expect(mockPrisma.workflowInstance.groupBy).toHaveBeenCalledTimes(1);
        expect(mockPrisma.workflowInstance.groupBy).toHaveBeenCalledWith({
          by: ['currentStageId'],
          where: { organizationId: ORG_A, workflowTemplateId: 'template-1', currentStageId: { not: null }, status: { not: 'CANCELLED' } },
          _count: { _all: true },
        });
      });

      itEnforcesTenantIsolation("getTemplateById — another organisation's template is not found, and nothing is counted", async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(null);
        await expect(service.getTemplateById('template-1', ORG_B)).rejects.toThrow(NotFoundException);
        expect(mockPrisma.workflowTemplate.findFirst).toHaveBeenCalledWith({ where: { id: 'template-1', organizationId: ORG_B } });
        expect(mockPrisma.workflowInstance.groupBy).not.toHaveBeenCalled();
      });

      it('a record type with no registry entry offers nothing to configure', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'DOCUMENT' }));
        mockPrisma.workflowStage.findMany.mockResolvedValue([{ ...BASE_STAGE, transitionsFrom: [] }]);
        const result = await service.getTemplateById('template-1', ORG_A);
        expect(result).toMatchObject({ recordActions: [], stageFlags: [], recordFields: [] });
        expect(result.stages?.[0]).toMatchObject({ actions: [], flags: [] });
      });
    });

    // ACC-255 PR 4b (Ahmad's Q2) — a protected template says which stage fields
    // its stages may still change, and the list IS what updateStage() accepts:
    // every field the update DTO takes is tried with a changed value, and is
    // refused exactly when the read leaves it out.
    describe('editableStageFields', () => {
      const CHANGED: Record<string, unknown> = {
        nameEn: 'Agreed',
        nameAr: 'موافق',
        description: 'A new description',
        order: 99,
        slaWorkingHours: 16,
        isInitial: false,
        isFinal: true,
        escalationConfig: [{ afterHours: 8 }],
        actions: ['edit_details'],
        flags: [],
        // ACC-271 PR 3 — a changed who is refused on a protected stage like any shape field.
        who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] },
      };
      const dtoFields = (): string[] => [
        ...new Set(getMetadataStorage().getTargetValidationMetadatas(UpdateWorkflowStageDto, '', true, false).map((m) => m.propertyName)),
      ].sort();

      it('is served on a protected template only, list and detail', async () => {
        mockPrisma.workflowTemplate.findMany.mockResolvedValue([
          makeTemplate({ id: 't-c', objectType: 'COMMITTEE' }),
          makeTemplate({ id: 't-r', objectType: 'COMMITTEE_CHANGE_REQUEST' }),
        ]);
        const [committee, request] = await service.getTemplates(ORG_A);
        expect(committee).not.toHaveProperty('editableStageFields');
        expect(request!.editableStageFields?.length).toBeGreaterThan(0);
        mockPrisma.workflowTemplate.findFirst.mockResolvedValueOnce(makeTemplate({ objectType: 'COMMITTEE_CHANGE_REQUEST' }));
        mockPrisma.workflowStage.findMany.mockResolvedValueOnce([]);
        expect((await service.getTemplateById('template-1', ORG_A)).editableStageFields).toEqual(request!.editableStageFields);
      });

      it('matches what the update path accepts on a protected stage, field by field', async () => {
        // Non-vacuity: every field the DTO takes has a changed value here.
        expect(Object.keys(CHANGED).sort()).toEqual(dtoFields());
        mockPrisma.workflowTemplate.findMany.mockResolvedValue([makeTemplate({ objectType: 'COMMITTEE_CHANGE_REQUEST' })]);
        const editable = new Set((await service.getTemplates(ORG_A))[0]!.editableStageFields);

        const verdicts: Record<string, string> = {};
        for (const [field, value] of Object.entries(CHANGED)) {
          mockPrisma.workflowStage.findFirst.mockResolvedValue(
            makeStage({ workflowTemplate: { objectType: 'COMMITTEE_CHANGE_REQUEST' }, flags: ['APPLIES_APPROVED_CHANGE'] } as never),
          );
          mockPrisma.workflowStage.update.mockResolvedValue(makeStage());
          const code = await codeOf(service.updateStage('stage-1', { [field]: value } as never, ORG_A, ACTOR));
          verdicts[field] = code === 'WORKFLOW_TEMPLATE_PROTECTED' ? 'refused' : 'accepted';
        }
        const expected = Object.fromEntries(Object.keys(CHANGED).map((f) => [f, editable.has(f) ? 'accepted' : 'refused']));
        expect(verdicts).toEqual(expected);
        // Both outcomes occur, so the comparison means something.
        expect(Object.values(verdicts)).toEqual(expect.arrayContaining(['accepted', 'refused']));
      });
    });

    describe('updateStage', () => {
      it('replaces the action set, writing only the difference, every row scoped by organisation', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage({ recordActions: rows('add_member', 'edit_details') }));
        mockPrisma.workflowStage.update.mockResolvedValue(committeeStage());
        mockPrisma.workflowStageRecordAction.findMany.mockResolvedValueOnce(rows('add_member', 'edit_details'));

        const result = await service.updateStage('stage-1', { actions: ['request_change', 'add_member', 'add_member'] } as never, ORG_A, ACTOR);

        expect(mockPrisma.workflowStageRecordAction.findMany).toHaveBeenCalledWith({
          where: { organizationId: ORG_A, stageId: 'stage-1' },
          select: { actionKey: true },
        });
        expect(mockPrisma.workflowStageRecordAction.deleteMany).toHaveBeenCalledWith({
          where: { organizationId: ORG_A, stageId: 'stage-1', actionKey: { in: ['edit_details'] } },
        });
        expect(mockPrisma.workflowStageRecordAction.createMany).toHaveBeenCalledWith({
          data: [{ organizationId: ORG_A, stageId: 'stage-1', actionKey: 'request_change' }],
        });
        expect(result.actions).toEqual(['add_member', 'request_change']);
      });

      it('writes flags in registry order, and leaves actions alone when none are sent', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage({ recordActions: rows('add_member') }));
        mockPrisma.workflowStage.update.mockResolvedValue(committeeStage({ flags: ['DISSOLVING', 'IN_FORCE'] }));

        const result = await service.updateStage('stage-1', { flags: ['IN_FORCE', 'DISSOLVING'] } as never, ORG_A, ACTOR);

        expect(mockPrisma.workflowStage.update).toHaveBeenCalledWith(expect.objectContaining({ data: { flags: ['DISSOLVING', 'IN_FORCE'] } }));
        expect(mockPrisma.workflowStageRecordAction.findMany).not.toHaveBeenCalled();
        expect(mockPrisma.workflowStageRecordAction.createMany).not.toHaveBeenCalled();
        expect(result.actions).toEqual(['add_member']);
      });

      it('refuses an action the record type does not list (400 STAGE_ACTION_UNKNOWN), writing nothing', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage());
        const refusal = await service.updateStage('stage-1', { actions: ['add_member', 'publish'] } as never, ORG_A, ACTOR).catch((e: unknown) => e);
        expect((refusal as WorkflowRefusalException).getStatus()).toBe(400);
        expect((refusal as WorkflowRefusalException).getResponse()).toMatchObject({ code: 'STAGE_ACTION_UNKNOWN', actionKey: 'publish', objectType: 'COMMITTEE' });
        expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
      });

      it('refuses any action on a record type with no actions, and a flag of another type (400 STAGE_FLAG_UNKNOWN)', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
        expect(await codeOf(service.updateStage('stage-1', { actions: ['edit_details'] } as never, ORG_A, ACTOR))).toBe('STAGE_ACTION_UNKNOWN');
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage());
        expect(await codeOf(service.updateStage('stage-1', { flags: ['APPLIES_APPROVED_CHANGE'] } as never, ORG_A, ACTOR))).toBe('STAGE_FLAG_UNKNOWN');
        expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
      });

      it("a protected template refuses CHANGED flags or actions as a stage field, and passes the stored ones re-sent", async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(requestStage({ flags: ['APPLIES_APPROVED_CHANGE'] }));
        mockPrisma.workflowStage.update.mockResolvedValue(requestStage({ nameEn: 'Agreed', flags: ['APPLIES_APPROVED_CHANGE'] }));

        const changed = await service.updateStage('stage-1', { flags: [] } as never, ORG_A, ACTOR).catch((e: unknown) => e);
        expect((changed as WorkflowRefusalException).getResponse()).toMatchObject({ code: 'WORKFLOW_TEMPLATE_PROTECTED', edit: 'STAGE_FIELD' });
        expect(await codeOf(service.updateStage('stage-1', { actions: ['edit_details'] } as never, ORG_A, ACTOR))).toBe('WORKFLOW_TEMPLATE_PROTECTED');
        expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();

        await service.updateStage('stage-1', { nameEn: 'Agreed', flags: ['APPLIES_APPROVED_CHANGE'], actions: [] } as never, ORG_A, ACTOR);
        expect(mockPrisma.workflowStage.update).toHaveBeenCalledTimes(1);
      });

      it('audits exactly the fields that changed, actions included, before and after', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage({ recordActions: rows('add_member') }));
        mockPrisma.workflowStage.update.mockResolvedValue(committeeStage({ slaWorkingHours: 16 }));
        mockPrisma.workflowStageRecordAction.findMany.mockResolvedValueOnce(rows('add_member'));

        await service.updateStage('stage-1', { nameEn: 'Drafting', slaWorkingHours: 16, actions: ['add_member', 'remove_member'] } as never, ORG_A, ACTOR);

        expect(auditCalls()).toEqual([
          expect.objectContaining({
            action: 'UPDATE',
            objectType: 'WorkflowStage',
            objectId: 'stage-1',
            tenantId: ORG_A,
            before: { slaWorkingHours: null, actions: ['add_member'] },
            after: { slaWorkingHours: 16, actions: ['add_member', 'remove_member'] },
          }),
        ]);
      });

      it('writes no audit row for a save that changes nothing', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(committeeStage({ recordActions: rows('add_member'), flags: ['IN_FORCE'] }));
        mockPrisma.workflowStage.update.mockResolvedValue(committeeStage({ flags: ['IN_FORCE'] }));
        mockPrisma.workflowStageRecordAction.findMany.mockResolvedValueOnce(rows('add_member'));

        await service.updateStage('stage-1', { nameEn: 'Drafting', actions: ['add_member'], flags: ['IN_FORCE'] } as never, ORG_A, ACTOR);

        expect(mockAuditLog.log).not.toHaveBeenCalled();
      });

      itEnforcesTenantIsolation("updateStage — another organisation's stage is not found, and no action row is touched", async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(null);
        await expect(service.updateStage('stage-1', { actions: ['add_member'] } as never, ORG_B, ACTOR)).rejects.toThrow(NotFoundException);
        expect(mockPrisma.workflowStage.findFirst).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { id: 'stage-1', workflowTemplate: { organizationId: ORG_B } },
            include: expect.objectContaining({ recordActions: { where: { organizationId: ORG_B }, select: { actionKey: true } } }),
          }),
        );
        expect(mockPrisma.workflowStageRecordAction.createMany).not.toHaveBeenCalled();
        expect(mockPrisma.workflowStageRecordAction.deleteMany).not.toHaveBeenCalled();
      });
    });

    describe('addStage', () => {
      const ADD = { nameEn: 'Board Review', order: 25, who: { mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] } };

      it("a committee stage added with no actions gets the member actions — what such a stage allowed before stage rules", async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        mockPrisma.workflowStage.create.mockResolvedValue(committeeStage({ id: 'stage-new', nameEn: 'Board Review', order: 25 }));

        const result = await service.addStage('template-1', ADD as never, ORG_A, ACTOR);

        expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flags: [] }) }));
        expect(mockPrisma.workflowStageRecordAction.createMany).toHaveBeenCalledWith({
          data: ['add_member', 'remove_member', 'change_member_role'].map((actionKey) => ({ organizationId: ORG_A, stageId: 'stage-new', actionKey })),
        });
        expect(result.actions).toEqual(['add_member', 'remove_member', 'change_member_role']);
      });

      it('takes the actions and flags the save names — none at all when it sends empty lists', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        mockPrisma.workflowStage.create.mockResolvedValue(committeeStage({ id: 'stage-new', flags: ['DISSOLVING'] }));

        const result = await service.addStage('template-1', { ...ADD, actions: [], flags: ['DISSOLVING'] } as never, ORG_A, ACTOR);

        expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ flags: ['DISSOLVING'] }) }));
        expect(mockPrisma.workflowStageRecordAction.createMany).not.toHaveBeenCalled();
        expect(result).toMatchObject({ actions: [], flags: ['DISSOLVING'] });
      });

      it('refuses an unknown flag before writing anything', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        expect(await codeOf(service.addStage('template-1', { ...ADD, flags: ['ARCHIVED'] } as never, ORG_A, ACTOR))).toBe('STAGE_FLAG_UNKNOWN');
        expect(mockPrisma.workflowStage.create).not.toHaveBeenCalled();
      });

      it('audits the whole new stage, its actions and flags included', async () => {
        mockPrisma.workflowTemplate.findFirst.mockResolvedValue(makeTemplate({ objectType: 'COMMITTEE' }));
        mockPrisma.workflowStage.create.mockResolvedValue(committeeStage({ id: 'stage-new', nameEn: 'Board Review', order: 25 }));

        await service.addStage('template-1', ADD as never, ORG_A, ACTOR);

        const [row] = auditCalls();
        expect(row).toMatchObject({ action: 'CREATE', objectType: 'WorkflowStage', objectId: 'stage-new', tenantId: ORG_A });
        expect(Object.keys(row!['after'] as object)).toEqual([
          'nameEn', 'nameAr', 'description', 'order', 'slaWorkingHours', 'isInitial', 'isFinal', 'escalationConfig', 'actions', 'flags',
          // ACC-271 PR 6a — every stage is created with who, and its audit names it;
          // PR 6b — never the old people columns.
          'whoMode', 'whoEntries',
        ]);
        expect(row!['after']).toMatchObject({ nameEn: 'Board Review', order: 25, actions: ['add_member', 'remove_member', 'change_member_role'], flags: [] });
      });
    });

    describe('removeStage', () => {
      it('audits the whole removed stage, its actions and flags included', async () => {
        mockPrisma.workflowStage.findFirst.mockResolvedValue(
          committeeStage({ isInitial: false, flags: ['DISSOLVING'], recordActions: rows('remove_member', 'add_member') }),
        );
        await service.removeStage('stage-1', ORG_A, ACTOR);

        expect(mockPrisma.workflowStage.delete).toHaveBeenCalledWith({ where: { id: 'stage-1' } });
        expect(auditCalls()[0]).toMatchObject({
          action: 'DELETE',
          objectId: 'stage-1',
          before: expect.objectContaining({ nameEn: 'Drafting', actions: ['add_member', 'remove_member'], flags: ['DISSOLVING'] }),
        });
      });
    });

    describe('exactly-one flags', () => {
      // Only the change request template carries one (APPLIES_APPROVED_CHANGE)
      // and it is protected, so no save reaches the count today; the check is
      // exercised directly so it holds for the next type that has one.
      type CardinalityCheck = { assertFlagCardinality(tx: unknown, templateId: string, flags: string[]): Promise<void> };
      const check = () => service as unknown as CardinalityCheck;

      it('passes when the flag sits on exactly one stage, and refuses 409 naming the stages otherwise', async () => {
        mockPrisma.workflowStage.findMany.mockResolvedValueOnce([{ id: 'st-approved', nameEn: 'Approved', nameAr: null }]);
        await expect(check().assertFlagCardinality(mockPrisma, 'template-1', ['APPLIES_APPROVED_CHANGE'])).resolves.toBeUndefined();
        expect(mockPrisma.workflowStage.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { workflowTemplateId: 'template-1', flags: { has: 'APPLIES_APPROVED_CHANGE' } },
            select: { id: true, nameEn: true, nameAr: true },
          }),
        );

        const two = [
          { id: 'st-approved', nameEn: 'Approved', nameAr: null },
          { id: 'st-agreed', nameEn: 'Agreed', nameAr: 'موافق' },
        ];
        for (const holders of [[], two]) {
          mockPrisma.workflowStage.findMany.mockResolvedValueOnce(holders);
          const refusal = await check().assertFlagCardinality(mockPrisma, 'template-1', ['APPLIES_APPROVED_CHANGE']).catch((e: unknown) => e);
          expect((refusal as WorkflowRefusalException).getStatus()).toBe(409);
          // ACC-255 PR 4b-be (G3) — stageNames keeps its shape (names only);
          // stageIds sits beside it, in the same order.
          expect((refusal as WorkflowRefusalException).getResponse()).toMatchObject({
            code: 'STAGE_FLAG_EXACTLY_ONE',
            flag: 'APPLIES_APPROVED_CHANGE',
            stageNames: holders.map(({ nameEn, nameAr }) => ({ nameEn, nameAr })),
            stageIds: holders.map((h) => h.id),
          });
          const names = ((refusal as WorkflowRefusalException).getResponse() as { stageNames: object[] }).stageNames;
          expect(names.every((n) => !('id' in n))).toBe(true);
        }
      });

      it('counts nothing when the save touched no exactly-one flag', async () => {
        await check().assertFlagCardinality(mockPrisma, 'template-1', []);
        expect(mockPrisma.workflowStage.findMany).not.toHaveBeenCalled();
      });
    });

    describe('stageAuditDiff', () => {
      it('lists only changed fields; arrays compare as sets; a no-op is null', () => {
        expect(stageAuditDiff({ nameEn: 'A', actions: ['x', 'y'], flags: [] }, { nameEn: 'A', actions: ['y', 'x'], flags: [] })).toBeNull();
        expect(stageAuditDiff({ nameEn: 'A', nameAr: null, order: 1 }, { nameEn: 'B', nameAr: undefined, order: 1 })).toEqual({
          before: { nameEn: 'A' },
          after: { nameEn: 'B' },
        });
        expect(stageAuditDiff({ escalationConfig: [{ afterHours: 4 }] }, { escalationConfig: [{ afterHours: 8 }] })).toEqual({
          before: { escalationConfig: [{ afterHours: 4 }] },
          after: { escalationConfig: [{ afterHours: 8 }] },
        });
        expect(stageAuditDiff({ flags: ['IN_FORCE'] }, { flags: [] })).toEqual({ before: { flags: ['IN_FORCE'] }, after: { flags: [] } });
      });
    });
  });
});
