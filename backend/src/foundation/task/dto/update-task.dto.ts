import { Transform } from 'class-transformer';
import { IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

// ACC-174 — what a task's creator may change: these four fields and nothing
// else. Written out rather than derived from CreateTaskDto, which carries
// engine-only fields (sourceStageId, workflowInstanceId, assigneeDelegations)
// no person may set. At least one field is required; TaskService refuses an
// empty body before reading anything.
export class UpdateTaskDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  // Sent empty, the description is cleared (stored NULL, ACC-160's one form).
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  @IsOptional()
  description?: string | null;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;

  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: (typeof TASK_PRIORITIES)[number];
}

// ACC-174 — a cancel by the creator. The assignees read the reason.
export class CancelTaskDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

// ACC-174 — reopening a completed task: why (the assignees read it), and
// optionally a due date earlier than the restarted SLA gives.
export class ReopenTaskDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @IsISO8601()
  @IsOptional()
  dueDate?: string;
}
