import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

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

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  nameAr!: string;

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

  // Mutually exclusive with reportingToRoleId — enforced in
  // CommitteeService, each with its OWN distinct org-scoped validation
  // query (a Committee lookup vs. a Role lookup — two different Prisma
  // models, never a single shared helper that only checks one).
  // (ACC-22 Pending Discussion #4.)
  @IsString()
  @IsOptional()
  reportingToCommitteeId?: string;

  @IsString()
  @IsOptional()
  reportingToRoleId?: string;
}
