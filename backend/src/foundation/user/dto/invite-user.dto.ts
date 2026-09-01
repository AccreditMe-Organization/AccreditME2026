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

  // ACC-46 Section 2.3 — required for every invite EXCEPT the person being
  // invited as the root unit's own Head (no parent to report to). NOT a
  // blanket-required decorator — same shape as primaryOrgUnitId above: a
  // bare @IsNotEmpty() here would reject the exemption case at the DTO
  // layer before UserService.invite() ever gets to apply it. The exemption
  // is conditional on positionId/primaryOrgUnitId's own resolved values,
  // so the actual required-ness is enforced there instead.
  @IsString()
  @IsOptional()
  managerId?: string;
}
