import { Type } from 'class-transformer';
import { IsInt, Min, ValidateNested } from 'class-validator';

// ACC-46 Section 2.7.d — one tier per TaskPriority, all four required on
// every PATCH (no partial-tier update — a tenant admin edits the full
// table in one save, matching the settings page's own 4-row form).
export class TaskSlaTierDto {
  @IsInt()
  @Min(1)
  dueAfterHours!: number;

  @IsInt()
  @Min(0)
  managerEscalationAfterHours!: number;

  @IsInt()
  @Min(0)
  headEscalationAfterHours!: number;
}

export class UpdateTaskSlaDto {
  @ValidateNested()
  @Type(() => TaskSlaTierDto)
  LOW!: TaskSlaTierDto;

  @ValidateNested()
  @Type(() => TaskSlaTierDto)
  MEDIUM!: TaskSlaTierDto;

  @ValidateNested()
  @Type(() => TaskSlaTierDto)
  HIGH!: TaskSlaTierDto;

  @ValidateNested()
  @Type(() => TaskSlaTierDto)
  CRITICAL!: TaskSlaTierDto;
}
