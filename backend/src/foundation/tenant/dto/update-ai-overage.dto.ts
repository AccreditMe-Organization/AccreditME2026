import { IsBoolean } from 'class-validator';

// Deliberately narrow — a tenant admin may only toggle overageEnabled for
// their own org; monthlyCredits/creditsUsed/creditsRemaining are set
// exclusively by a Platform Admin via PlatformTenantService.allocateAiCredits().
export class UpdateAiOverageDto {
  @IsBoolean()
  overageEnabled!: boolean;
}
