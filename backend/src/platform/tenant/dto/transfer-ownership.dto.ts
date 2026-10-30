import { IsNotEmpty, IsString } from 'class-validator';

// ACC-221 — POST /platform/tenants/:id/owner. The person who becomes the
// organisation's account owner; they must be an active Organization
// Administrator of that tenant.
export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;
}
