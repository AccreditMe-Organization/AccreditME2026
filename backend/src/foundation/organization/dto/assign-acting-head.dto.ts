import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// ACC-40 Section 2.6 — Acting Head coverage never touches position-holding
// (no positionId here, unlike AssignHeadDto) — the acting person is never
// granted the isUnitHeadPosition position itself.
export class AssignActingHeadDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  reason?: string;
}
