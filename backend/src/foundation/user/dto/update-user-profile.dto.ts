import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

// Admin-only fields (positionId, primaryOrgUnitId, managerId,
// actingOrgUnitId, actingOrgUnitUntil) are stripped by
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

  // ACC-40 Section 2.7 — pure scoping, confers no authority; lives on User
  // directly, matching primaryOrgUnitId's own admin-only write-path pattern.
  @IsString()
  @IsOptional()
  actingOrgUnitId?: string;

  @IsDateString()
  @IsOptional()
  actingOrgUnitUntil?: string;
}
