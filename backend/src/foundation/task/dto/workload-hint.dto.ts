import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TASK_PRIORITIES, TASK_SOURCE_TYPES } from './create-task.dto';

// ACC-199 — "✦ Suggest someone". Who the task would go to (a unit and position,
// or a committee and role — the service refuses neither or a mix), the person
// chosen, and the record the dialog was opened from: the counts are that
// record's, and the record is required — with no record there is no button.
export class WorkloadHintDto {
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  orgUnitId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  positionId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  committeeId?: string;

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  roleValueId?: string;

  @IsString()
  @IsNotEmpty()
  chosenUserId!: string;

  @IsIn(TASK_SOURCE_TYPES)
  sourceType!: (typeof TASK_SOURCE_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  sourceId!: string;

  // The task's priority, for the model; New task sends the form's, Reassign the task's.
  @IsIn(TASK_PRIORITIES)
  @IsOptional()
  priority?: (typeof TASK_PRIORITIES)[number];

  // Reassign: the task itself is left out of the counts, and the picker's
  // "may reassign THIS task" rule applies.
  @IsString()
  @IsNotEmpty()
  @IsOptional()
  taskId?: string;
}
