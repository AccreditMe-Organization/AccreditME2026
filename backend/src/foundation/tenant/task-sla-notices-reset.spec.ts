import { NotFoundException } from '@nestjs/common';
import { TaskSlaPolicyService, TASK_SLA_AUDIT_OBJECT_TYPE } from './task-sla-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { DEFAULT_TASK_SLA_NOTICES, DEFAULT_TASK_SLA_SETTINGS } from './task-sla-settings';

// ACC-313 PR 3 — the due-date switch, the policy read and Reset. The SQL's
// effect against a real Postgres is in task-sla-policy.db-spec.ts; these specs
// pin what is read, written, refused and audited.

const CUSTOM_SLA = {
  LOW: { dueAfterHours: 60, managerEscalationAfterHours: 40, headEscalationAfterHours: 80 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { dueAfterHours: 12, managerEscalationAfterHours: 6, headEscalationAfterHours: 12 },
  CRITICAL: { dueAfterHours: 2, managerEscalationAfterHours: 1, headEscalationAfterHours: 2 },
};

const NOTICES_OFF = {
  warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'H2', CRITICAL: 'H1' },
  notifyOnDueChange: false,
};

/** A tagged-template call: the SQL text, and the values bound into it. */
function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?').replace(/\s+/g, ' '), values };
}

