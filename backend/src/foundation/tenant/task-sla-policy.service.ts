import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { stageDeadlineConflicts } from '../workflow/stage-deadline-rule';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import { DEFAULT_TASK_SLA_SETTINGS, taskSlaFromSettings } from './task-sla-settings';
import {
  TASK_SLA_HISTORY_DEFAULT_TAKE,
  TASK_SLA_HISTORY_MAX_TAKE,
  UpdateTaskSlaEscalationDto,
  UpdateTaskSlaLimitsDto,
} from './dto/update-task-sla-sections.dto';
import { UpdateTaskSlaDto } from './dto/update-task-sla.dto';
import {
  ITaskSlaChange,
  ITaskSlaHistoryPage,
  ITaskSlaSettings,
  ITaskSlaTier,
  TaskSlaChangeKind,
} from './interfaces/tenant.interface';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
type Priority = (typeof PRIORITIES)[number];
type TierField = keyof ITaskSlaTier;

const LIMIT_FIELDS: TierField[] = ['dueAfterHours'];
const ESCALATION_FIELDS: TierField[] = ['managerEscalationAfterHours', 'headEscalationAfterHours'];
const ALL_FIELDS: TierField[] = [...LIMIT_FIELDS, ...ESCALATION_FIELDS];

/** The audit row every task SLA write since ACC-313 is recorded under. */
export const TASK_SLA_AUDIT_OBJECT_TYPE = 'TaskSlaPolicy';

/** Each write's `metadata.event`, and the section the history calls it. */
const EVENT_KIND: Record<string, TaskSlaChangeKind> = {
  task_sla_limits_updated: 'limits',
  task_sla_escalation_updated: 'escalation',
  task_sla_updated: 'all',
};

/** A section's values for one priority: only the fields that section saves. */
type SectionTier = Partial<Record<TierField, number>>;
type SectionValues = Record<Priority, SectionTier>;

function pick(tiers: ITaskSlaSettings, fields: TierField[]): SectionValues {
  const out = {} as SectionValues;
  for (const p of PRIORITIES) {
    out[p] = {};
    for (const f of fields) out[p][f] = tiers[p][f];
  }
  return out;
}

function sameSection(a: SectionValues, b: SectionValues, fields: TierField[]): boolean {
  return PRIORITIES.every((p) => fields.every((f) => a[p][f] === b[p][f]));
}

/**
 * ACC-313 — every write to the task SLA policy, and its change history.
 *
 * KEY-ATOMIC AND LOCKED (ACC-215). The Organization row is read FOR UPDATE
 * inside the transaction, the section's fields are merged into the stored
 * tiers, and ONLY `settings.taskSla` is written back, with `jsonb_set`. So two
 * section saves at once cannot lose each other's fields, and this code never
 * writes a stale copy of the rest of the settings. The other settings writers
 * still spread the whole JSON and can still overwrite `taskSla`: that is
 * ACC-215's remaining work, not this file's.
 *
 * BEFORE AND AFTER ARE RECORDED. The pre-ACC-313 save logged only an event
 * name, so its history rows cannot show values (`kind: 'legacy'`). Every
 * write here logs the section's fields, before and after, for all four
 * priorities. A save that changes nothing writes nothing and logs nothing.
 *
 * The audit row is written after the commit, as everywhere else in the
 * backend: AuditLogService has no transaction form.
 */
