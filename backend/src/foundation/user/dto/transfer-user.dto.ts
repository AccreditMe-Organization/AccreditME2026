import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

// ACC-46 Section 2.6.b Step 6 — the final submit. Full re-validation runs
// again fresh inside UserService.transferUser() — the wizard's own earlier
// live-gate calls (validate-replacement/validate-position) are a UX
// convenience, never the sole authority.
export class TransferUserDto {
  @IsString()
  @IsNotEmpty()
  destinationOrgUnitId!: string;

  // Always required now — see Step 4: there is no "leave it unset for
  // later" path anymore, in any case.
  @IsString()
  @IsNotEmpty()
  newPositionId!: string;

  // Required for a non-promotion transfer, ignored (derived instead) for
  // a promotion — enforced in the service, not via class-validator, same
  // shape as invite-user.dto.ts's own conditional fields.
  @IsString()
  @IsOptional()
  newManagerId?: string;

  // Required only when the departing person has active direct reports.
  @IsString()
  @IsOptional()
  replacementUserId?: string;
}
