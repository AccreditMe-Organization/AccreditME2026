import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { SlaMonitorProcessor } from './sla-monitor.processor';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { NotificationService } from '../notification/notification.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { WorkflowService } from './workflow.service';

// Scoped narrowly to ACC-28 Section 2.5.1's new sweepUnassignedStages() —
// this file did not exist before ACC-28; the pre-existing SLA-breach and
// Task-overdue sweep logic (process()'s other two branches) already runs in
// production without a dedicated spec. Covering those is a separate,
// unrelated gap, not introduced or widened by this change.

const ORG_A = 'org-a-id';

const BASE_INSTANCE = {
  id: 'instance-1',
  organizationId: ORG_A,
  objectType: 'COMMITTEE',
  objectId: 'object-1',
};

const BASE_STAGE = {
  id: 'stage-1',
  nameEn: 'Chairman Review',
  committeeId: 'committee-1',
};

const makeOpenInstanceStage = (overrides: Record<string, unknown> = {}) => ({
  id: 'instance-stage-1',
  workflowInstanceId: 'instance-1',
  stageId: 'stage-1',
  exitedAt: null,
  isUnassigned: false,
  unassignedAt: null,
  workflowInstance: BASE_INSTANCE,
  stage: BASE_STAGE,
  ...overrides,
});

const BLOCKING_TRANSITION = [{ id: 't-1', labelEn: 'Approve', triggerCondition: 'ASSIGNEE_POOL' }];

const mockPrisma = {
  workflowInstanceStage: { findMany: jest.fn(), update: jest.fn() },
  task: { findMany: jest.fn() },
  userRole: { findMany: jest.fn() },
};

const mockAuditLog = { log: jest.fn() };
const mockWorkingCalendar = { getOrCreate: jest.fn(), listHolidays: jest.fn() };
const mockNotificationService = { create: jest.fn() };
const mockOrgPositionService = { validateEscalationTarget: jest.fn() };
const mockWorkflowService = {
  resolveUnassignedBlockingTransitions: jest.fn(),
  notifyTenantAdminsOfUnassignedStage: jest.fn(),
};
const mockQueue = { add: jest.fn() };

describe('SlaMonitorProcessor — sweepUnassignedStages (ACC-28 Section 2.5.1)', () => {
  let processor: SlaMonitorProcessor;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.task.findMany.mockResolvedValue([]); // no-op sweepOverdueTasks
    mockPrisma.workflowInstanceStage.update.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlaMonitorProcessor,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AuditLogService, useValue: mockAuditLog },
        { provide: WorkingCalendarService, useValue: mockWorkingCalendar },
        { provide: NotificationService, useValue: mockNotificationService },
        { provide: OrgPositionService, useValue: mockOrgPositionService },
        { provide: WorkflowService, useValue: mockWorkflowService },
        { provide: getQueueToken('sla-monitor'), useValue: mockQueue },
      ],
    }).compile();

    processor = module.get<SlaMonitorProcessor>(SlaMonitorProcessor);
  });

  const runProcess = () => processor.process({} as never);

  it('flags a previously-fine open stage and notifies Tenant Admins on a false→true transition', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    mockPrisma.workflowInstanceStage.findMany
      .mockResolvedValueOnce([]) // breachedStages (top of process())
      .mockResolvedValueOnce([stage]); // openStages (sweepUnassignedStages)
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION);

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'instance-stage-1' },
      data: { isUnassigned: true, unassignedAt: expect.any(Date) },
    });
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).toHaveBeenCalledWith(
      ORG_A,
      BASE_INSTANCE,
      BASE_STAGE,
      BLOCKING_TRANSITION,
    );
  });

  it('clears isUnassigned on a previously-flagged stage once the pool is qualifying again, without notifying', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]); // now resolvable

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).toHaveBeenCalledWith({
      where: { id: 'instance-stage-1' },
      data: { isUnassigned: false, unassignedAt: null },
    });
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  it('does not write or notify when a stage is still blocked on re-check (prevents a duplicate notification)', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: true, unassignedAt: new Date('2026-01-01') });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue(BLOCKING_TRANSITION); // still blocked

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });

  it('does not write or notify when a stage remains reachable', async () => {
    const stage = makeOpenInstanceStage({ isUnassigned: false });
    mockPrisma.workflowInstanceStage.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([stage]);
    mockWorkflowService.resolveUnassignedBlockingTransitions.mockResolvedValue([]);

    await runProcess();

    expect(mockPrisma.workflowInstanceStage.update).not.toHaveBeenCalled();
    expect(mockWorkflowService.notifyTenantAdminsOfUnassignedStage).not.toHaveBeenCalled();
  });
});
