import { NotFoundException } from '@nestjs/common';
import { TaskSlaPolicyService, TASK_SLA_AUDIT_OBJECT_TYPE } from './task-sla-policy.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';
import { DEFAULT_TASK_SLA_SETTINGS } from './task-sla-settings';

// ACC-313 — every task SLA write and the policy's change history. The SQL's
// effect (the row lock, the key-atomic write) is proved against a real
// Postgres in task-sla-policy.db-spec.ts; these specs pin what is merged,
// written, audited and read.

const CUSTOM_SLA = {
  LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
  MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { dueAfterHours: 12, managerEscalationAfterHours: 6, headEscalationAfterHours: 12 },
  CRITICAL: { dueAfterHours: 2, managerEscalationAfterHours: 1, headEscalationAfterHours: 2 },
};

const LIMITS = {
  LOW: { dueAfterHours: 60 },
  MEDIUM: { dueAfterHours: 30 },
  HIGH: { dueAfterHours: 12 },
  CRITICAL: { dueAfterHours: 2 },
};

const ESCALATION = {
  LOW: { managerEscalationAfterHours: 40, headEscalationAfterHours: 80 },
  MEDIUM: { managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
  HIGH: { managerEscalationAfterHours: 4, headEscalationAfterHours: 8 },
  CRITICAL: { managerEscalationAfterHours: 1, headEscalationAfterHours: 2 },
};

/** A tagged-template call: the SQL text, and the values bound into it. */
function sqlOf(call: unknown[]): { text: string; values: unknown[] } {
  const [strings, ...values] = call as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join('?').replace(/\s+/g, ' '), values };
}

