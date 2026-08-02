import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class AddCommitteeMemberDto {
  // Re-validated against the caller's org in CommitteeService before write
  // — the exact validateAssigneeUserId() pattern from
  // workflow-template.service.ts (ACC-17/ACC-22).
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsNotEmpty()
  roleValueId!: string;

  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reason?: string;
}
