import { refusalBody, refusalCode } from '../../core/http/refusal';
import type { TaskPriority } from './services/workflow-template.service';

/**
 * ACC-208 — reading the workflow engine's refusals (ACC-190's
 * `WorkflowRefusalException`) off an HTTP error. A screen maps the CODE and
 * its details to its own words, in either language; the English `message` is
 * written for a log and is never shown (core/http/refusal.ts).
 *
 * The typed readers below return null for any other refusal, so a caller can
 * try the one it expects and fall back to its generic message.
 */

export type WorkflowRefusalCode =
  | 'STAGE_TASK_ROUTE_INCOMPLETE'
  | 'STAGE_TASK_ROUTE_NOT_AVAILABLE'
  | 'STAGE_TASK_UNIT_NOT_FOUND'
  | 'STAGE_TASK_POSITION_NOT_FOUND'
  | 'STAGE_TASK_COMMITTEE_NOT_FOUND'
  | 'STAGE_TASK_ROLE_NOT_FOUND'
  | 'STAGE_TASK_USER_NOT_IN_POSITION'
  | 'STAGE_TASK_ON_FINAL_STAGE'
  | 'STAGE_TASK_ORDER_MISMATCH'
  | 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE'
  | 'STAGE_DEADLINE_BEFORE_TASKS'
  | 'TASK_SLA_EXCEEDS_STAGE_DEADLINES'
  | 'STAGE_TASKS_OPEN'
  | 'ACTION_TYPE_RETIRED'
  | 'VALIDATOR_RETIRED'
  // ACC-238 — a committee leaves Formation only with a quorum of at least 1.
  | 'COMMITTEE_QUORUM_NOT_SET'
  // ACC-239 — the committee change request workflow's shape is fixed.
  | 'WORKFLOW_TEMPLATE_PROTECTED'
  // ACC-255 — stage rules: what a stage allows, and what a stage save may name.
  | 'STAGE_ACTION_NOT_ALLOWED'
  | 'STAGE_ACTION_UNKNOWN'
  | 'STAGE_FLAG_UNKNOWN'
  | 'STAGE_FLAG_EXACTLY_ONE';

/**
 * The refusals whose words need nothing but the code. Literal keys, so the
 * translation-keys spec can see each one. The deadline rule and the gate are
 * absent: their sentences carry numbers and names, read below.
 */
const PLAIN_REFUSAL_KEYS: Partial<Record<WorkflowRefusalCode, string>> = {
  STAGE_TASK_ROUTE_INCOMPLETE: 'workflow.refusal.routeIncomplete',
  STAGE_TASK_ROUTE_NOT_AVAILABLE: 'workflow.refusal.routeNotAvailable',
  STAGE_TASK_UNIT_NOT_FOUND: 'workflow.refusal.unitNotFound',
  STAGE_TASK_POSITION_NOT_FOUND: 'workflow.refusal.positionNotFound',
  STAGE_TASK_COMMITTEE_NOT_FOUND: 'workflow.refusal.committeeNotFound',
  STAGE_TASK_ROLE_NOT_FOUND: 'workflow.refusal.roleNotFound',
  STAGE_TASK_USER_NOT_IN_POSITION: 'workflow.refusal.userNotInPosition',
  STAGE_TASK_ON_FINAL_STAGE: 'workflow.refusal.onFinalStage',
  STAGE_TASK_ORDER_MISMATCH: 'workflow.stageTasks.orderChanged',
  ACTION_TYPE_RETIRED: 'workflow.refusal.actionTypeRetired',
  VALIDATOR_RETIRED: 'workflow.refusal.validatorRetired',
  COMMITTEE_QUORUM_NOT_SET: 'workflow.refusal.committeeQuorumNotSet',
  WORKFLOW_TEMPLATE_PROTECTED: 'workflow.refusal.templateProtected',
  // A committee screen names the stage (committee-stage-refusal.ts); a workflow
  // screen has no stage to name, so it says the plain sentence.
  STAGE_ACTION_NOT_ALLOWED: 'workflow.refusal.stageActionNotAllowed',
  STAGE_ACTION_UNKNOWN: 'workflow.refusal.stageActionUnknown',
  STAGE_FLAG_UNKNOWN: 'workflow.refusal.stageFlagUnknown',
  STAGE_FLAG_EXACTLY_ONE: 'workflow.refusal.stageFlagExactlyOne',
};

/**
 * ACC-255 PR 3 (plan §10.4) — what each protected edit says (the backend's
 * PROTECTED_REFUSALS, by its `edit` detail). An edit this list does not know
 * says the general sentence, never the server's English.
 */
const PROTECTED_REFUSAL_KEYS: Record<string, string> = {
  CREATE_TEMPLATE: 'workflow.refusal.protected.CREATE_TEMPLATE',
  REPLACE_DEFAULT: 'workflow.refusal.protected.REPLACE_DEFAULT',
  DEACTIVATE: 'workflow.refusal.protected.DEACTIVATE',
  CHANGE_TYPE: 'workflow.refusal.protected.CHANGE_TYPE',
  ADD_STAGE: 'workflow.refusal.protected.ADD_STAGE',
  REMOVE_STAGE: 'workflow.refusal.protected.REMOVE_STAGE',
  STAGE_FIELD: 'workflow.refusal.protected.STAGE_FIELD',
  TRANSITION: 'workflow.refusal.protected.TRANSITION',
  STAGE_TASKS: 'workflow.refusal.protected.STAGE_TASKS',
};

