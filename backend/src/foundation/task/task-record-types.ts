import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { COMMITTEE_TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { RECORD_VIEW_PERMISSION } from '../../common/services/object-visibility.service';

/**
 * ACC-244 — THE RECORD TYPES THAT HAVE TASKS, and the four task keys each one
 * answers to. The one place a record type is given task permissions; every
 * task rule reads these helpers and never spells a key.
 *
 *   VIEW_ALL   every task on records of the type
 *   CREATE     New task on a record of the type
 *   MANAGE     reassign, decide requests, Unassigned, a departed creator's work
 *   VIEW_UNIT  every task on records of the type owned by the holder's unit and
 *              its sub-units
 *
 * A key counts only together with the RECORD's own view permission
 * (RECORD_VIEW_PERMISSION, the record rule's first half): rule 1, the record
 * comes first. A type missing here gives no permission-based task access at
 * all (fail closed); a relationship to one of its tasks still counts.
 *
 * `ownerUnitSql` is the record's owning unit as a SQL expression over the task
 * row `t`, for unit scope; null for a type with no owning unit (unit scope then
 * never applies to it). Its read is scoped by organisation like every other.
 */
export type TaskKeyKind = 'VIEW_ALL' | 'CREATE' | 'MANAGE' | 'VIEW_UNIT';

export interface TaskRecordType {
  keys: Readonly<Record<TaskKeyKind, string>>;
  ownerUnitSql: Prisma.Sql | null;
}

export const TASK_RECORD_TYPES: Readonly<Record<string, TaskRecordType>> = {
  COMMITTEE: {
    // Spelled key by key, so each is a named reference the in-use scan sees.
    keys: {
      VIEW_ALL: COMMITTEE_TASKS_PERMISSIONS.VIEW_ALL,
      CREATE: COMMITTEE_TASKS_PERMISSIONS.CREATE,
      MANAGE: COMMITTEE_TASKS_PERMISSIONS.MANAGE,
      VIEW_UNIT: COMMITTEE_TASKS_PERMISSIONS.VIEW_UNIT,
    },
    ownerUnitSql: Prisma.sql`(SELECT oc."orgUnitId" FROM "Committee" oc WHERE oc.id = t."sourceId" AND oc."organizationId" = t."organizationId")`,
  },
};

/** May this permission set see records of the type at all? (rule 1) */
export function seesRecordType(permissions: readonly string[], type: string): boolean {
  const permission = RECORD_VIEW_PERMISSION[type];
  return !!permission && permissions.includes(permission);
}

/** Does this permission set hold the task key of this kind on the type, with the record visible? */
export function holdsTaskKey(permissions: readonly string[], type: string, kind: TaskKeyKind): boolean {
  const entry = TASK_RECORD_TYPES[type];
  return !!entry && seesRecordType(permissions, type) && permissions.includes(entry.keys[kind]);
}

/** Every type on which this permission set holds the key of this kind, record visible. */
export function typesHolding(permissions: readonly string[], kind: TaskKeyKind): string[] {
  return Object.keys(TASK_RECORD_TYPES).filter((type) => holdsTaskKey(permissions, type, kind));
}

/** The task key of this kind on the type, for a refusal's message. */
export function taskKeyOf(type: string, kind: TaskKeyKind): string | null {
  return TASK_RECORD_TYPES[type]?.keys[kind] ?? null;
}

/** Every task key of this kind, for a refusal that names no type. */
export function taskKeysOf(kind: TaskKeyKind): string[] {
  return Object.values(TASK_RECORD_TYPES).map((t) => t.keys[kind]);
}

/**
 * May this permission set create tasks at all, or on this type? For New task's
 * own reads (the SLA preview, Draft with AI), which name no record or one. 403
 * naming the key(s), before anything is read.
 */
export function assertMayCreateTasks(permissions: readonly string[], sourceType?: string | null): void {
  if (sourceType) {
    if (!holdsTaskKey(permissions, sourceType, 'CREATE')) {
      throw new ForbiddenException(`Required permission: ${taskKeyOf(sourceType, 'CREATE') ?? 'Create tasks'}`);
    }
    return;
  }
  if (typesHolding(permissions, 'CREATE').length === 0) {
    throw new ForbiddenException(`Required permission: ${taskKeysOf('CREATE').join(' or ')}`);
  }
}
