import { IsNotEmpty, IsString } from 'class-validator';

// ACC-46 Section 2.6.b Step 3 — the live gate fired before the wizard
// advances past the conditional replacement step (shown only when
// getTransferContext() reported hasActiveDirectReports).
export class ValidateTransferReplacementDto {
  @IsString()
  @IsNotEmpty()
  replacementUserId!: string;
}
