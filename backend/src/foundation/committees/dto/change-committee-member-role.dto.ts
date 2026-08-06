import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ChangeCommitteeMemberRoleDto {
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