@Injectable()
export class TaskSlaPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Time limits: each priority's `dueAfterHours`. The stage-deadline rule applies. */
  saveLimits(organizationId: string, dto: UpdateTaskSlaLimitsDto, actorId: string): Promise<ITaskSlaSettings> {
    return this.save(organizationId, actorId, 'task_sla_limits_updated', LIMIT_FIELDS, dto, (p) => dto[p].dueAfterHours);
  }

  /** Escalation: when the manager and the head are told. These hours move no due date. */
  saveEscalation(organizationId: string, dto: UpdateTaskSlaEscalationDto, actorId: string): Promise<ITaskSlaSettings> {
    return this.save(organizationId, actorId, 'task_sla_escalation_updated', ESCALATION_FIELDS, dto, null);
  }

  /** The old whole-policy PATCH, kept until the new screen ships, under the same lock. */
  replaceAll(organizationId: string, dto: UpdateTaskSlaDto, actorId: string): Promise<ITaskSlaSettings> {
    return this.save(organizationId, actorId, 'task_sla_updated', ALL_FIELDS, dto, (p) => dto[p].dueAfterHours);
  }

  /**
   * The policy's saves, newest first, paged. Rows written since ACC-313 are
   * `TaskSlaPolicy` rows; the earlier ones are the Organization's own rows
   * tagged `task_sla_updated`, which carry no values. Both are scoped by the
   * organisation AND name it as the object, in one `where`.
   */
  async history(organizationId: string, skip = 0, take = TASK_SLA_HISTORY_DEFAULT_TAKE): Promise<ITaskSlaHistoryPage> {
    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      OR: [
        { objectType: TASK_SLA_AUDIT_OBJECT_TYPE, objectId: organizationId },
        { objectType: 'Organization', objectId: organizationId, metadata: { path: ['event'], equals: 'task_sla_updated' } },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        select: {
          id: true,
          createdAt: true,
          objectType: true,
          before: true,
          after: true,
          metadata: true,
          actor: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: Math.max(0, skip),
        take: Math.min(Math.max(1, take), TASK_SLA_HISTORY_MAX_TAKE),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { rows: rows.map((row) => this.toChange(row)), total };
  }

  private toChange(row: {
    id: string;
    createdAt: Date;
    objectType: string;
    before: Prisma.JsonValue;
    after: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
    actor: { name: string } | null;
  }): ITaskSlaChange {
    const event = (row.metadata as { event?: unknown } | null)?.event;
    const legacy = row.objectType !== TASK_SLA_AUDIT_OBJECT_TYPE;
    return {
      id: row.id,
      changedAt: row.createdAt,
      actorName: row.actor?.name ?? null,
      kind: legacy ? 'legacy' : (typeof event === 'string' && EVENT_KIND[event]) || 'all',
      before: legacy ? null : row.before,
      after: legacy ? null : row.after,
    };
  }

  private async save(
    organizationId: string,
    actorId: string,
    event: string,
    fields: TierField[],
    values: Record<Priority, SectionTier>,
    dueHours: ((priority: Priority) => number) | null,
  ): Promise<ITaskSlaSettings> {
    // ACC-190 — the limits must not make a stage end before a task defined on
    // it is due. The check needs only the requested due hours, so it runs
    // before the lock is taken and keeps the transaction short.
    if (dueHours) {
      const conflicts = await stageDeadlineConflicts(this.prisma, organizationId, dueHours);
      if (conflicts.length > 0) {
        throw new WorkflowRefusalException('TASK_SLA_EXCEEDS_STAGE_DEADLINES', { stages: conflicts });
      }
    }

    const outcome = await this.prisma.$transaction(async (tx) => {
      const found = await tx.$queryRaw<{ settings: Prisma.JsonValue }[]>`
        SELECT settings FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
      const row = found[0];
      if (!row) throw new NotFoundException('Tenant not found');

      const stored = taskSlaFromSettings(row.settings);
      const current = {} as ITaskSlaSettings;
      const next = {} as ITaskSlaSettings;
      for (const p of PRIORITIES) {
        current[p] = { ...DEFAULT_TASK_SLA_SETTINGS[p], ...stored[p] };
        next[p] = { ...current[p] };
        for (const f of fields) next[p][f] = values[p][f] as number;
      }

      const before = pick(current, fields);
      const after = pick(next, fields);
      if (sameSection(before, after, fields)) return { tiers: current, before, after, changed: false };

      // Only settings.taskSla is written: a settings value that is not an
      // object (SQL NULL or JSON null) is treated as an empty one.
      await tx.$executeRaw`
        UPDATE "Organization"
        SET settings = jsonb_set(
              CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
              '{taskSla}',
              ${JSON.stringify(next)}::jsonb
            ),
            "updatedAt" = NOW()
        WHERE id = ${organizationId}`;
      return { tiers: next, before, after, changed: true };
    });

    if (outcome.changed) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: organizationId,
        actorId,
        tenantId: organizationId,
        before: outcome.before,
        after: outcome.after,
        metadata: { event },
      });
    }
    return outcome.tiers;
  }
}
