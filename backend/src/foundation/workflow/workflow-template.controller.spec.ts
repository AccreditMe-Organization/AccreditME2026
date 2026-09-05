import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowTemplateController } from './workflow-template.controller';
import { WorkflowTemplateService } from './workflow-template.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IWorkflowTemplate } from './interfaces/workflow-template.interface';
import { IWorkflowStage } from './interfaces/workflow-stage.interface';
import { IWorkflowTransition, IWorkflowTransitionAction } from './interfaces/workflow-transition.interface';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test';
const ACTOR_ID = 'actor-test';

const MOCK_TEMPLATE: IWorkflowTemplate = {
  id: 'template-1',
  organizationId: TENANT_ID,
  nameEn: 'Document Lifecycle',
  nameAr: 'دورة حياة الوثيقة',
  objectType: 'DOCUMENT',
  isDefault: true,
  isActive: true,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const MOCK_STAGE: IWorkflowStage = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Drafting',
  nameAr: 'مسودة',
  description: null,
  order: 10,
  slaWorkingHours: null,
  isInitial: true,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'SELF',
  assigneeUserId: null,
  assigneeRoleId: null,
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
};

const MOCK_TRANSITION: IWorkflowTransition = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Submit',
  labelAr: 'إرسال',
  requiredPermission: null,
  triggerCondition: 'ANY_AUTHENTICATED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,
};

