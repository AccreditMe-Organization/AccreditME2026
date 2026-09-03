import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const DELEGATION_REASONS = ['ACTING_HEAD', 'OUT_OF_OFFICE_COVERAGE'] as const;

// ACC-40 Section 2.6.3 — per-assignee delegation stamp, populated ONLY by
// the workflow engine's own internal call (WorkflowService.executeCreateTask()),
// never by the public controller/manual (tasks:create) path — a manually
// created task's assignees are directly chosen by a human, no delegation
// reasoning applies.
export class TaskAssigneeDelegationDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsIn(DELEGATION_REASONS)
  delegationReason!: (typeof DELEGATION_REASONS)[number];

  @IsString()
  @IsNotEmpty()
  delegationContextId!: string;
}

const TASK_SOURCE_TYPES = [
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

const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

// Every task MUST have sourceType and sourceId — no standalone tasks, per
// CLAUDE.md's non-negotiable rule. Both fields are required here, not
// optional, regardless of whether the task is created automatically by the
// workflow engine or manually by a user holding tasks:create.
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
  sourceStageId?: string;

  // Links a workflow-generated task back to the WorkflowInstance that
  // created it — never set by manual (tasks:create) task creation.
  @IsString()
  @IsOptional()
  workflowInstanceId?: string;

  @IsString()
  @IsOptional()
  meetingId?: string;

  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  assigneeUserIds!: string[];

  // ACC-40 Section 2.6.3 — optional, workflow-engine-only. Not every
  // assigneeUserIds entry needs an entry here — only those resolved via
  // delegation (ACTING_HEAD or OUT_OF_OFFICE_COVERAGE); a direct,
  // undelegated assignee simply has no matching row.
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TaskAssigneeDelegationDto)
  assigneeDelegations?: TaskAssigneeDelegationDto[];

  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
