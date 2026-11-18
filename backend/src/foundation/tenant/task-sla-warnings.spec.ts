import { TaskSlaPolicyService, TASK_SLA_AUDIT_OBJECT_TYPE } from './task-sla-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { DEFAULT_TASK_SLA_SETTINGS } from './task-sla-settings';
import type { TaskSlaWarnBeforeDue } from './interfaces/tenant.interface';

// ACC-313 PR 4 — each priority's warning before due, saved with escalation,
// and the rule that it is shorter than that priority's limit (Q2), refused
// from both sides with nothing written.

const TIER = { managerEscalationAfterHours: 8, headEscalationAfterHours: 16 };
const escalation = (warnings: Partial<Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', TaskSlaWarnBeforeDue>> = {}) => ({
  LOW: { ...TIER, ...(warnings.LOW ? { warnBeforeDue: warnings.LOW } : {}) },
  MEDIUM: { ...TIER, ...(warnings.MEDIUM ? { warnBeforeDue: warnings.MEDIUM } : {}) },
  HIGH: { ...TIER, ...(warnings.HIGH ? { warnBeforeDue: warnings.HIGH } : {}) },
  CRITICAL: { ...TIER, ...(warnings.CRITICAL ? { warnBeforeDue: warnings.CRITICAL } : {}) },
});
const LIMITS = { LOW: { dueAfterHours: 80 }, MEDIUM: { dueAfterHours: 40 }, HIGH: { dueAfterHours: 16 }, CRITICAL: { dueAfterHours: 4 } };
const OFF = { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'OFF', CRITICAL: 'OFF' };

function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?').replace(/\s+/g, ' '), values };
}

