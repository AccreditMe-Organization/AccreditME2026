import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  committeeId!: string;
}

export class AssignmentCommitteeMembersQueryDto extends AssignmentQueryDto {
  @IsString()
  @IsNotEmpty()
  committeeId!: string;

  @IsString()
  @IsNotEmpty()
  roleValueId!: string;
}
