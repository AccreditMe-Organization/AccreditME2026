import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { AuditLogService } from '../../common/services/audit-log.service';
import { stageDeadlineConflicts } from '../workflow/stage-deadline-rule';
import { WorkflowRefusalException } from '../workflow/workflow-refusal';
import {
  DEFAULT_TASK_SLA_NOTICES,
  DEFAULT_TASK_SLA_SETTINGS,
  taskSlaFromSettings,
  taskSlaNoticesFromSettings,
  warningFitsLimit,
} from './task-sla-settings';
import { readWorkingHoursPerDay } from '../working-calendar/working-time';
import {
  TASK_SLA_HISTORY_DEFAULT_TAKE,
  TASK_SLA_HISTORY_MAX_TAKE,
  UpdateTaskSlaEscalationDto,
  UpdateTaskSlaLimitsDto,
  UpdateTaskSlaNoticesDto,
} from './dto/update-task-sla-sections.dto';
import {
  ITaskSlaChange,
  ITaskSlaHistoryPage,
  ITaskSlaNotices,
  ITaskSlaPolicy,
  ITaskSlaSettings,
  ITaskSlaTier,
  TaskSlaChangeKind,
  TaskSlaWarnBeforeDue,
} from './interfaces/tenant.interface';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
type Priority = (typeof PRIORITIES)[number];
type TierField = keyof ITaskSlaTier;
type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

const LIMIT_FIELDS: TierField[] = ['dueAfterHours'];
const ESCALATION_FIELDS: TierField[] = ['managerEscalationAfterHours', 'headEscalationAfterHours'];
const ALL_FIELDS: TierField[] = [...LIMIT_FIELDS, ...ESCALATION_FIELDS];

/** The audit row every task SLA write since ACC-313 is recorded under. */
export const TASK_SLA_AUDIT_OBJECT_TYPE = 'TaskSlaPolicy';

/**
 * CC-332 — every task SLA audit row written since escalation counts working
 * hours (ACC-313 PR 4) says so: `metadata.escalationHoursUnit = 'WORKING'`.
 * The history returns it, and the screen reads it before falling back to the
 * row's shape; a row without it was saved before PR 4, in clock hours.
 */
export const WORKING_HOURS_STAMP = { escalationHoursUnit: 'WORKING' } as const;

/** Each write's `metadata.event`, and the section the history calls it. */
const EVENT_KIND: Record<string, TaskSlaChangeKind> = {
  task_sla_limits_updated: 'limits',
  task_sla_escalation_updated: 'escalation',
  task_sla_updated: 'all',
  task_sla_notices_updated: 'notices',
  task_sla_reset: 'reset',
};

/** The warnings a save sends, per priority; a priority left out keeps its stored warning. */
type SentWarnings = Partial<Record<Priority, TaskSlaWarnBeforeDue>>;

/** What an audit row records per priority: the section's hours, and a warning when one was sent. */
type AuditSection = Record<Priority, Record<string, number | string>>;

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

/** What the policy stores: the tiers and the notices (the policy read adds the working day). */
type StoredPolicy = Omit<ITaskSlaPolicy, 'workingHoursPerDay'>;

/** The stored tiers, each priority completed from the defaults. */
function storedTiers(settings: Prisma.JsonValue): ITaskSlaSettings {
  const stored = taskSlaFromSettings(settings);
  const out = {} as ITaskSlaSettings;
  for (const p of PRIORITIES) out[p] = { ...DEFAULT_TASK_SLA_SETTINGS[p], ...stored[p] };
  return out;
}

