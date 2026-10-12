import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

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

export class AssignmentHoldersQueryDto extends AssignmentQueryDto {
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

export class AssignmentCommitteeMembersQueryDto extends AssignmentQueryDto {
  @IsString()
  @IsNotEmpty()
  committeeId!: string;

  @IsString()
  @IsNotEmpty()
  roleValueId!: string;
}
