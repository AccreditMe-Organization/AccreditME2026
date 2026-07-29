import { IsDateString, IsOptional, IsString } from 'class-validator';

// Self-service-safe in full — a user setting their own out-of-office window
// and acting-user designation is exactly the acceptance criterion, no
// admin-only field stripping needed here (unlike UpdateUserProfileDto).
export class UpdateOutOfOfficeDto {
  @IsDateString()
  @IsOptional()
  outOfOfficeFrom?: string;

  @IsDateString()
  @IsOptional()
  outOfOfficeTo?: string;

  @IsString()
  @IsOptional()
  actingUserId?: string;
}
