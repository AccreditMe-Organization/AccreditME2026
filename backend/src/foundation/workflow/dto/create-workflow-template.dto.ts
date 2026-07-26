import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

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

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  nameAr!: string;

  @IsIn(WORKFLOW_OBJECT_TYPES)
  objectType!: (typeof WORKFLOW_OBJECT_TYPES)[number];

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
