import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

// Matches the Prisma CommitteeMeetingFrequency enum — @IsIn with a local
// const array, same pattern already used by
// create-workflow-stage.dto.ts's approvalMode/assigneeStrategy, rather
// than @IsEnum against the generated Prisma enum directly.
export const COMMITTEE_MEETING_FREQUENCIES = [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
  'ANNUAL',
  'AS_NEEDED',
] as const;

export class CreateCommitteeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nameEn!: string;

  // ACC-160 — optional, because Arabic fields are never mandatory. An empty
  // value stores NULL rather than '' (see trimToNull). Update DTOs built with
  // PartialType inherit both halves.
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(trimToNull)
  nameAr?: string | null;

  @IsString()
  @IsNotEmpty()
  typeValueId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  purpose?: string;

  @IsInt()
  @Min(0)
  @IsOptional()
  quorumCount?: number;

  @IsIn(COMMITTEE_MEETING_FREQUENCIES)
  @IsOptional()
  meetingFrequency?: (typeof COMMITTEE_MEETING_FREQUENCIES)[number];

  // Re-validated against the caller's org in CommitteeService before write
  // — a Committee row, same pattern as workflow-template.service.ts's
  // validateCommitteeId() (ACC-22, closing the ACC-17 deferred gap).
  @IsString()
  @IsOptional()
  parentCommitteeId?: string;

  // Nullable, deliberately unpopulated until Document Management ships
  // (ACC-22 Pending Discussion #1) — accepted here for forward-compatibility
  // but not re-validated against anything yet, since no Document table
  // exists to validate against.
  @IsString()
  @IsOptional()
  termsOfReferenceDocumentId?: string;

  // ACC-135 — the org unit that OWNS this committee.
  //
  // OPTIONAL HERE, REQUIRED IN THE RECORD. Omitting it means "the whole
  // organisation", which the service resolves to the tenant's root unit rather
  // than storing an absence — the root unit IS the organisation (ACC-141). So the
  // caller may leave it out; the committee still ends up owned.
  //
  // Re-validated against the caller's org in CommitteeService before write, the
  // same way parentCommitteeId is.
  @IsString()
  @IsOptional()
  orgUnitId?: string;

  // ACC-135 — "reports to" is another committee, or nothing.
  //
  // It used to be a committee OR A ROLE, and both this comment and the interface
  // claimed the two were mutually exclusive, "enforced in CommitteeService". No
  // such check ever existed: create() validated each id independently and wrote
  // both. The only thing that enforced it was a three-way toggle in the form.
  // Removing the role half therefore deletes two false claims, not a safeguard.
  //
  // The owning unit above is a separate, always-present fact, not an alternative
  // to this one.
  @IsString()
  @IsOptional()
  reportingToCommitteeId?: string;
}
