import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { COMMITTEE_TASKS_PERMISSIONS } from '../../common/constants/permissions';
import { RECORD_VIEW_PERMISSION } from '../../common/services/object-visibility.service';
import { STAGE_FLAG } from '../workflow/record-registry';

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
 *
 * `recordInOrgSql` says the task's record exists in the task's own
 * organisation. Every PERMISSION-based way to a task requires it (rule 1: a
 * record that is not this organisation's is not visible here); relationships
 * do not (Q1).
 */
export type TaskKeyKind = 'VIEW_ALL' | 'CREATE' | 'MANAGE' | 'VIEW_UNIT';

export interface TaskRecordType {
  keys: Readonly<Record<TaskKeyKind, string>>;
  ownerUnitSql: Prisma.Sql | null;
  recordInOrgSql: Prisma.Sql;
  /** ACC-280 — what New task's record picker lists. A type without it has no choices (fail closed). */
  choices?: TaskRecordChoices;
}

/**
 * ACC-280 — the record picker's source, and the ONE rule for "this record takes new
 * tasks". Every expression is over the record row `r`, read from `fromSql`.
 *
 * `acceptsTasksSql` is decision 7's single server helper: the picker puts it in its
 * WHERE, and POST /tasks asks it of the one record, so the list and create cannot
 * disagree. Read from the record and its stage's FLAGS and RULES, never a stage name
 * or key.
 *
 * `memberSql` is ACC-281's membership rule as SQL: the viewer is an active member of
 * this active record. It scopes the picker, and New task's create types, for a
 * caller holding the type's Create tasks key without its view permission (decision 2).
 */
export interface TaskRecordChoices {
  fromSql: Prisma.Sql;
  acceptsTasksSql: Prisma.Sql;
  memberSql: (viewerId: string) => Prisma.Sql;
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
    recordInOrgSql: Prisma.sql`EXISTS (SELECT 1 FROM "Committee" rc WHERE rc.id = t."sourceId" AND rc."organizationId" = t."organizationId")`,
    choices: {
      fromSql: Prisma.sql`"Committee" r`,
      // Decision 7 (Ahmad, 10 Nov): active, and not dissolved. Dissolved is the CURRENT
      // stage of the committee's NEWEST workflow instance (committeeStagesAndCounts'
      // rule) carrying DISSOLVING AND being final. Dissolution Pending (DISSOLVING, not
      // final) still takes tasks. A committee with no instance is not dissolved.
      acceptsTasksSql: Prisma.sql`(r."isActive" AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT wi."currentStageId"
          FROM "WorkflowInstance" wi
          WHERE wi."organizationId" = r."organizationId" AND wi."objectType"::text = 'COMMITTEE' AND wi."objectId" = r.id
          ORDER BY wi."createdAt" DESC
          LIMIT 1
        ) latest
        JOIN "WorkflowStage" s ON s.id = latest."currentStageId"
        JOIN "WorkflowTemplate" wt ON wt.id = s."workflowTemplateId" AND wt."organizationId" = r."organizationId"
        WHERE ${STAGE_FLAG.DISSOLVING} = ANY(s.flags) AND s."isFinal"
      ))`,
      memberSql: (viewerId) => Prisma.sql`(r."isActive" AND EXISTS (
        SELECT 1 FROM "CommitteeMember" m
        WHERE m."committeeId" = r.id AND m."organizationId" = r."organizationId" AND m."userId" = ${viewerId} AND m."isActive"
      ))`,
    },
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

/**
 * ACC-280 — Create tasks on this type: its own CREATE key, whether or not the caller
 * holds the type's view permission. Who may see the RECORD is decided apart, by the
 * record check (committees:view, or an active member of THAT committee, ACC-281), so
 * a member is held to the same key as a committees:view holder. A type with no key
 * has no tasks to create (false). POST /tasks and a record panel's canCreate both
 * read this, so the panel offers exactly what create allows.
 */
export function holdsCreateKey(permissions: readonly string[], type: string): boolean {
  const key = taskKeyOf(type, 'CREATE');
  return key !== null && permissions.includes(key);
}

/**
 * ACC-280 — the refusal POST /tasks and "Draft with AI" both give, BEFORE the record
 * check: a type with a CREATE key needs it (403 naming the key), whatever the caller's
 * view permission. A type with no key keeps its old path: refused with "Create tasks"
 * when its view permission is held, else left to the record check that follows. The
 * one copy of this order; never re-derive it.
 */
export function assertHoldsCreateKey(permissions: readonly string[], type: string): void {
  const key = taskKeyOf(type, 'CREATE');
  const refused = key !== null ? !holdsCreateKey(permissions, type) : seesRecordType(permissions, type);
  if (refused) throw new ForbiddenException(`Required permission: ${key ?? 'Create tasks'}`);
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