function sameNotices(a: ITaskSlaNotices, b: ITaskSlaNotices): boolean {
  return a.notifyOnDueChange === b.notifyOnDueChange && PRIORITIES.every((p) => a.warnBeforeDue[p] === b.warnBeforeDue[p]);
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
    // ACC-313 PR 4 — each priority's warning before due rides on this save.
    const warnings: SentWarnings = {};
    for (const p of PRIORITIES) {
      const warning = dto[p].warnBeforeDue;
      if (warning !== undefined) warnings[p] = warning;
    }
    return this.save(organizationId, actorId, 'task_sla_escalation_updated', ESCALATION_FIELDS, dto, null, warnings);
  }

  /** The whole policy the page reads: the tiers and the notices. */
  async policy(organizationId: string): Promise<ITaskSlaPolicy> {
    const [org, workingHoursPerDay] = await Promise.all([
      this.prisma.organization.findFirst({ where: { id: organizationId }, select: { settings: true } }),
      readWorkingHoursPerDay(this.prisma, organizationId),
    ]);
    if (!org) throw new NotFoundException('Tenant not found');
    return { tiers: storedTiers(org.settings), notices: taskSlaNoticesFromSettings(org.settings), workingHoursPerDay };
  }

  /**
   * The due-date switch. Only `settings.taskSlaNotices` is written, under the
   * same row lock, and the audit row holds the switch alone, before and after.
   * The stored reminders are kept as they are.
   */
  async saveNotices(organizationId: string, dto: UpdateTaskSlaNoticesDto, actorId: string): Promise<ITaskSlaNotices> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const current = taskSlaNoticesFromSettings(await this.lockSettings(tx, organizationId));
      if (current.notifyOnDueChange === dto.notifyOnDueChange) return { before: current, notices: current, changed: false };
      const next: ITaskSlaNotices = { ...current, notifyOnDueChange: dto.notifyOnDueChange };
      await tx.$executeRaw`
        UPDATE "Organization"
        SET settings = jsonb_set(
              CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
              '{taskSlaNotices}',
              ${JSON.stringify(next)}::jsonb
            ),
            "updatedAt" = NOW()
        WHERE id = ${organizationId}`;
      return { before: current, notices: next, changed: true };
    });

    if (outcome.changed) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: organizationId,
        actorId,
        tenantId: organizationId,
        before: { notifyOnDueChange: outcome.before.notifyOnDueChange },
        after: { notifyOnDueChange: outcome.notices.notifyOnDueChange },
        metadata: { event: 'task_sla_notices_updated', ...WORKING_HOURS_STAMP },
      });
    }
    return outcome.notices;
  }

  /**
   * Reset: every value goes back to what a new organisation gets, the tiers
   * and the notices together, in one locked transaction. It applies to tasks
   * created afterwards only: no open task is read or written, because each
   * keeps the limit it was created with (ACC-174).
   *
   * Refused, with nothing written, when the default limits would make a stage
   * end before a task defined on it is due: the same check, and the same
   * refusal, as saving the limits (Q8).
   */
  async reset(organizationId: string, actorId: string): Promise<ITaskSlaPolicy> {
    const conflicts = await stageDeadlineConflicts(
      this.prisma,
      organizationId,
      (p) => DEFAULT_TASK_SLA_SETTINGS[p].dueAfterHours,
    );
    if (conflicts.length > 0) {
      throw new WorkflowRefusalException('TASK_SLA_EXCEEDS_STAGE_DEADLINES', { stages: conflicts });
    }

    const defaults: StoredPolicy = { tiers: DEFAULT_TASK_SLA_SETTINGS, notices: DEFAULT_TASK_SLA_NOTICES };
    const outcome = await this.prisma.$transaction(async (tx) => {
      const settings = await this.lockSettings(tx, organizationId);
      const before: StoredPolicy = { tiers: storedTiers(settings), notices: taskSlaNoticesFromSettings(settings) };
      const unchanged =
        sameSection(pick(before.tiers, ALL_FIELDS), pick(defaults.tiers, ALL_FIELDS), ALL_FIELDS) &&
        sameNotices(before.notices, defaults.notices);
      if (unchanged) return { before, changed: false };
      await tx.$executeRaw`
        UPDATE "Organization"
        SET settings = jsonb_set(
              jsonb_set(
                CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
                '{taskSla}',
                ${JSON.stringify(defaults.tiers)}::jsonb
              ),
              '{taskSlaNotices}',
              ${JSON.stringify(defaults.notices)}::jsonb
            ),
            "updatedAt" = NOW()
        WHERE id = ${organizationId}`;
      return { before, changed: true };
    });

    if (outcome.changed) {
      await this.auditLog.log({
        action: 'UPDATE',
        objectType: TASK_SLA_AUDIT_OBJECT_TYPE,
        objectId: organizationId,
        actorId,
        tenantId: organizationId,
        before: outcome.before as unknown as Record<string, unknown>,
        after: defaults as unknown as Record<string, unknown>,
        metadata: { event: 'task_sla_reset', ...WORKING_HOURS_STAMP },
      });
    }
    return { ...defaults, workingHoursPerDay: await readWorkingHoursPerDay(this.prisma, organizationId) };
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
    const meta = row.metadata as { event?: unknown; escalationHoursUnit?: unknown } | null;
    const event = meta?.event;
    const legacy = row.objectType !== TASK_SLA_AUDIT_OBJECT_TYPE;
    return {
      id: row.id,
      changedAt: row.createdAt,
      actorName: row.actor?.name ?? null,
      kind: legacy ? 'legacy' : (typeof event === 'string' && EVENT_KIND[event]) || 'all',
      before: legacy ? null : row.before,
      after: legacy ? null : row.after,
      escalationHoursUnit: meta?.escalationHoursUnit === 'WORKING' ? 'WORKING' : null,
    };
  }

  private async save(
    organizationId: string,
    actorId: string,
    event: string,
    fields: TierField[],
    values: Record<Priority, SectionTier>,
    dueHours: ((priority: Priority) => number) | null,
    warnings: SentWarnings = {},
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
    // ACC-313 PR 4 — "1 working day" is the calendar's working day. Read
    // before the lock, like the stage check: it is not the policy's row.
    const hoursPerDay = await readWorkingHoursPerDay(this.prisma, organizationId);
    const savesLimits = fields.includes('dueAfterHours');

    const outcome = await this.prisma.$transaction(async (tx) => {
      const settings = await this.lockSettings(tx, organizationId);
      const current = storedTiers(settings);
      const notices = taskSlaNoticesFromSettings(settings);
      const next = {} as ITaskSlaSettings;
      for (const p of PRIORITIES) {
        next[p] = { ...current[p] };
        for (const f of fields) next[p][f] = values[p][f] as number;
      }

      // ACC-313 (Q2) — a warning must be shorter than its priority's limit,
      // checked from the side being saved, under the lock, before any write.
      for (const p of PRIORITIES) {
        const sent = warnings[p];
        if (sent !== undefined && !warningFitsLimit(sent, next[p].dueAfterHours, hoursPerDay)) {
          throw new WorkflowRefusalException('TASK_SLA_WARNING_NOT_BEFORE_DUE', {
            priority: p,
            warning: sent,
            limitHours: next[p].dueAfterHours,
          });
        }
        if (savesLimits && !warningFitsLimit(notices.warnBeforeDue[p], next[p].dueAfterHours, hoursPerDay)) {
          throw new WorkflowRefusalException('TASK_SLA_LIMIT_NOT_AFTER_WARNING', {
            priority: p,
            warning: notices.warnBeforeDue[p],
            limitHours: next[p].dueAfterHours,
          });
        }
      }

      const before: AuditSection = pick(current, fields);
      const after: AuditSection = pick(next, fields);
      const nextWarnings = { ...notices.warnBeforeDue };
      for (const p of PRIORITIES) {
        const sent = warnings[p];
        if (sent === undefined) continue;
        before[p] = { ...before[p], warnBeforeDue: notices.warnBeforeDue[p] };
        after[p] = { ...after[p], warnBeforeDue: sent };
        nextWarnings[p] = sent;
      }
      const tiersChanged = !sameSection(pick(current, fields), pick(next, fields), fields);
      const warningsChanged = PRIORITIES.some((p) => nextWarnings[p] !== notices.warnBeforeDue[p]);
      if (!tiersChanged && !warningsChanged) return { tiers: current, before, after, changed: false };

      // Only the keys that changed are written, each with jsonb_set: a
      // settings value that is not an object (SQL NULL or JSON null) is
      // treated as an empty one.
      if (tiersChanged) {
        await tx.$executeRaw`
          UPDATE "Organization"
          SET settings = jsonb_set(
                CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
                '{taskSla}',
                ${JSON.stringify(next)}::jsonb
              ),
              "updatedAt" = NOW()
          WHERE id = ${organizationId}`;
      }
      if (warningsChanged) {
        await tx.$executeRaw`
          UPDATE "Organization"
          SET settings = jsonb_set(
                CASE WHEN jsonb_typeof(settings) = 'object' THEN settings ELSE '{}'::jsonb END,
                '{taskSlaNotices}',
                ${JSON.stringify({ ...notices, warnBeforeDue: nextWarnings })}::jsonb
              ),
              "updatedAt" = NOW()
          WHERE id = ${organizationId}`;
      }
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
        metadata: { event, ...WORKING_HOURS_STAMP },
      });
    }
    return outcome.tiers;
  }

  /** The Organization row's settings, read FOR UPDATE: every write here starts with it. */
  private async lockSettings(tx: Tx, organizationId: string): Promise<Prisma.JsonValue> {
    const found = await tx.$queryRaw<{ settings: Prisma.JsonValue }[]>`
      SELECT settings FROM "Organization" WHERE id = ${organizationId} FOR UPDATE`;
    const row = found[0];
    if (!row) throw new NotFoundException('Tenant not found');
    return row.settings;
  }
}
