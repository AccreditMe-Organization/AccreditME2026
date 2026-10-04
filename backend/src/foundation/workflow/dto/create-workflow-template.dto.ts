import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

const WORKFLOW_OBJECT_TYPES = [
  'DOCUMENT_REQUEST',
  'DOCUMENT',
  'CHANGE_REQUEST',
  'INCIDENT',
  'AUDIT',
  'CORRECTIVE_ACTION',
  'MEETING',
  'COMMITTEE',
] as const;

export class CreateWorkflowTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameEn!: string;

  // ACC-160 — optional, because Arabic fields are never mandatory. An empty
  // value stores NULL rather than '' (see trimToNull). Update DTOs built with
  // PartialType inherit both halves.
  @IsString()
  @IsOptional()
  @MaxLength(100)
  @Transform(trimToNull)
  nameAr?: string | null;

  @IsIn(WORKFLOW_OBJECT_TYPES)
  objectType!: (typeof WORKFLOW_OBJECT_TYPES)[number];

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
