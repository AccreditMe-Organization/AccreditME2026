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

  // ACC-40 Section 2.6.4 — explicit, admin-supplied, never auto-inferred.
  // When set, identifies whose position the acting user is covering for —
  // the system resolves which head-conferring position (and therefore
  // which role, per 2.9) is relevant from this specific person's own
  // current holding or most recent departure event. Omitted entirely for
  // a pure vacancy (a unit that's never had anyone hold any head-conferring
  // position) — Acting Head then grants workflow-eligibility only, no role.
  @IsString()
  @IsOptional()
  coveringForUserId?: string;
}