describe('TaskSlaPolicyService — the notices switch and Reset (ACC-313)', () => {
  let service: TaskSlaPolicyService;
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    organization: { findFirst: jest.Mock };
    workflowStageTaskDefinition: { findMany: jest.Mock };
  };
  let auditLog: { log: jest.Mock };

  /** The settings the locked read finds; `null` = no such organisation. */
  function stored(settings: unknown | null): void {
    tx.$queryRaw.mockResolvedValue(settings === null ? [] : [{ settings }]);
  }

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
    // No `task` model: Reset must never read or write a task (ACC-174), and a
    // call to one would throw here.
    prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      organization: { findFirst: jest.fn() },
      workflowStageTaskDefinition: { findMany: jest.fn().mockResolvedValue([]) },
    };
    auditLog = { log: jest.fn().mockResolvedValue(undefined) };
    service = new TaskSlaPolicyService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);
  });

  describe('the policy read', () => {
    it('answers the tiers and the notices', async () => {
      prisma.organization.findFirst.mockResolvedValue({ settings: { taskSla: CUSTOM_SLA, taskSlaNotices: NOTICES_OFF } });

      await expect(service.policy('org-a')).resolves.toEqual({ tiers: CUSTOM_SLA, notices: NOTICES_OFF });
    });

    it('an organisation that never saved notices reads the defaults: every reminder Off, the switch on', async () => {
      prisma.organization.findFirst.mockResolvedValue({ settings: { taskSla: CUSTOM_SLA } });

      const { notices } = await service.policy('org-a');

      expect(notices).toEqual({
        warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' },
        notifyOnDueChange: true,
      });
    });

    it('a missing organisation is a 404', async () => {
      prisma.organization.findFirst.mockResolvedValue(null);
      await expect(service.policy('org-x')).rejects.toBeInstanceOf(NotFoundException);
    });

    itEnforcesTenantIsolation('the task SLA policy read names the organisation it reads', async () => {
      prisma.organization.findFirst.mockResolvedValue({ settings: {} });

      await service.policy('org-a');

      expect(prisma.organization.findFirst).toHaveBeenCalledWith({ where: { id: 'org-a' }, select: { settings: true } });
    });
  });

  describe('the due-date switch', () => {
    it('locks the row and writes ONLY settings.taskSlaNotices, keeping the stored reminders', async () => {
      stored({ taskSla: CUSTOM_SLA, taskSlaNotices: { ...NOTICES_OFF, notifyOnDueChange: true }, ai: { enabled: true } });

      const saved = await service.saveNotices('org-a', { notifyOnDueChange: false }, 'user-1');

      const read = sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]);
      expect(read.text).toContain('FROM "Organization" WHERE id = ? FOR UPDATE');
      expect(read.values).toEqual(['org-a']);
      const write = sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]);
      expect(write.text).toContain("'{taskSlaNotices}'");
      expect(write.text).not.toContain("'{taskSla}'");
      expect(JSON.parse(write.values[0] as string)).toEqual(NOTICES_OFF);
      expect(write.values[1]).toBe('org-a');
      expect(saved).toEqual(NOTICES_OFF);
    });

    it('records the switch alone, before and after, as task_sla_notices_updated, after the commit', async () => {
      stored({});

      await service.saveNotices('org-a', { notifyOnDueChange: false }, 'user-1');

      expect(auditLog.log).toHaveBeenCalledTimes(1);
      expect(auditLog.log).toHaveBeenCalledWith({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: 'org-a',
        actorId: 'user-1',
        tenantId: 'org-a',
        before: { notifyOnDueChange: true },
        after: { notifyOnDueChange: false },
        metadata: { event: 'task_sla_notices_updated' },
      });
      const committed = prisma.$transaction.mock.invocationCallOrder[0]!;
      expect(auditLog.log.mock.invocationCallOrder[0]).toBeGreaterThan(committed);
    });

    it.each([
      ['on, with nothing stored', {}, true],
      ['off, already off', { taskSlaNotices: NOTICES_OFF }, false],
    ])('turning it %s writes nothing and logs nothing', async (_case, settings, value) => {
      stored(settings);

      const saved = await service.saveNotices('org-a', { notifyOnDueChange: value }, 'user-1');

      expect(saved.notifyOnDueChange).toBe(value);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('a missing organisation is a 404, with nothing written and nothing logged', async () => {
      stored(null);
      await expect(service.saveNotices('org-x', { notifyOnDueChange: false }, 'user-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('the due-date switch locks and writes the session organisation only', async () => {
      stored({});

      await service.saveNotices('org-a', { notifyOnDueChange: false }, 'user-1');

      expect(sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]).values).toEqual(['org-a']);
      expect(sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]).values[1]).toBe('org-a');
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'org-a', objectId: 'org-a' }));
    });
  });

  describe('Reset', () => {
    it('writes the default tiers AND the default notices in one locked write, and answers them', async () => {
      stored({ taskSla: CUSTOM_SLA, taskSlaNotices: NOTICES_OFF, ai: { enabled: true } });

      const answer = await service.reset('org-a', 'user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]).text).toContain('FOR UPDATE');
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      const write = sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]);
      expect(write.text).toContain('UPDATE "Organization"');
      expect(write.text).toContain("'{taskSla}'");
      expect(write.text).toContain("'{taskSlaNotices}'");
      expect(JSON.parse(write.values[0] as string)).toEqual(DEFAULT_TASK_SLA_SETTINGS);
      expect(JSON.parse(write.values[1] as string)).toEqual(DEFAULT_TASK_SLA_NOTICES);
      expect(write.values[2]).toBe('org-a');
      expect(answer).toEqual({ tiers: DEFAULT_TASK_SLA_SETTINGS, notices: DEFAULT_TASK_SLA_NOTICES });
    });

    it('records one audit row, task_sla_reset: the whole policy before, the defaults after', async () => {
      stored({ taskSla: CUSTOM_SLA, taskSlaNotices: NOTICES_OFF });

      await service.reset('org-a', 'user-1');

      expect(auditLog.log).toHaveBeenCalledTimes(1);
      expect(auditLog.log).toHaveBeenCalledWith({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: 'org-a',
        actorId: 'user-1',
        tenantId: 'org-a',
        before: { tiers: CUSTOM_SLA, notices: NOTICES_OFF },
        after: { tiers: DEFAULT_TASK_SLA_SETTINGS, notices: DEFAULT_TASK_SLA_NOTICES },
        metadata: { event: 'task_sla_reset' },
      });
    });

    it('a policy already at the defaults writes nothing and logs nothing', async () => {
      stored({});

      await service.reset('org-a', 'user-1');

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('only the notices differing from the defaults is still a reset', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { ...DEFAULT_TASK_SLA_NOTICES, notifyOnDueChange: false } });

      await service.reset('org-a', 'user-1');

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(auditLog.log).toHaveBeenCalledTimes(1);
    });

    it('is refused with TASK_SLA_EXCEEDS_STAGE_DEADLINES when the default limits break a stage, and writes nothing', async () => {
      stored({ taskSla: CUSTOM_SLA });
      // The stage ends at 15 working hours: the stored High limit (12) fits it,
      // the default (16) does not, so the refusal proves the defaults were checked.
      prisma.workflowStageTaskDefinition.findMany.mockResolvedValue([
        {
          priority: 'HIGH',
          stage: {
            id: 'stage-terms',
            nameEn: 'Terms Review',
            nameAr: 'مراجعة الشروط',
            slaWorkingHours: DEFAULT_TASK_SLA_SETTINGS.HIGH.dueAfterHours - 1,
            workflowTemplate: { id: 'template-committee', nameEn: 'Committee lifecycle', nameAr: null },
          },
        },
      ]);

      const error = await service.reset('org-a', 'user-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WorkflowRefusalException);
      const body = (error as WorkflowRefusalException).getResponse() as { code: string; stages: unknown[] };
      expect(body.code).toBe('TASK_SLA_EXCEEDS_STAGE_DEADLINES');
      expect(body.stages).toEqual([
        expect.objectContaining({
          stageName: 'Terms Review',
          priority: 'HIGH',
          longestTaskHours: DEFAULT_TASK_SLA_SETTINGS.HIGH.dueAfterHours,
        }),
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('Reset checks, locks and writes the session organisation only', async () => {
      stored({ taskSla: CUSTOM_SLA });

      await service.reset('org-a', 'user-1');

      expect(sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]).values).toEqual(['org-a']);
      expect(sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]).values[2]).toBe('org-a');
      expect(auditLog.log).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'org-a', objectId: 'org-a' }));
    });
  });
});
