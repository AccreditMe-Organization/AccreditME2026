import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';

// ACC-163 — the statuses a person can filter their OWN list by. REJECTED and
// UNASSIGNED are absent because neither can appear there: both mean the task
// has no active assignee, and my-tasks lists only active assignments.
//
// OVERDUE is absent because it is no longer a status (Q8). Overdue is the
// separate `overdue` flag below, computed from dueAt, so a task can be both
// In progress and overdue — which a status could never say.
export const MY_TASK_STATUS_FILTERS = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;

export class GetMyTasksQueryDto {
  // Validated, where the old @Query('status') union was a type only: an
  // unknown value reached Prisma as an invalid enum and came back a 500.
  @IsOptional()
  @IsIn(MY_TASK_STATUS_FILTERS)
  status?: (typeof MY_TASK_STATUS_FILTERS)[number];

  // A query string is text, and implicit conversion is off app-wide, so the
  // two literal spellings are mapped here and anything else fails @IsBoolean.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (value === 'true' ? true : value === 'false' ? false : value))
  @IsBoolean()
  overdue?: boolean;
}
