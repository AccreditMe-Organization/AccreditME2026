import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowTemplateService } from './workflow-template.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { SYSTEM_WORKFLOW_SEED } from './workflow.seed';

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
  nameEn: 'Drafting',
  nameAr: 'مسودة',
  description: null as string | null,
  order: 10,
  slaWorkingHours: null as number | null,
  requiredPermission: null as string | null,
  isInitial: true,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null as string | null,
  committeeId: null as string | null,
  assigneeStrategy: 'SELF',
  assigneeUserId: null as string | null,
  assigneeRoleId: null as string | null,
  escalationConfig: null as unknown,
};

const BASE_TRANSITION = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Submit for Review',
  labelAr: 'إرسال للمراجعة',
  requiredPermission: 'documents:submit',
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null as string | null,
  triggerRoleId: null as string | null,
  validatorConfig: null as unknown,
};

const BASE_ACTION = {
  id: 'action-1',
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
  },
  workflowTransitionAction: {
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
  },
  role: {
    findMany: jest.fn(),
  },
  user: {
    findFirst: jest.fn(),
  },
  committee: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
};

const mockAuditLog = { log: jest.fn() };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowTemplateService', () => {
  let service: WorkflowTemplateService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default: any assigneeUserId a test sets belongs to ORG_A, matching
    // this file's usual "happy path" org. Tests exercising the cross-tenant
    // rejection override this per-case.
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-a', organizationId: ORG_A });
    // Same default for committeeId (ACC-22, closing the ACC-17 deferred gap).
    mockPrisma.committee.findFirst.mockResolvedValue({ id: 'committee-a', organizationId: ORG_A });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowTemplateService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
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

    it('creates all 8 templates with correct stages, transitions, and actions for a fresh org', async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      expect(mockPrisma.workflowTemplate.create).toHaveBeenCalledTimes(SYSTEM_WORKFLOW_SEED.length);
      expect(mockPrisma.workflowStage.create).toHaveBeenCalledTimes(totalStages);
      expect(mockPrisma.workflowTransition.create).toHaveBeenCalledTimes(totalTransitions);
      expect(mockPrisma.workflowTransitionAction.create).toHaveBeenCalledTimes(totalActions);
      expect(mockPrisma.workflowTemplate.update).not.toHaveBeenCalled();
    });

    it("resolves assigneeRoleKey/triggerRoleKey to the tenant's actual Role.id values", async () => {
      installFakeStore();

      await service.seedDefaultWorkflows(ORG_A);

      expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assigneeRoleId: 'role-QUALITY_MANAGER' }),
        }),
      );
      expect(mockPrisma.role.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_A }) }),
      );
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

    it('throws if a referenced role key was not found for the org', async () => {
      installFakeStore();
      mockPrisma.role.findMany.mockResolvedValue([]);

      await expect(service.seedDefaultWorkflows(ORG_A)).rejects.toThrow(
        /Role key .* was not found/,
      );
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
          include: { transitionsFrom: { include: { actions: { orderBy: { order: 'asc' } } } } },
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
        { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' } as never,
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
          { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    // ACC-17 — assigneeUserId re-validated against the caller's org before
    // being written onto the stage, mirroring the re-scoping the ROLE case
    // already gets. A client-supplied user id belonging to a DIFFERENT org
    // must be rejected, not written unscoped.
    it('throws NotFoundException when assigneeUserId does not belong to this org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.addStage(
          'template-1',
          {
            nameEn: 'Drafting',
            nameAr: 'مسودة',
            order: 10,
            approvalMode: 'SINGLE',
            assigneeStrategy: 'SPECIFIC_USER',
            assigneeUserId: 'foreign-user',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-user', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowStage.create).not.toHaveBeenCalled();
    });

    it('defaults isInitial and isFinal to false when omitted', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.create.mockResolvedValue(BASE_STAGE);

      await service.addStage(
        'template-1',
        { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isInitial: false, isFinal: false }) }),
      );
    });

    // ACC-22 (closing the ACC-17 deferred gap) — committeeId re-validated
    // against the caller's org before being written onto the stage,
    // mirroring the assigneeUserId re-scoping test above. A client-supplied
    // committee id belonging to a DIFFERENT org must be rejected, not
    // written unscoped.
    it('throws NotFoundException when committeeId does not belong to this org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.addStage(
          'template-1',
          {
            nameEn: 'Active',
            nameAr: 'نشطة',
            order: 10,
            approvalMode: 'COMMITTEE',
            assigneeStrategy: 'COMMITTEE',
            committeeId: 'foreign-committee',
          } as never,
          ORG_A,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowStage.create).not.toHaveBeenCalled();
    });

    it('creates the stage when committeeId belongs to this org', async () => {
      mockPrisma.workflowTemplate.findFirst.mockResolvedValue(BASE_TEMPLATE);
      mockPrisma.workflowStage.create.mockResolvedValue(makeStage({ committeeId: 'committee-a' }));

      await service.addStage(
        'template-1',
        {
          nameEn: 'Active',
          nameAr: 'نشطة',
          order: 10,
          approvalMode: 'COMMITTEE',
          assigneeStrategy: 'COMMITTEE',
          committeeId: 'committee-a',
        } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'committee-a', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowStage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ committeeId: 'committee-a' }) }),
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

    it('throws NotFoundException when assigneeUserId does not belong to this org', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStage('stage-1', { assigneeUserId: 'foreign-user' } as never, ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-user', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
    });

    // ACC-22 (closing the ACC-17 deferred gap) — same re-validation as
    // addStage above, exercised here for updateStage.
    it('throws NotFoundException when committeeId does not belong to this org', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(BASE_STAGE);
      mockPrisma.committee.findFirst.mockResolvedValue(null);

      await expect(
        service.updateStage('stage-1', { committeeId: 'foreign-committee' } as never, ORG_A, ACTOR),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrisma.committee.findFirst).toHaveBeenCalledWith({
        where: { id: 'foreign-committee', organizationId: ORG_A },
      });
      expect(mockPrisma.workflowStage.update).not.toHaveBeenCalled();
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
    it('deletes the stage when nothing references it', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: false }));
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);

      await service.removeStage('stage-1', ORG_A, ACTOR);

      expect(mockPrisma.workflowStage.delete).toHaveBeenCalledWith({ where: { id: 'stage-1' } });
      expect(mockPrisma.workflowStage.count).not.toHaveBeenCalled();
    });

    it('throws ConflictException when a transition still references it', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: false }));
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);

      await expect(service.removeStage('stage-1', ORG_A, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.workflowStage.delete).not.toHaveBeenCalled();
    });

    it('throws ConflictException when removing the initial stage while sibling stages exist', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: true }));
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);
      mockPrisma.workflowStage.count.mockResolvedValue(1);

      await expect(service.removeStage('stage-1', ORG_A, ACTOR)).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrisma.workflowStage.delete).not.toHaveBeenCalled();
    });

    it('succeeds removing the initial stage when it is the only stage left', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValue(makeStage({ isInitial: true }));
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);
      mockPrisma.workflowStage.count.mockResolvedValue(0);

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
        { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال', triggerCondition: 'ROLE_BASED' } as never,
        ORG_A,
        ACTOR,
      );

      expect(mockPrisma.workflowTransition.create).toHaveBeenCalled();
    });

    it('throws NotFoundException if fromStage does not belong to this org', async () => {
      mockPrisma.workflowStage.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.addTransition(
          { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال', triggerCondition: 'ROLE_BASED' } as never,
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
          { fromStageId: 'stage-1', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال', triggerCondition: 'ROLE_BASED' } as never,
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
        { actionType: 'CREATE_TASK', order: 10 } as never,
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
          { actionType: 'CREATE_TASK', order: 10 } as never,
          ORG_B,
          ACTOR,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('defaults isEnabled to true when omitted', async () => {
      mockPrisma.workflowTransition.findFirst.mockResolvedValue(BASE_TRANSITION);
      mockPrisma.workflowTransitionAction.create.mockResolvedValue(BASE_ACTION);

      await service.addTransitionAction(
        'transition-1',
        { actionType: 'CREATE_TASK', order: 10 } as never,
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
          { nameEn: 'Drafting', nameAr: 'مسودة', order: 10, approvalMode: 'SINGLE', assigneeStrategy: 'SELF' } as never,
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
          { fromStageId: 'stage-belonging-to-org-a', toStageId: 'stage-2', labelEn: 'Submit', labelAr: 'إرسال', triggerCondition: 'ROLE_BASED' } as never,
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

      await service.setDefault('template-b', ORG_B, ACTOR);

      expect(mockPrisma.workflowTemplate.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: ORG_B }) }),
      );
    });
  });
});
