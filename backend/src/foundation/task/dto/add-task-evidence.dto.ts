import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator';

// ACC-163 (Q11) — new evidence is a LINK or an INTERNAL_REFERENCE, nothing
// else. TEXT is gone because a note is a comment, not proof. ATTACHMENT waits
// for the storage tickets: there is no upload endpoint, and this DTO used to
// accept a caller-supplied s3Key for a file nobody had uploaded.
//
// The enum keeps all four values and existing rows are untouched — this
// governs what may be ADDED, not what was.
//
// With forbidNonWhitelisted on app-wide, sending a removed field (content,
// s3Key, fileName, …) is a 400 rather than silently ignored.
export const TASK_EVIDENCE_INPUT_TYPES = ['LINK', 'INTERNAL_REFERENCE'] as const;

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
  @IsIn(TASK_EVIDENCE_INPUT_TYPES)
  type!: (typeof TASK_EVIDENCE_INPUT_TYPES)[number];

  // LINK — http or https only. The URL is rendered as a link, and a
  // `javascript:` or `data:` URL would run in whoever clicks it. A TLD is not
  // required: hospital intranets are commonly reached by a bare host name.
  @ValidateIf((o: AddTaskEvidenceDto) => o.type === 'LINK')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(2000)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  linkTitle?: string;

  // INTERNAL_REFERENCE — refDisplay is resolved and cached server-side, never
  // trusted from the client.
  @ValidateIf((o: AddTaskEvidenceDto) => o.type === 'INTERNAL_REFERENCE')
  @IsIn(TASK_EVIDENCE_REF_TYPES)
  refType?: (typeof TASK_EVIDENCE_REF_TYPES)[number];

  @ValidateIf((o: AddTaskEvidenceDto) => o.type === 'INTERNAL_REFERENCE')
  @IsString()
  @IsNotEmpty()
  refId?: string;
}
