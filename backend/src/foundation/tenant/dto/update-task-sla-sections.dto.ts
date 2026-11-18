import { Type } from 'class-transformer';
import { IsBoolean, IsDefined, IsIn, IsInt, IsOptional, Max, Min, ValidateNested } from 'class-validator';
import { WARN_BEFORE_DUE_VALUES } from '../task-sla-settings';
import type { TaskSlaWarnBeforeDue } from '../interfaces/tenant.interface';

// ACC-313 — the Task SLA page saves by SECTION (its drawn design has two
// Saves), so each route takes only its own fields, for all four priorities,
// and the service merges them into the stored tiers under the row lock. A
// whole-tier PATCH would write the other section's unsaved or stale values.

export class TaskSlaLimitDto {
  @IsInt()
  @Min(1)
  dueAfterHours!: number;
}

/** PATCH /tenant/task-sla/limits — Time limits: how long each priority has. */
export class UpdateTaskSlaLimitsDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaLimitDto)
  LOW!: TaskSlaLimitDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaLimitDto)
  MEDIUM!: TaskSlaLimitDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaLimitDto)
  HIGH!: TaskSlaLimitDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaLimitDto)
  CRITICAL!: TaskSlaLimitDto;
}

export class TaskSlaEscalationDto {
  @IsInt()
  @Min(0)
  managerEscalationAfterHours!: number;

  @IsInt()
  @Min(0)
  headEscalationAfterHours!: number;

  /**
   * ACC-313 PR 4 — how long before the due time this priority's assignees are
   * reminded. Optional: a body without it keeps the stored warning, so a
   * screen that saves escalation alone does not change it.
   */
  @IsOptional()
  @IsIn([...WARN_BEFORE_DUE_VALUES])
  warnBeforeDue?: TaskSlaWarnBeforeDue;
}

/** PATCH /tenant/task-sla/escalation — who is told, and when, per priority. */
export class UpdateTaskSlaEscalationDto {
  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaEscalationDto)
  LOW!: TaskSlaEscalationDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaEscalationDto)
  MEDIUM!: TaskSlaEscalationDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaEscalationDto)
  HIGH!: TaskSlaEscalationDto;

  @IsDefined()
  @ValidateNested()
  @Type(() => TaskSlaEscalationDto)
  CRITICAL!: TaskSlaEscalationDto;
}

/**
 * PATCH /tenant/task-sla/notices — whether an edit that moves a due date tells
 * the assignees. The reminders (`warnBeforeDue`) are saved with escalation,
 * from the reminder sweep's PR, so they are not part of this body.
 */
export class UpdateTaskSlaNoticesDto {
  @IsBoolean()
  notifyOnDueChange!: boolean;
}

/** The history page size: 20 by default, never more than 50. */
export const TASK_SLA_HISTORY_DEFAULT_TAKE = 20;
export const TASK_SLA_HISTORY_MAX_TAKE = 50;

/** GET /tenant/task-sla/history?skip=&take= */
export class TaskSlaHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TASK_SLA_HISTORY_MAX_TAKE)
  take?: number;
}
