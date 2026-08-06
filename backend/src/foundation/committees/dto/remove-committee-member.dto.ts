import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class RemoveCommitteeMemberDto {
  @IsDateString()
  @IsOptional()
  effectiveDate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  reason?: string;
}
