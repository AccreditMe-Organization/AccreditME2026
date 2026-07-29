import { IsOptional, IsString, MaxLength } from 'class-validator';

// Admin-only fields (positionId, primaryOrgUnitId, managerId) are stripped by
// UserService.updateProfile() when the caller is editing their own profile
// without users:manage — see step-09 plan Section 12, Discussion 3.
export class UpdateUserProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  positionId?: string;

  @IsString()
  @IsOptional()
  primaryOrgUnitId?: string;

  @IsString()
  @IsOptional()
  managerId?: string;
}
