import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

// Merged into Organization.settings.ai — never overwrites unrelated settings
// keys wholesale.
export class AllocateAiCreditsDto {
  @IsInt()
  @Min(0)
  monthlyCredits!: number;

  @IsBoolean()
  @IsOptional()
  overageEnabled?: boolean;
}
