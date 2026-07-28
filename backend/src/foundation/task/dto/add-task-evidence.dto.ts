import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

const TASK_EVIDENCE_TYPES = ['TEXT', 'ATTACHMENT', 'LINK', 'INTERNAL_REFERENCE'] as const;
const TASK_EVIDENCE_REF_TYPES = [
  'DOCUMENT',
  'AUDIT',
  'INCIDENT',
  'CAPA',
  'MEETING',
  'STANDARD',
  'CORRECTIVE_ACTION',
  'GAP',
] as const;

export class AddTaskEvidenceDto {
  @IsIn(TASK_EVIDENCE_TYPES)
  type!: (typeof TASK_EVIDENCE_TYPES)[number];

  // for TEXT
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  content?: string;

  // for ATTACHMENT (S3 upload already completed by the caller — this DTO
  // records the reference, matching CLAUDE.md's "signed URLs only" rule;
  // the actual upload flow is out of scope for this step)
  @IsString()
  @IsOptional()
  s3Key?: string;

  @IsString()
  @IsOptional()
  fileName?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  fileSize?: number;

  @IsString()
  @IsOptional()
  mimeType?: string;

  // for LINK
  @IsString()
  @IsOptional()
  @MaxLength(2000)
  url?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  linkTitle?: string;

  // for INTERNAL_REFERENCE — refDisplay is resolved and cached server-side,
  // never trusted from the client
  @IsIn(TASK_EVIDENCE_REF_TYPES)
  @IsOptional()
  refType?: (typeof TASK_EVIDENCE_REF_TYPES)[number];

  @IsString()
  @IsOptional()
  refId?: string;
}
