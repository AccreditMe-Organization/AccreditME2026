import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AssignTargetDto } from './assign-target.dto';
import { TaskAiWorkloadHintDto } from './task-ai-workload-hint.dto';

const DELEGATION_REASONS = ['ACTING_HEAD', 'OUT_OF_OFFICE_COVERAGE'] as const;

// ACC-40 Section 2.6.3 — per-assignee delegation stamp. Never part of the
// request body (ACC-271): a manually created task's assignees are chosen by a
// human, so no delegation reasoning applies. Only TaskService.create()'s
// trusted in-code callers pass it, through its `internal` argument, so it is a
// plain type with no validation decorators.
export interface TaskAssigneeDelegationDto {
  userId: string;
  delegationReason: (typeof DELEGATION_REASONS)[number];
  delegationContextId: string;
}

export const TASK_SOURCE_TYPES = [
  'MEETING',
  'DOCUMENT',
  'AUDIT',
  'CAPA',
  'INCIDENT',
  'CORRECTIVE_ACTION',
  'STANDARD',
  'KPI',
  'GAP',
  'QUALITY_IMPROVEMENT_PLAN',
  'COMMITTEE',
] as const;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

// ACC-271 — what only a trusted in-code caller may set on a new task, passed
// as TaskService.create()'s fourth argument and never read from a request
// body. createForViewer() (the HTTP route) never passes it.
export interface CreateTaskInternal {
  // The workflow stage a task belongs to.
  sourceStageId?: string;
  // Links a workflow-generated task back to the WorkflowInstance that created it.
  workflowInstanceId?: string;
  // Only those assignees resolved via delegation (ACTING_HEAD or
  // OUT_OF_OFFICE_COVERAGE); a direct, undelegated assignee has no entry.
  assigneeDelegations?: TaskAssigneeDelegationDto[];
}

// ACC-197 — the task was written with an AI draft the creator accepted in the
// New task dialog. `id` is the draft's own id (POST /tasks/draft). It is a
// claim, CHECKED by the service against the AI log before the audit row is
// marked; a claim that does not check out is ignored, never refused.
export class TaskAiDraftDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  // The description came from an accepted draft.
  @IsBoolean()
  description!: boolean;

  // The title came from "Use this title".
  @IsBoolean()
  title!: boolean;
}

// Every task MUST have sourceType and sourceId — no standalone tasks, per
// CLAUDE.md's non-negotiable rule. Both fields are required here, not
// optional, regardless of whether the task is created automatically by the
// workflow engine or manually by a user holding Create tasks on the record's type.
//
// ACC-271 — this is the request body of POST /tasks. The engine-only fields
// (sourceStageId, workflowInstanceId, assigneeDelegations) are NOT on it, so
// the global forbidNonWhitelisted pipe refuses a body that sends any of them
// (400): a hand-made task can't pose as workflow-made or carry a delegation
// reason. Trusted in-code callers pass them as TaskService.create()'s
// `internal` argument (CreateTaskInternal) instead.
export class CreateTaskDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsIn(TASK_SOURCE_TYPES)
  sourceType!: (typeof TASK_SOURCE_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  @IsString()
  @IsOptional()
  meetingId?: string;

  // Named people — the workflow engine's path, and every task before
  // ACC-167. Optional since ACC-167: the task form sends `assignTo` instead.
  // Sending both is refused (400) by the service rather than one silently
  // winning. Sending neither creates an UNASSIGNED task, as before.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  assigneeUserIds?: string[];

  // ACC-167 (Q5) — assign by org unit and position (or committee role), with
  // an optional person. See AssignTargetDto for the three outcomes.
  @IsOptional()
  @ValidateNested()
  @Type(() => AssignTargetDto)
  assignTo?: AssignTargetDto;

  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsISO8601()
  @IsOptional()
  dueDate?: string;

  // ACC-163 — complete() refuses until at least one piece of evidence exists.
  // Set from the manual task form; the workflow engine never sends it, so a
  // workflow task stays false until stage task definitions exist.
  @IsBoolean()
  @IsOptional()
  requiresEvidence?: boolean;

  // ACC-197 — see TaskAiDraftDto. Set only by the New task dialog, and only
  // after the creator accepted a draft.
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskAiDraftDto)
  aiDraft?: TaskAiDraftDto;

  // ACC-199 — the person chosen came from "✦ Suggest someone" (Assign … instead).
  @IsOptional()
  @ValidateNested()
  @Type(() => TaskAiWorkloadHintDto)
  aiWorkloadHint?: TaskAiWorkloadHintDto;
}
