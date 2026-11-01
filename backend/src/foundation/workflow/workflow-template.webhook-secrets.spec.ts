import { WorkflowTemplateService } from './workflow-template.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AuditLogService } from '../../common/services/audit-log.service';
import type { StageTaskDefinitionService } from './stage-task-definition.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

/**
 * ACC-277 — a webhook action's header values (and any signing secret) are
 * write-once: no read returns them, a save that leaves one empty keeps it, and no
 * audit row records one. The marker below is synthetic test data, never a real
 * secret; every assertion checks it appears NOWHERE in what leaves the service.
 */

const ORG = 'org-a';
const ACTOR = 'actor-1';
const MARKER = 'acc277-test-marker-value';

const STORED = {
  webhookUrl: 'https://hooks.example.test/in',
  timeoutMs: 5000,
  headers: { Authorization: `Bearer ${MARKER}-auth`, 'X-Api-Key': `${MARKER}-key`, 'X-Empty': '' },
  signingSecret: `${MARKER}-signing`,
};

const ACTION = {
  id: 'action-1',
  workflowTransitionId: 't-1',
  actionType: 'WEBHOOK',
  order: 10,
  isEnabled: true,
  configJson: STORED,
  workflowTransition: { fromStage: { workflowTemplate: { objectType: 'COMMITTEE' } } },
};

function build() {
  const prisma = {
    workflowTemplate: { findFirst: jest.fn() },
    workflowStage: { findMany: jest.fn().mockResolvedValue([]) },
    workflowTransition: { findFirst: jest.fn() },
    workflowTransitionAction: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    workflowInstance: { groupBy: jest.fn().mockResolvedValue([]) },
    workflowStageAssignee: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    orgPosition: { findMany: jest.fn().mockResolvedValue([]) },
    orgUnit: { findMany: jest.fn().mockResolvedValue([]) },
    committee: { findMany: jest.fn().mockResolvedValue([]) },
    lookupValue: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const audit = { log: jest.fn() };
  const stageTasks = { summaryForStages: jest.fn().mockResolvedValue(new Map()), taskDueHours: jest.fn().mockResolvedValue({}) };
  const service = new WorkflowTemplateService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
    stageTasks as unknown as StageTaskDefinitionService,
  );
  return { prisma, audit, service };
}

const leaks = (value: unknown): boolean => JSON.stringify(value ?? null).includes(MARKER);

