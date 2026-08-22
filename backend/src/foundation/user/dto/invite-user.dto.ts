import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  // ACC-40 Section 2.4 — mandatory for every new invitation from the
  // moment this ships; existing active users are not retroactively
  // blocked (see UserService.invite() / the remediation report instead).
  @IsString()
  @IsNotEmpty()
  positionId!: string;

  // Required only once the tenant has at least one active OrgUnit — a
  // brand-new tenant has zero until an admin creates one, so this can't
  // be a blanket-required decorator; enforced conditionally in
  // UserService.invite() instead (ACC-40 Section 2.4's scoped exception).
  @IsString()
  @IsOptional()
  primaryOrgUnitId?: string;

  @IsString()
  @IsOptional()
  managerId?: string;
}
