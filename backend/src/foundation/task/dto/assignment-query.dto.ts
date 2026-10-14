import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';
import { TASK_SOURCE_TYPES } from './create-task.dto';

// ACC-167 — the assignment picker's queries.
//
// `taskId` is how someone who may not CREATE tasks still reaches the picker:
// they are reassigning that task, as its creator or a tasks:reassign holder.
// Without it, the caller needs tasks:create.

export class AssignmentQueryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  taskId?: string;
}

export class AssignmentPositionsQueryDto extends AssignmentQueryDto {
  @IsString()
  @IsNotEmpty()
  orgUnitId!: string;
}

// ACC-199 — the record the picker was opened from. With it, each person
// carries their open and overdue tasks on that record, for a caller who can
// see the record's task list; without it, none. Both, or neither.
export class AssignmentRecordQueryDto extends AssignmentQueryDto {
  @IsIn(TASK_SOURCE_TYPES)
  @IsOptional()
  sourceType?: (typeof TASK_SOURCE_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  @IsOptional()
  sourceId?: string;
}

export class AssignmentHoldersQueryDto extends AssignmentRecordQueryDto {
  @IsString()
  @IsNotEmpty()
  orgUnitId!: string;

  @IsString()
  @IsNotEmpty()
  positionId!: string;
}

export class AssignmentCommitteeRolesQueryDto extends AssignmentQueryDto {
  // ACC-208 (B5) — optional only with `catalogue`: "the record's committee"
  // names no committee, so a stage task definition needs the role catalogue.
  @ValidateIf((query: AssignmentCommitteeRolesQueryDto) => query.catalogue !== true || query.committeeId !== undefined)
  @IsString()
  @IsNotEmpty()
  committeeId?: string;

  // ACC-208 (B5) — every committee member role, including those nobody holds
  // on this committee: configuring a stage task may target an empty role (its
  // row warns), where creating a task deliberately may not. Same mapping as
  // GetMyTasksQueryDto.overdue: implicit conversion is off app-wide.
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  catalogue?: boolean;
}

export class AssignmentCommitteeMembersQueryDto extends AssignmentRecordQueryDto {
  @IsString()
  @IsNotEmpty()
  committeeId!: string;

  @IsString()
  @IsNotEmpty()
  roleValueId!: string;
}