const MOCK_ACTION: IWorkflowTransitionAction = {
  id: 'action-1',
  workflowTransitionId: 'transition-1',
  actionType: 'CREATE_TASK',
  order: 10,
  isEnabled: true,
  configJson: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowTemplateController', () => {
  let controller: WorkflowTemplateController;
  let service: {
    getTemplates: jest.Mock;
    getTemplateById: jest.Mock;
    createTemplate: jest.Mock;
    updateTemplate: jest.Mock;
    setDefault: jest.Mock;
    deactivateTemplate: jest.Mock;
    addStage: jest.Mock;
    updateStage: jest.Mock;
    removeStage: jest.Mock;
    addTransition: jest.Mock;
    updateTransition: jest.Mock;
    removeTransition: jest.Mock;
    addTransitionAction: jest.Mock;
    updateTransitionAction: jest.Mock;
    removeTransitionAction: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getTemplates: jest.fn().mockResolvedValue([MOCK_TEMPLATE]),
      getTemplateById: jest.fn().mockResolvedValue(MOCK_TEMPLATE),
      createTemplate: jest.fn().mockResolvedValue(MOCK_TEMPLATE),
      updateTemplate: jest.fn().mockResolvedValue(MOCK_TEMPLATE),
      setDefault: jest.fn().mockResolvedValue(undefined),
      deactivateTemplate: jest.fn().mockResolvedValue(undefined),
      addStage: jest.fn().mockResolvedValue(MOCK_STAGE),
      updateStage: jest.fn().mockResolvedValue(MOCK_STAGE),
      removeStage: jest.fn().mockResolvedValue(undefined),
      addTransition: jest.fn().mockResolvedValue(MOCK_TRANSITION),
      updateTransition: jest.fn().mockResolvedValue(MOCK_TRANSITION),
      removeTransition: jest.fn().mockResolvedValue(undefined),
      addTransitionAction: jest.fn().mockResolvedValue(MOCK_ACTION),
      updateTransitionAction: jest.fn().mockResolvedValue(MOCK_ACTION),
      removeTransitionAction: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowTemplateController],
      providers: [{ provide: WorkflowTemplateService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkflowTemplateController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getTemplates', () => {
    it('delegates to workflowTemplateService.getTemplates with tenantId', async () => {
      const result = await controller.getTemplates(TENANT_ID);
      expect(service.getTemplates).toHaveBeenCalledWith(TENANT_ID);
      expect(result).toHaveLength(1);
    });
  });

  describe('createTemplate', () => {
    it('delegates to workflowTemplateService.createTemplate', async () => {
      const dto = { nameEn: 'X', nameAr: 'س', objectType: 'DOCUMENT' } as never;
      const result = await controller.createTemplate(dto, TENANT_ID, ACTOR_ID);
      expect(service.createTemplate).toHaveBeenCalledWith(dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_TEMPLATE);
    });
  });

  describe('addTransition', () => {
    it('delegates to workflowTemplateService.addTransition', async () => {
      const dto = { fromStageId: 'stage-1', toStageId: 'stage-2' } as never;
      const result = await controller.addTransition(dto, TENANT_ID, ACTOR_ID);
      expect(service.addTransition).toHaveBeenCalledWith(dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_TRANSITION);
    });
  });

  describe('updateTransition', () => {
    it('delegates to workflowTemplateService.updateTransition', async () => {
      const dto = { labelEn: 'Renamed' } as never;
      const result = await controller.updateTransition('transition-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.updateTransition).toHaveBeenCalledWith('transition-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_TRANSITION);
    });
  });

  describe('removeTransition', () => {
    it('delegates to workflowTemplateService.removeTransition', async () => {
      await controller.removeTransition('transition-1', TENANT_ID, ACTOR_ID);
      expect(service.removeTransition).toHaveBeenCalledWith('transition-1', TENANT_ID, ACTOR_ID);
    });
  });

  describe('addTransitionAction', () => {
    it('delegates to workflowTemplateService.addTransitionAction', async () => {
      const dto = { actionType: 'CREATE_TASK', order: 10 } as never;
      const result = await controller.addTransitionAction('transition-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.addTransitionAction).toHaveBeenCalledWith('transition-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_ACTION);
    });
  });

  describe('updateTransitionAction', () => {
    it('delegates to workflowTemplateService.updateTransitionAction', async () => {
      const dto = { isEnabled: false } as never;
      const result = await controller.updateTransitionAction('action-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.updateTransitionAction).toHaveBeenCalledWith('action-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_ACTION);
    });
  });

  describe('removeTransitionAction', () => {
    it('delegates to workflowTemplateService.removeTransitionAction', async () => {
      await controller.removeTransitionAction('action-1', TENANT_ID, ACTOR_ID);
      expect(service.removeTransitionAction).toHaveBeenCalledWith('action-1', TENANT_ID, ACTOR_ID);
    });
  });

  describe('updateStage', () => {
    it('delegates to workflowTemplateService.updateStage', async () => {
      const dto = { nameEn: 'Renamed' } as never;
      const result = await controller.updateStage('stage-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.updateStage).toHaveBeenCalledWith('stage-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_STAGE);
    });
  });

  describe('removeStage', () => {
    it('delegates to workflowTemplateService.removeStage', async () => {
      await controller.removeStage('stage-1', TENANT_ID, ACTOR_ID);
      expect(service.removeStage).toHaveBeenCalledWith('stage-1', TENANT_ID, ACTOR_ID);
    });
  });

  describe('getTemplateById', () => {
    it('delegates to workflowTemplateService.getTemplateById', async () => {
      const result = await controller.getTemplateById('template-1', TENANT_ID);
      expect(service.getTemplateById).toHaveBeenCalledWith('template-1', TENANT_ID);
      expect(result).toEqual(MOCK_TEMPLATE);
    });
  });

  describe('updateTemplate', () => {
    it('delegates to workflowTemplateService.updateTemplate', async () => {
      const dto = { nameEn: 'Renamed' } as never;
      const result = await controller.updateTemplate('template-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.updateTemplate).toHaveBeenCalledWith('template-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_TEMPLATE);
    });
  });

  describe('setDefault', () => {
    it('delegates to workflowTemplateService.setDefault', async () => {
      await controller.setDefault('template-1', TENANT_ID, ACTOR_ID);
      expect(service.setDefault).toHaveBeenCalledWith('template-1', TENANT_ID, ACTOR_ID);
    });
  });

  describe('deactivateTemplate', () => {
    it('delegates to workflowTemplateService.deactivateTemplate', async () => {
      await controller.deactivateTemplate('template-1', TENANT_ID, ACTOR_ID);
      expect(service.deactivateTemplate).toHaveBeenCalledWith('template-1', TENANT_ID, ACTOR_ID);
    });
  });

  describe('addStage', () => {
    it('delegates to workflowTemplateService.addStage', async () => {
      const dto = { nameEn: 'Drafting', nameAr: 'مسودة', order: 10 } as never;
      const result = await controller.addStage('template-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.addStage).toHaveBeenCalledWith('template-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_STAGE);
    });
  });
});
