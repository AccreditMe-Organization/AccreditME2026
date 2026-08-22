import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateOrgPositionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn!: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  nameAr?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  grade!: number;

  // ACC-40 Section 2.1 — per-org-unit single-holder rule, enforced at
  // assignment time (User.positionId writes), not here.
  @IsBoolean()
  @IsOptional()
  isSingleAssignee?: boolean;

  // ACC-40 Section 2.1 — requires isSingleAssignee: true, enforced at
  // service-layer save time (createPosition()/updatePosition()).
  @IsBoolean()
  @IsOptional()
  isUnitHeadPosition?: boolean;

  // ACC-40 Section 2.9 — maps this position to a Role for automatic
  // inheritance while held. PLATFORM_ADMIN/TENANT_ADMIN excluded at
  // service-layer save time.
  @IsString()
  @IsOptional()
  roleId?: string;
}
