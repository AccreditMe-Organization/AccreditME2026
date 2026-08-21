import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { IWorkflowInstance, IWorkflowApproval } from './interfaces/workflow-instance.interface';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const TENANT_ID = 'tenant-test';
const ACTOR_ID = 'actor-test';

const MOCK_INSTANCE: IWorkflowInstance = {
  id: 'instance-1',
  organizationId: TENANT_ID,
  workflowTemplateId: 'template-1',
  objectType: 'DOCUMENT',
  objectId: 'object-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-1',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
  unassignedTaskWarnings: [],
};

const MOCK_APPROVAL: IWorkflowApproval = {
  id: 'approval-1',
  workflowInstanceStageId: 'instance-stage-1',
  approverId: ACTOR_ID,
  decision: 'APPROVED',
  comment: null,
  decidedAt: new Date('2026-01-01'),
  createdAt: new Date('2026-01-01'),
  delegationReason: null,
  delegationContextId: null,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WorkflowController', () => {
  let controller: WorkflowController;
  let service: {
    getInstanceById: jest.Mock;
    getInstancesByObject: jest.Mock;
    triggerTransition: jest.Mock;
    submitApproval: jest.Mock;
    cancelInstance: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      getInstanceById: jest.fn().mockResolvedValue(MOCK_INSTANCE),
      getInstancesByObject: jest.fn().mockResolvedValue([MOCK_INSTANCE]),
      triggerTransition: jest.fn().mockResolvedValue(MOCK_INSTANCE),
      submitApproval: jest.fn().mockResolvedValue(MOCK_APPROVAL),
      cancelInstance: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkflowController],
      providers: [{ provide: WorkflowService, useValue: service }],
    })
      .overrideGuard(TenantGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(WorkflowController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('getInstanceById', () => {
    it('delegates to workflowService.getInstanceById', async () => {
      const result = await controller.getInstanceById('instance-1', TENANT_ID);
      expect(service.getInstanceById).toHaveBeenCalledWith('instance-1', TENANT_ID);
      expect(result).toEqual(MOCK_INSTANCE);
    });
  });

  describe('getInstancesByObject', () => {
    it('delegates to workflowService.getInstancesByObject with query params', async () => {
      const result = await controller.getInstancesByObject('DOCUMENT', 'object-1', TENANT_ID);
      expect(service.getInstancesByObject).toHaveBeenCalledWith('DOCUMENT', 'object-1', TENANT_ID);
      expect(result).toEqual([MOCK_INSTANCE]);
    });
  });

  describe('triggerTransition', () => {
    it('delegates to workflowService.triggerTransition with userPermissions from the request', async () => {
      const dto = { transitionId: 'transition-1' } as never;
      const userPermissions = ['documents:submit'];

      const result = await controller.triggerTransition(
        'instance-1',
        dto,
        TENANT_ID,
        ACTOR_ID,
        userPermissions,
      );

      expect(service.triggerTransition).toHaveBeenCalledWith(
        'instance-1',
        dto,
        TENANT_ID,
        ACTOR_ID,
        userPermissions,
      );
      expect(result).toEqual(MOCK_INSTANCE);
    });
  });

  describe('submitApproval', () => {
    it('delegates to workflowService.submitApproval', async () => {
      const dto = { decision: 'APPROVED' } as never;
      const result = await controller.submitApproval('instance-stage-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.submitApproval).toHaveBeenCalledWith('instance-stage-1', dto, TENANT_ID, ACTOR_ID);
      expect(result).toEqual(MOCK_APPROVAL);
    });
  });

  describe('cancelInstance', () => {
    it('delegates to workflowService.cancelInstance with the mandatory reason', async () => {
      const dto = { reason: 'Duplicate request' };
      await controller.cancelInstance('instance-1', dto, TENANT_ID, ACTOR_ID);
      expect(service.cancelInstance).toHaveBeenCalledWith(
        'instance-1',
        TENANT_ID,
        ACTOR_ID,
        'Duplicate request',
      );
    });
  });
});
