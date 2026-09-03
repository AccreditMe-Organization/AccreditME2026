import { IsNotEmpty, IsString } from 'class-validator';

// ACC-46 Section 2.6.b Step 4 — the live gate fired before the wizard
// advances past the (always-shown, for every transfer) destination
// position step. Always both required — unlike invite-user.dto.ts's own
// conditional fields, there is no exemption case here.
export class ValidateTransferPositionDto {
  @IsString()
  @IsNotEmpty()
  destinationOrgUnitId!: string;

  @IsString()
  @IsNotEmpty()
  newPositionId!: string;
}