/** The translation key for a refusal that needs only its code (and, if protected, its edit), or null. */
export function plainWorkflowRefusalKey(err: unknown): string | null {
  const code = refusalCode(err) as WorkflowRefusalCode | null;
  if (code === 'WORKFLOW_TEMPLATE_PROTECTED') {
    const edit = refusalBody(err)?.['edit'];
    return typeof edit === 'string' && Object.hasOwn(PROTECTED_REFUSAL_KEYS, edit)
      ? PROTECTED_REFUSAL_KEYS[edit]
      : 'workflow.refusal.templateProtected';
  }
  return (code && PLAIN_REFUSAL_KEYS[code]) ?? null;
}

function bodyIf(err: unknown, code: WorkflowRefusalCode): Record<string, unknown> | null {
  return refusalCode(err) === code ? refusalBody(err) : null;
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

// ── The stage-deadline rule, from each of its three sides ───────────────────

/** Saving a definition whose priority is due after the stage's deadline. */
export function dueAfterStageDeadline(err: unknown): { taskHours: number; stageHours: number; priority: TaskPriority } | null {
  const body = bodyIf(err, 'STAGE_TASK_DUE_AFTER_STAGE_DEADLINE');
  if (!body || !isNumber(body['taskHours']) || !isNumber(body['stageHours'])) return null;
  return { taskHours: body['taskHours'], stageHours: body['stageHours'], priority: body['priority'] as TaskPriority };
}

/** Shortening a stage's deadline below the longest task on it. */
export function deadlineBeforeTasks(err: unknown): { stageHours: number; longestTaskHours: number; definitionIds: string[] } | null {
  const body = bodyIf(err, 'STAGE_DEADLINE_BEFORE_TASKS');
  if (!body || !isNumber(body['stageHours']) || !isNumber(body['longestTaskHours'])) return null;
  const ids = body['definitionIds'];
  return {
    stageHours: body['stageHours'],
    longestTaskHours: body['longestTaskHours'],
    definitionIds: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
  };
}

export interface StageDeadlineConflict {
  stageId: string;
  stageName: string;
  stageNameAr: string | null;
  templateName: string;
  templateNameAr: string | null;
  workflowTemplateId: string;
  stageHours: number;
  longestTaskHours: number;
  priority: TaskPriority;
}

/** Raising a priority's hours in the tenant's task SLA: every stage it would break. */
export function taskSlaStageConflicts(err: unknown): StageDeadlineConflict[] | null {
  const stages = bodyIf(err, 'TASK_SLA_EXCEEDS_STAGE_DEADLINES')?.['stages'];
  return Array.isArray(stages) ? (stages as StageDeadlineConflict[]) : null;
}

/** Marking a stage final while it still has task definitions. */
export function finalStageTaskCount(err: unknown): number | null {
  const count = bodyIf(err, 'STAGE_TASK_ON_FINAL_STAGE')?.['taskDefinitionCount'];
  return isNumber(count) ? count : null;
}

// ── The gate: an ADVANCE refused while mandatory tasks are open (B7) ────────

interface Named {
  nameEn: string;
  nameAr: string | null;
}

export type OpenStageTaskPool =
  | { kind: 'POSITION'; orgUnit: Named; position: Named }
  | { kind: 'COMMITTEE_ROLE'; committee: Named; role: { labelEn: string; labelAr: string | null } };

export interface OpenStageTask {
  id: string;
  title: string;
  titleAr: string | null;
  status: string;
  statusLabel: string;
  dueAt: string | null;
  requiresEvidence: boolean;
  /** Everyone still on the task. Empty while it waits in its pool. */
  assignees: { id: string; name: string }[];
  /** Where it waits when nobody holds it; null for a chosen person or no target. */
  pool: OpenStageTaskPool | null;
}

/** The open mandatory tasks holding a record in its stage, or null for any other refusal. */
export function openStageTasks(err: unknown): OpenStageTask[] | null {
  const tasks = bodyIf(err, 'STAGE_TASKS_OPEN')?.['tasks'];
  if (!Array.isArray(tasks)) return null;
  return (tasks as Partial<OpenStageTask>[]).map((t) => ({
    id: String(t.id),
    title: String(t.title ?? ''),
    titleAr: t.titleAr ?? null,
    status: String(t.status ?? ''),
    statusLabel: String(t.statusLabel ?? ''),
    dueAt: t.dueAt ?? null,
    requiresEvidence: t.requiresEvidence === true,
    assignees: Array.isArray(t.assignees) ? t.assignees : [],
    pool: t.pool ?? null,
  }));
}

/**
 * ACC-255 PR 4b — a meaning that must sit on exactly one stage, refused: the
 * flag and the stages that hold it now, each with its id (4b-be's G3) beside
 * its names, so the stage editor can name AND open the other one. An empty
 * list means no stage holds it.
 */
export function flagExactlyOne(
  err: unknown,
): { flag: string; stages: { id: string; nameEn: string; nameAr: string | null }[] } | null {
  const body = bodyIf(err, 'STAGE_FLAG_EXACTLY_ONE');
  if (!body || typeof body['flag'] !== 'string') return null;
  const names = Array.isArray(body['stageNames']) ? (body['stageNames'] as { nameEn?: unknown; nameAr?: unknown }[]) : [];
  const ids = Array.isArray(body['stageIds']) ? (body['stageIds'] as unknown[]) : [];
  const stages = ids.flatMap((id, i) => {
    const name = names[i];
    return typeof id === 'string' && name && typeof name.nameEn === 'string'
      ? [{ id, nameEn: name.nameEn, nameAr: typeof name.nameAr === 'string' ? name.nameAr : null }]
      : [];
  });
  return { flag: body['flag'], stages };
}
