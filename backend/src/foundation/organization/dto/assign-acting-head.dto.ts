import {
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// ACC-40 Section 2.6 — Acting Head coverage never touches position-holding
// (no positionId here, unlike AssignHeadDto) — the acting person is never
// granted the isUnitHeadPosition position itself.

// ACC-120 slice 2 — why an acting head is needed. The two are not
// interchangeable and the difference is not cosmetic:
//
//   VACANCY — the holder has LEFT. There is no substantive head.
//   ABSENCE — the head is IN POST but unavailable for longer than
//             out-of-office may carry (capped at 60 days), e.g. medical leave.
//
// Recorded rather than inferred because the two have different lifecycles and
// different wording when the 90-day open-ended condition reports them: ninety
// days covering a vacancy says a position needs filling; ninety days covering
// an absence says someone has been away three months. NEITHER AUTO-ENDS.
const ACTING_REASONS = ['VACANCY', 'ABSENCE'] as const;

export class AssignActingHeadDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsIn(ACTING_REASONS)
  actingReason!: (typeof ACTING_REASONS)[number];

  // The day the coverage starts. Required, because an acting appointment with
  // no start cannot be reported on, aged, or checked for overlap — which is
  // the gap ACC-120 slice 2 exists to close.
  @IsISO8601()
  @IsNotEmpty()
  validFrom!: string;

  // OPTIONAL, AND ITS ABSENCE IS MEANINGFUL: "until it is ended by hand".
  // That is the state the ACTING_HEAD_OPEN_ENDED Setup health condition
  // reports after 90 days — so an omitted validTo is a deliberate choice with
  // a consequence, not a missing field.
  @IsISO8601()
  @IsOptional()
  validTo?: string;

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
  //
  // KEPT DELIBERATELY (Ahmad, ACC-120 slice 2). It is absent from the Rev 6
  // drawing, almost certainly because the design did not know it existed;
  // flagged for the next design pass rather than dropped to match the picture.
  @IsString()
  @IsOptional()
  coveringForUserId?: string;
}