describe('TaskSlaPolicyService — warnings before due (ACC-313 PR 4)', () => {
  let service: TaskSlaPolicyService;
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    organization: { findFirst: jest.Mock };
    workflowStageTaskDefinition: { findMany: jest.Mock };
    workingCalendar: { findUnique: jest.Mock };
  };
  let auditLog: { log: jest.Mock };

  const stored = (settings: unknown) => tx.$queryRaw.mockResolvedValue([{ settings }]);
  const writes = () => tx.$executeRaw.mock.calls.map((c) => sqlOf(c as unknown[]));

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
    prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      organization: { findFirst: jest.fn() },
      workflowStageTaskDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      workingCalendar: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    auditLog = { log: jest.fn().mockResolvedValue(undefined) };
    service = new TaskSlaPolicyService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);
  });

  describe('saving warnings with escalation', () => {
    it('writes the warnings to settings.taskSlaNotices only, keeping the due-date switch', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { warnBeforeDue: OFF, notifyOnDueChange: false } });

      await service.saveEscalation('org-a', escalation({ HIGH: 'H2', CRITICAL: 'H1' }), 'user-1');

      const notices = writes().find((w) => w.text.includes("'{taskSlaNotices}'"));
      expect(notices).toBeDefined();
      expect(JSON.parse(notices!.values[0] as string)).toEqual({
        warnBeforeDue: { LOW: 'OFF', MEDIUM: 'OFF', HIGH: 'H2', CRITICAL: 'H1' },
        notifyOnDueChange: false,
      });
      expect(notices!.values[1]).toBe('org-a');
    });

    it('records each sent warning before and after, beside the escalation hours, as task_sla_escalation_updated', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

      await service.saveEscalation('org-a', escalation({ HIGH: 'H2' }), 'user-1');

      const row = auditLog.log.mock.calls[0][0] as { before: Record<string, object>; after: Record<string, object>; metadata: unknown; objectType: string };
      expect(row.objectType).toBe(TASK_SLA_AUDIT_OBJECT_TYPE);
      expect(row.metadata).toEqual({ event: 'task_sla_escalation_updated', escalationHoursUnit: 'WORKING' });
      expect(row.before['HIGH']).toEqual({ managerEscalationAfterHours: 8, headEscalationAfterHours: 16, warnBeforeDue: 'OFF' });
      expect(row.after['HIGH']).toEqual({ managerEscalationAfterHours: 8, headEscalationAfterHours: 16, warnBeforeDue: 'H2' });
      expect(row.after['LOW']).toEqual({ managerEscalationAfterHours: 8, headEscalationAfterHours: 16 });
    });

    it('a warnings-only change writes the notices and not the tiers', async () => {
      const tiers = { ...DEFAULT_TASK_SLA_SETTINGS };
      for (const p of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) tiers[p] = { ...tiers[p], ...TIER };
      stored({ taskSla: tiers });

      await service.saveEscalation('org-a', escalation({ LOW: 'WORKING_DAY' }), 'user-1');

      expect(writes().map((w) => w.text.includes("'{taskSla}'"))).toEqual([false]);
      expect(auditLog.log).toHaveBeenCalledTimes(1);
    });

    it('a body with no warnings keeps the stored ones untouched', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { warnBeforeDue: { ...OFF, HIGH: 'H2' }, notifyOnDueChange: true } });

      await service.saveEscalation('org-a', escalation(), 'user-1');

      expect(writes().every((w) => !w.text.includes("'{taskSlaNotices}'"))).toBe(true);
    });

    it('sending the stored warnings and hours again writes nothing and logs nothing', async () => {
      const tiers = { ...DEFAULT_TASK_SLA_SETTINGS };
      for (const p of ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const) tiers[p] = { ...tiers[p], ...TIER };
      stored({ taskSla: tiers, taskSlaNotices: { warnBeforeDue: { ...OFF, HIGH: 'H2' }, notifyOnDueChange: true } });

      await service.saveEscalation('org-a', escalation({ HIGH: 'H2' }), 'user-1');

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });
  });

  describe('the rule, from both sides', () => {
    it('refuses a warning at or past its priority’s saved limit: TASK_SLA_WARNING_NOT_BEFORE_DUE, nothing written', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS }); // Critical's limit is 4

      const error = await service.saveEscalation('org-a', escalation({ CRITICAL: 'H4' }), 'user-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WorkflowRefusalException);
      expect((error as WorkflowRefusalException).getStatus()).toBe(400);
      expect((error as WorkflowRefusalException).getResponse()).toEqual(
        expect.objectContaining({ code: 'TASK_SLA_WARNING_NOT_BEFORE_DUE', priority: 'CRITICAL', warning: 'H4', limitHours: 4 }),
      );
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('refuses a limit at or under its priority’s saved warning: TASK_SLA_LIMIT_NOT_AFTER_WARNING, nothing written', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { warnBeforeDue: { ...OFF, CRITICAL: 'H2' }, notifyOnDueChange: true } });

      const error = await service
        .saveLimits('org-a', { ...LIMITS, CRITICAL: { dueAfterHours: 2 } }, 'user-1')
        .catch((e: unknown) => e);

      expect((error as WorkflowRefusalException).getStatus()).toBe(400);
      expect((error as WorkflowRefusalException).getResponse()).toEqual(
        expect.objectContaining({ code: 'TASK_SLA_LIMIT_NOT_AFTER_WARNING', priority: 'CRITICAL', warning: 'H2', limitHours: 2 }),
      );
      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('a limit just longer than the warning is saved', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS, taskSlaNotices: { warnBeforeDue: { ...OFF, CRITICAL: 'H2' }, notifyOnDueChange: true } });

      await service.saveLimits('org-a', { ...LIMITS, CRITICAL: { dueAfterHours: 3 } }, 'user-1');

      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('1 working day is the calendar’s working day: it fits a 16-hour limit on 8 hours, not on 16', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS }); // High's limit is 16
      await service.saveEscalation('org-a', escalation({ HIGH: 'WORKING_DAY' }), 'user-1');
      expect(tx.$executeRaw).toHaveBeenCalled();

      tx.$executeRaw.mockClear();
      prisma.workingCalendar.findUnique.mockResolvedValue({ workingHoursStart: '00:00', workingHoursEnd: '16:00' });
      const error = await service.saveEscalation('org-a', escalation({ HIGH: 'WORKING_DAY' }), 'user-1').catch((e: unknown) => e);
      expect((error as WorkflowRefusalException).getResponse()).toEqual(
        expect.objectContaining({ code: 'TASK_SLA_WARNING_NOT_BEFORE_DUE', priority: 'HIGH', warning: 'WORKING_DAY', limitHours: 16 }),
      );
      expect(tx.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('the policy read', () => {
    it('answers the calendar’s working day: 8.5 for 07:00–15:30, 8 with no calendar', async () => {
      prisma.organization.findFirst.mockResolvedValue({ settings: {} });
      prisma.workingCalendar.findUnique.mockResolvedValueOnce({ workingHoursStart: '07:00', workingHoursEnd: '15:30' });

      expect((await service.policy('org-a')).workingHoursPerDay).toBe(8.5);
      expect((await service.policy('org-a')).workingHoursPerDay).toBe(8);
    });

    itEnforcesTenantIsolation('the task SLA policy read takes the working day of its own organisation', async () => {
      prisma.organization.findFirst.mockResolvedValue({ settings: {} });

      await service.policy('org-a');

      expect(prisma.workingCalendar.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-a' } }),
      );
    });
  });

  itEnforcesTenantIsolation('a warnings save locks and writes the session organisation only', async () => {
    stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

    await service.saveEscalation('org-a', escalation({ HIGH: 'H2' }), 'user-1');

    expect(sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]).values).toEqual(['org-a']);
    for (const w of writes()) expect(w.values[w.values.length - 1]).toBe('org-a');
    expect(prisma.workingCalendar.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org-a' } }));
  });
});
