import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

// ACC-190 — a stage task definition, as the workflow settings screen sends it.
// The route fields a kind needs or forbids are checked in the service (one
// refusal code, STAGE_TASK_ROUTE_INCOMPLETE), because they depend on the kind
// AND on what the definition already holds when it is a PATCH.

export const STAGE_TASK_ASSIGN_KINDS = [
  'POSITION',
  'RECORD_UNIT_POSITION',
  'COMMITTEE_ROLE',
  'RECORD_COMMITTEE_ROLE',
] as const;
export type StageTaskAssignKindValue = (typeof STAGE_TASK_ASSIGN_KINDS)[number];

const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateStageTaskDefinitionDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  titleEn!: string;

  // ACC-160 — never mandatory; an empty Arabic title is stored as NULL.
  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(255)
  titleAr?: string | null;

  @IsOptional()
  @Transform(trimToNull)
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsBoolean()
  isMandatory!: boolean;

  @IsOptional()
  @IsBoolean()
  requiresEvidence?: boolean;

  @IsIn(TASK_PRIORITIES)
  priority!: (typeof TASK_PRIORITIES)[number];

  // ROLE is not on this list, so it cannot be sent: a task goes to where the
  // work sits (ACC-167).
  @IsIn(STAGE_TASK_ASSIGN_KINDS)
  assignKind!: StageTaskAssignKindValue;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  orgUnitId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  positionId?: string | null;

  // Optional on POSITION: a person in that position gets the task directly.
  // Sending null clears it on a PATCH.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeId?: string | null;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  committeeRoleValueId?: string | null;
}

export class UpdateStageTaskDefinitionDto extends PartialType(CreateStageTaskDefinitionDto) {}

export class ReorderStageTaskDefinitionsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  ids!: string[];
}