describe('TaskSlaPolicyService (ACC-313)', () => {
  let service: TaskSlaPolicyService;
  let tx: { $queryRaw: jest.Mock; $executeRaw: jest.Mock };
  let prisma: {
    $transaction: jest.Mock;
    workflowStageTaskDefinition: { findMany: jest.Mock };
    workingCalendar: { findUnique: jest.Mock };
    auditLog: { findMany: jest.Mock; count: jest.Mock };
  };
  let auditLog: { log: jest.Mock };

  /** The settings the locked read finds; `null` = no such organisation. */
  function stored(settings: unknown | null): void {
    tx.$queryRaw.mockResolvedValue(settings === null ? [] : [{ settings }]);
  }

  /** The JSON written into settings.taskSla, parsed. */
  function written(): typeof CUSTOM_SLA {
    const { values } = sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]);
    return JSON.parse(values[0] as string) as typeof CUSTOM_SLA;
  }

  beforeEach(() => {
    tx = { $queryRaw: jest.fn(), $executeRaw: jest.fn().mockResolvedValue(1) };
    prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
      workflowStageTaskDefinition: { findMany: jest.fn().mockResolvedValue([]) },
      // ACC-313 PR 4 — no calendar row: the default working day, 8 hours.
      workingCalendar: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    };
    auditLog = { log: jest.fn().mockResolvedValue(undefined) };
    service = new TaskSlaPolicyService(prisma as unknown as PrismaService, auditLog as unknown as AuditLogService);
  });

  describe('the write', () => {
    it('locks the organisation row and writes ONLY settings.taskSla, with jsonb_set', async () => {
      stored({ taskSla: CUSTOM_SLA, ai: { enabled: true } });

      await service.saveLimits('org-a', LIMITS, 'user-1');

      const read = sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]);
      expect(read.text).toContain('FROM "Organization" WHERE id = ? FOR UPDATE');
      expect(read.values).toEqual(['org-a']);
      const write = sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]);
      expect(write.text).toContain("jsonb_set(");
      expect(write.text).toContain("'{taskSla}'");
      // A settings value that is not an object is treated as an empty one.
      expect(write.text).toContain("CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END");
      expect(write.values[1]).toBe('org-a');
    });

    it('limits: merges each dueAfterHours and keeps the escalation hours', async () => {
      stored({ taskSla: CUSTOM_SLA });

      const result = await service.saveLimits('org-a', LIMITS, 'user-1');

      const expected = {
        LOW: { ...CUSTOM_SLA.LOW, dueAfterHours: 60 },
        MEDIUM: { ...CUSTOM_SLA.MEDIUM, dueAfterHours: 30 },
        HIGH: CUSTOM_SLA.HIGH,
        CRITICAL: CUSTOM_SLA.CRITICAL,
      };
      expect(written()).toEqual(expected);
      expect(result).toEqual(expected);
    });

    it('escalation: merges the manager and head hours and keeps every limit', async () => {
      stored({ taskSla: CUSTOM_SLA });

      const result = await service.saveEscalation('org-a', ESCALATION, 'user-1');

      const expected = {
        LOW: { dueAfterHours: 80, ...ESCALATION.LOW },
        MEDIUM: CUSTOM_SLA.MEDIUM,
        HIGH: { dueAfterHours: 12, ...ESCALATION.HIGH },
        CRITICAL: CUSTOM_SLA.CRITICAL,
      };
      expect(written()).toEqual(expected);
      expect(result).toEqual(expected);
    });

    it('an organisation that never saved merges against the defaults', async () => {
      stored({});

      await service.saveEscalation('org-a', ESCALATION, 'user-1');

      expect(written().LOW).toEqual({ dueAfterHours: DEFAULT_TASK_SLA_SETTINGS.LOW.dueAfterHours, ...ESCALATION.LOW });
    });

    it('the old whole-policy save writes all three values of every priority', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

      await service.replaceAll('org-a', CUSTOM_SLA, 'user-1');

      expect(written()).toEqual(CUSTOM_SLA);
    });

    it('a missing organisation is a 404, with nothing written and nothing logged', async () => {
      stored(null);

      await expect(service.saveLimits('missing', LIMITS, 'user-1')).rejects.toThrow(NotFoundException);

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });
  });

  describe('the audit row', () => {
    it("records the section's fields before and after, for all four priorities, after the commit", async () => {
      stored({ taskSla: CUSTOM_SLA });

      await service.saveLimits('org-a', LIMITS, 'user-1');

      expect(auditLog.log).toHaveBeenCalledTimes(1);
      expect(auditLog.log).toHaveBeenCalledWith({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: 'org-a',
        actorId: 'user-1',
        tenantId: 'org-a',
        before: { LOW: { dueAfterHours: 80 }, MEDIUM: { dueAfterHours: 40 }, HIGH: { dueAfterHours: 12 }, CRITICAL: { dueAfterHours: 2 } },
        after: { LOW: { dueAfterHours: 60 }, MEDIUM: { dueAfterHours: 30 }, HIGH: { dueAfterHours: 12 }, CRITICAL: { dueAfterHours: 2 } },
        // CC-332 — every row since PR 4 says its escalation hours are working hours.
        metadata: { event: 'task_sla_limits_updated', escalationHoursUnit: 'WORKING' },
      });
    });

    it('an escalation save names its own event and only its own fields', async () => {
      stored({ taskSla: CUSTOM_SLA });

      await service.saveEscalation('org-a', ESCALATION, 'user-1');

      const entry = auditLog.log.mock.calls[0][0] as { before: Record<string, object>; metadata: object };
      expect(entry.metadata).toEqual({ event: 'task_sla_escalation_updated', escalationHoursUnit: 'WORKING' });
      expect(entry.before['LOW']).toEqual({ managerEscalationAfterHours: 48, headEscalationAfterHours: 96 });
    });

    it('the old save is recorded the same way, as task_sla_updated', async () => {
      stored({ taskSla: DEFAULT_TASK_SLA_SETTINGS });

      await service.replaceAll('org-a', CUSTOM_SLA, 'user-1');

      const entry = auditLog.log.mock.calls[0][0] as { objectType: string; after: object; metadata: object };
      expect(entry.objectType).toBe(TASK_SLA_AUDIT_OBJECT_TYPE);
      expect(entry.after).toEqual(CUSTOM_SLA);
      expect(entry.metadata).toEqual({ event: 'task_sla_updated', escalationHoursUnit: 'WORKING' });
    });

    it('a save that changes nothing writes nothing and logs nothing', async () => {
      stored({ taskSla: CUSTOM_SLA });

      const result = await service.saveEscalation('org-a', {
        LOW: { managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
        MEDIUM: { managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
        HIGH: { managerEscalationAfterHours: 6, headEscalationAfterHours: 12 },
        CRITICAL: { managerEscalationAfterHours: 1, headEscalationAfterHours: 2 },
      }, 'user-1');

      expect(tx.$executeRaw).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
      expect(result).toEqual(CUSTOM_SLA);
    });
  });

  // ACC-190 — the stage-deadline rule's third side, moved here from
  // tenant.service.spec.ts with the write: the limits must not make a stage
  // end before a task defined on it is due.
  describe('the stage-deadline rule', () => {
    const definition = (priority: string, stageHours: number) => ({
      priority,
      stage: {
        id: `stage-${priority}`,
        nameEn: 'Terms Review',
        nameAr: 'مراجعة الشروط',
        slaWorkingHours: stageHours,
        workflowTemplate: { id: 'template-committee', nameEn: 'Committee lifecycle', nameAr: null },
      },
    });

    it('refuses a limits save with TASK_SLA_EXCEEDS_STAGE_DEADLINES, naming the stage, and writes nothing', async () => {
      stored({});
      prisma.workflowStageTaskDefinition.findMany.mockResolvedValue([definition('HIGH', LIMITS.HIGH.dueAfterHours - 1)]);

      const error = await service.saveLimits('org-a', LIMITS, 'user-1').catch((e: unknown) => e);

      expect(error).toBeInstanceOf(WorkflowRefusalException);
      const body = (error as WorkflowRefusalException).getResponse() as { code: string; stages: { stageName: string; longestTaskHours: number }[] };
      expect(body.code).toBe('TASK_SLA_EXCEEDS_STAGE_DEADLINES');
      expect(body.stages).toEqual([
        expect.objectContaining({ stageName: 'Terms Review', templateName: 'Committee lifecycle', longestTaskHours: LIMITS.HIGH.dueAfterHours }),
      ]);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    // ACC-208 (B6) — the settings screen names the stage in either language,
    // links to its row, and puts the message under the priority that breaks it.
    it('gives each conflict its template id, its Arabic names and the priority behind it', async () => {
      stored({});
      prisma.workflowStageTaskDefinition.findMany.mockResolvedValue([definition('HIGH', LIMITS.HIGH.dueAfterHours - 1)]);

      const error = await service.saveLimits('org-a', LIMITS, 'user-1').catch((e: unknown) => e);

      const body = (error as WorkflowRefusalException).getResponse() as { stages: unknown[] };
      expect(body.stages).toEqual([
        {
          stageId: 'stage-HIGH',
          stageName: 'Terms Review',
          stageNameAr: 'مراجعة الشروط',
          templateName: 'Committee lifecycle',
          templateNameAr: null,
          workflowTemplateId: 'template-committee',
          stageHours: LIMITS.HIGH.dueAfterHours - 1,
          longestTaskHours: LIMITS.HIGH.dueAfterHours,
          priority: 'HIGH',
        },
      ]);
    });

    it('accepts hours that still fit every stage', async () => {
      stored({});
      prisma.workflowStageTaskDefinition.findMany.mockResolvedValue([definition('HIGH', LIMITS.HIGH.dueAfterHours)]);

      await service.saveLimits('org-a', LIMITS, 'user-1');

      expect(tx.$executeRaw).toHaveBeenCalled();
    });

    it('an escalation save does not check stages: its hours move no due date', async () => {
      stored({ taskSla: CUSTOM_SLA });

      await service.saveEscalation('org-a', ESCALATION, 'user-1');

      expect(prisma.workflowStageTaskDefinition.findMany).not.toHaveBeenCalled();
    });

    itEnforcesTenantIsolation('stage deadlines checked by a limits save', async () => {
      stored({});

      await service.saveLimits('org-a', LIMITS, 'user-1');

      // Only this tenant's definitions, and only stages that HAVE a deadline.
      expect(prisma.workflowStageTaskDefinition.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: 'org-a', stage: { slaWorkingHours: { not: null } } } }),
      );
    });
  });

  itEnforcesTenantIsolation('a task SLA save locks and writes only the requested organisation', async () => {
    stored({ taskSla: CUSTOM_SLA });

    await service.saveEscalation('org-a', ESCALATION, 'user-1');

    expect(sqlOf(tx.$queryRaw.mock.calls[0] as unknown[]).values).toEqual(['org-a']);
    expect(sqlOf(tx.$executeRaw.mock.calls[0] as unknown[]).values[1]).toBe('org-a');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  describe('the history', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 'a-1',
      createdAt: new Date('2026-11-16T09:00:00.000Z'),
      objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
      before: { LOW: { dueAfterHours: 80 } },
      after: { LOW: { dueAfterHours: 60 } },
      metadata: { event: 'task_sla_limits_updated' },
      actor: { name: 'Nora Al-Otaibi' },
      ...over,
    });

    it('names each row by its section, and a pre-ACC-313 save as legacy with no values', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        row({ id: 'a-3', metadata: { event: 'task_sla_escalation_updated' } }),
        row({ id: 'a-2' }),
        row({ id: 'a-1', metadata: { event: 'task_sla_updated' }, actor: null }),
        row({ id: 'a-0', objectType: 'Organization', before: null, after: null, metadata: { event: 'task_sla_updated' } }),
      ]);
      prisma.auditLog.count.mockResolvedValue(4);

      const page = await service.history('org-a');

      expect(page.total).toBe(4);
      expect(page.rows.map((r) => [r.id, r.kind])).toEqual([
        ['a-3', 'escalation'],
        ['a-2', 'limits'],
        ['a-1', 'all'],
        ['a-0', 'legacy'],
      ]);
      expect(page.rows[1]).toEqual({
        id: 'a-2',
        changedAt: new Date('2026-11-16T09:00:00.000Z'),
        actorName: 'Nora Al-Otaibi',
        kind: 'limits',
        before: { LOW: { dueAfterHours: 80 } },
        after: { LOW: { dueAfterHours: 60 } },
        escalationHoursUnit: null,
      });
      expect(page.rows[2]?.actorName).toBeNull();
      expect(page.rows[3]).toEqual(expect.objectContaining({ kind: 'legacy', before: null, after: null }));
    });

    // CC-332 — the stamp is read from the row's metadata: 'WORKING' when a
    // writer since PR 4 stamped it, null on an older row (and a legacy one).
    it('returns each row\'s escalation hours unit from its metadata', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        row({ id: 'new', metadata: { event: 'task_sla_escalation_updated', escalationHoursUnit: 'WORKING' } }),
        row({ id: 'old', metadata: { event: 'task_sla_escalation_updated' } }),
        row({ id: 'odd', metadata: { event: 'task_sla_escalation_updated', escalationHoursUnit: 'CLOCK' } }),
        row({ id: 'legacy', objectType: 'Organization', before: null, after: null, metadata: { event: 'task_sla_updated' } }),
      ]);
      prisma.auditLog.count.mockResolvedValue(4);

      const page = await service.history('org-a');

      expect(page.rows.map((r) => [r.id, r.escalationHoursUnit])).toEqual([
        ['new', 'WORKING'],
        ['old', null],
        ['odd', null],
        ['legacy', null],
      ]);
    });

    it('names the due-date switch and Reset, with their values', async () => {
      const policyBefore = { tiers: CUSTOM_SLA, notices: { notifyOnDueChange: false } };
      prisma.auditLog.findMany.mockResolvedValue([
        row({ id: 'a-5', metadata: { event: 'task_sla_reset' }, before: policyBefore, after: { tiers: DEFAULT_TASK_SLA_SETTINGS } }),
        row({
          id: 'a-4',
          metadata: { event: 'task_sla_notices_updated' },
          before: { notifyOnDueChange: true },
          after: { notifyOnDueChange: false },
        }),
      ]);
      prisma.auditLog.count.mockResolvedValue(2);

      const page = await service.history('org-a');

      expect(page.rows.map((r) => [r.id, r.kind])).toEqual([
        ['a-5', 'reset'],
        ['a-4', 'notices'],
      ]);
      expect(page.rows[0]?.before).toEqual(policyBefore);
      expect(page.rows[1]).toEqual(
        expect.objectContaining({ before: { notifyOnDueChange: true }, after: { notifyOnDueChange: false } }),
      );
    });

    it('is newest first, 20 a page by default, never more than 50, and counts the same rows', async () => {
      await service.history('org-a');
      await service.history('org-a', 40, 500);

      const first = prisma.auditLog.findMany.mock.calls[0][0] as { orderBy: unknown; skip: number; take: number; where: unknown };
      expect(first.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(first.skip).toBe(0);
      expect(first.take).toBe(20);
      const second = prisma.auditLog.findMany.mock.calls[1][0] as { skip: number; take: number };
      expect(second.skip).toBe(40);
      expect(second.take).toBe(50);
      expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: first.where });
    });

    itEnforcesTenantIsolation('the task SLA history reads only the organisation’s own rows', async () => {
      await service.history('org-a');

      const { where } = prisma.auditLog.findMany.mock.calls[0][0] as { where: unknown };
      expect(where).toEqual({
        organizationId: 'org-a',
        OR: [
          { objectType: TASK_SLA_AUDIT_OBJECT_TYPE, objectId: 'org-a' },
          { objectType: 'Organization', objectId: 'org-a', metadata: { path: ['event'], equals: 'task_sla_updated' } },
        ],
      });
    });
  });
});
