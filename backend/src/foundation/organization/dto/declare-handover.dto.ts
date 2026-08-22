import { IsDateString, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// ACC-40 Section 2.3
export class DeclareHandoverDto {
  @IsString()
  @IsNotEmpty()
  incomingUserId!: string;

  @IsDateString()
  effectiveDate!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