describe('WorkflowTemplateService — webhook header values are never sent back (ACC-277)', () => {
  describe('every read path', () => {
    it('the template read returns each header by name with an empty value and valueSet, and no signing secret', async () => {
      const { prisma, service } = build();
      prisma.workflowTemplate.findFirst.mockResolvedValue({
        id: 'template-1', organizationId: ORG, nameEn: 'T', nameAr: null, objectType: 'COMMITTEE', isDefault: true, isActive: true,
      });
      prisma.workflowStage.findMany.mockResolvedValue([
        {
          id: 'stage-1', workflowTemplateId: 'template-1', key: null, nameEn: 'S', nameAr: null, description: null, order: 1,
          slaWorkingHours: null, isInitial: true, isFinal: false, approvalMode: 'SINGLE', parallelThreshold: null, committeeId: null,
          assigneeStrategy: 'ROLE', assigneeUserId: null, assigneeRoleId: null, assigneeCommitteeRoleValueId: null,
          assigneePositionId: null, assigneeOrgUnitId: null, escalationConfig: null, flags: [], whoMode: null,
          recordActions: [], assignees: [],
          transitionsFrom: [
            {
              id: 't-1', fromStageId: 'stage-1', toStageId: 'stage-1', labelEn: 'Go', labelAr: null, requiredPermission: null,
              triggerCondition: 'ROLE_BASED', triggerUserId: null, triggerRoleId: null, validatorConfig: null,
              isApprovalPath: false, kind: 'ADVANCE', mover: 'PERSON', actions: [ACTION],
            },
          ],
        },
      ]);

      const read = await service.getTemplateById('template-1', ORG);
      expect(leaks(read)).toBe(false);
      const config = read.stages![0]!.transitions![0]!.actions![0]!.configJson!;
      expect(config).toEqual({
        webhookUrl: STORED.webhookUrl,
        timeoutMs: 5000,
        headers: { Authorization: '', 'X-Api-Key': '', 'X-Empty': '' },
        headersValueSet: { Authorization: true, 'X-Api-Key': true, 'X-Empty': false },
        signingSecret: '',
        signingSecretSet: true,
      });
    });

    it("adding an action returns it masked", async () => {
      const { prisma, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue({ id: 't-1', fromStage: { workflowTemplate: { objectType: 'COMMITTEE' } } });
      prisma.workflowTransitionAction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      const added = await service.addTransitionAction('t-1', { actionType: 'WEBHOOK', order: 10, configJson: STORED } as never, ORG, ACTOR);
      expect(leaks(added)).toBe(false);
      expect(added.configJson).toEqual(expect.objectContaining({ headers: { Authorization: '', 'X-Api-Key': '', 'X-Empty': '' } }));
    });

    it('updating an action returns it masked', async () => {
      const { prisma, service } = build();
      prisma.workflowTransitionAction.findFirst.mockResolvedValue(ACTION);
      prisma.workflowTransitionAction.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      const updated = await service.updateTransitionAction('action-1', { order: 20 } as never, ORG, ACTOR);
      expect(leaks(updated)).toBe(false);
    });
  });

  describe('saving', () => {
    function saved(prisma: ReturnType<typeof build>['prisma']): Record<string, unknown> {
      return prisma.workflowTransitionAction.update.mock.calls[0][0].data.configJson as Record<string, unknown>;
    }
    function ready() {
      const ctx = build();
      ctx.prisma.workflowTransitionAction.findFirst.mockResolvedValue(ACTION);
      ctx.prisma.workflowTransitionAction.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      return ctx;
    }

    it('the masked read sent back unchanged keeps every stored value (the Actions dialog saving untouched)', async () => {
      const { prisma, service } = ready();
      // What today's dialog sends after opening the masked read: its URL and the headers it showed.
      await service.updateTransitionAction(
        'action-1',
        { configJson: { webhookUrl: STORED.webhookUrl, headers: { Authorization: '', 'X-Api-Key': '', 'X-Empty': '' } } } as never,
        ORG,
        ACTOR,
      );
      expect(saved(prisma)).toEqual({
        webhookUrl: STORED.webhookUrl,
        headers: STORED.headers,
      });
    });

    it('a non-empty value replaces the stored one; the others are kept', async () => {
      const { prisma, service } = ready();
      await service.updateTransitionAction(
        'action-1',
        { configJson: { webhookUrl: STORED.webhookUrl, headers: { Authorization: 'Bearer replaced', 'X-Api-Key': '', 'X-Empty': '' } } } as never,
        ORG,
        ACTOR,
      );
      expect((saved(prisma)['headers'] as Record<string, string>)['Authorization']).toBe('Bearer replaced');
      expect((saved(prisma)['headers'] as Record<string, string>)['X-Api-Key']).toBe(STORED.headers['X-Api-Key']);
    });

    it('a header left out is removed, and a new one is added', async () => {
      const { prisma, service } = ready();
      await service.updateTransitionAction(
        'action-1',
        { configJson: { webhookUrl: STORED.webhookUrl, headers: { Authorization: '', 'X-New': 'fresh' } } } as never,
        ORG,
        ACTOR,
      );
      expect(saved(prisma)['headers']).toEqual({ Authorization: STORED.headers.Authorization, 'X-New': 'fresh' });
    });

    it('no header list at all removes them all', async () => {
      const { prisma, service } = ready();
      await service.updateTransitionAction('action-1', { configJson: { webhookUrl: STORED.webhookUrl } } as never, ORG, ACTOR);
      expect(saved(prisma)).not.toHaveProperty('headers');
    });

    it('the signing secret: empty keeps it, a value replaces it, absent removes it', async () => {
      const keep = ready();
      await keep.service.updateTransitionAction('action-1', { configJson: { webhookUrl: 'u', signingSecret: '' } } as never, ORG, ACTOR);
      expect(saved(keep.prisma)['signingSecret']).toBe(STORED.signingSecret);
      const replace = ready();
      await replace.service.updateTransitionAction('action-1', { configJson: { webhookUrl: 'u', signingSecret: 'next' } } as never, ORG, ACTOR);
      expect(saved(replace.prisma)['signingSecret']).toBe('next');
      const remove = ready();
      await remove.service.updateTransitionAction('action-1', { configJson: { webhookUrl: 'u' } } as never, ORG, ACTOR);
      expect(saved(remove.prisma)).not.toHaveProperty('signingSecret');
    });

    it('the read-only markers a client may echo back are never stored', async () => {
      const { prisma, service } = ready();
      await service.updateTransitionAction(
        'action-1',
        { configJson: { webhookUrl: 'u', headers: { Authorization: '' }, headersValueSet: { Authorization: true }, signingSecretSet: true } } as never,
        ORG,
        ACTOR,
      );
      expect(saved(prisma)).not.toHaveProperty('headersValueSet');
      expect(saved(prisma)).not.toHaveProperty('signingSecretSet');
    });

    it('an update that sends no config leaves the stored config untouched', async () => {
      const { prisma, service } = ready();
      await service.updateTransitionAction('action-1', { isEnabled: false } as never, ORG, ACTOR);
      expect(prisma.workflowTransitionAction.update.mock.calls[0][0].data).not.toHaveProperty('configJson');
    });

    it('adding an action stores the values sent, and an empty one as empty', async () => {
      const { prisma, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue({ id: 't-1', fromStage: { workflowTemplate: { objectType: 'COMMITTEE' } } });
      prisma.workflowTransitionAction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      await service.addTransitionAction('t-1', { actionType: 'WEBHOOK', order: 10, configJson: { webhookUrl: 'u', headers: { A: 'one', B: '' } } } as never, ORG, ACTOR);
      expect(prisma.workflowTransitionAction.create.mock.calls[0][0].data.configJson).toEqual({ webhookUrl: 'u', headers: { A: 'one', B: '' } });
    });
  });

  describe('audit', () => {
    it('creating records the header names, never a value', async () => {
      const { prisma, audit, service } = build();
      prisma.workflowTransition.findFirst.mockResolvedValue({ id: 't-1', fromStage: { workflowTemplate: { objectType: 'COMMITTEE' } } });
      prisma.workflowTransitionAction.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      await service.addTransitionAction('t-1', { actionType: 'WEBHOOK', order: 10, configJson: STORED } as never, ORG, ACTOR);
      const row = audit.log.mock.calls[0][0];
      expect(leaks(row)).toBe(false);
      expect(row.after).toEqual(expect.objectContaining({ headers: ['Authorization', 'X-Api-Key', 'X-Empty'], signingSecret: 'set' }));
    });

    it('updating records which headers changed, by name, never a value', async () => {
      const ctx = build();
      ctx.prisma.workflowTransitionAction.findFirst.mockResolvedValue(ACTION);
      ctx.prisma.workflowTransitionAction.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ ...ACTION, ...data }));
      await ctx.service.updateTransitionAction(
        'action-1',
        { configJson: { webhookUrl: STORED.webhookUrl, headers: { Authorization: `Bearer ${MARKER}-new`, 'X-Api-Key': '', 'X-Added': `${MARKER}-added` }, signingSecret: '' } } as never,
        ORG,
        ACTOR,
      );
      const row = ctx.audit.log.mock.calls[0][0];
      expect(leaks(row)).toBe(false);
      expect(row.before).toEqual(expect.objectContaining({ headers: ['Authorization', 'X-Api-Key', 'X-Empty'] }));
      expect(row.after).toEqual(
        expect.objectContaining({
          headers: ['Authorization', 'X-Api-Key', 'X-Added'],
          headersChanged: { Authorization: 'changed', 'X-Added': 'added', 'X-Empty': 'removed' },
        }),
      );
    });
  });

  itEnforcesTenantIsolation("an action of another organisation is not found, and nothing is returned or written", async () => {
    const { prisma, service } = build();
    prisma.workflowTransitionAction.findFirst.mockResolvedValue(null);
    await expect(service.updateTransitionAction('action-1', { configJson: { webhookUrl: 'u' } } as never, ORG, ACTOR)).rejects.toThrow(
      'Workflow transition action not found',
    );
    expect(prisma.workflowTransitionAction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'action-1', workflowTransition: { fromStage: { workflowTemplate: { organizationId: ORG } } } } }),
    );
    expect(prisma.workflowTransitionAction.update).not.toHaveBeenCalled();
  });
});
