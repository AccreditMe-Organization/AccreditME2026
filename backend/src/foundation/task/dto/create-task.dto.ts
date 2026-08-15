import {
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

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

  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: (typeof TASK_PRIORITIES)[number];

  @IsISO8601()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  escalationUserId?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  escalationAfterHours?: number;
}
