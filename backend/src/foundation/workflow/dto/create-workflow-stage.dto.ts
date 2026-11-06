import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { StageWhoDto } from './stage-who.dto';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

// ACC-271 PR 6b — no old people field (the assignee, approval and threshold
// columns): who works a stage is `who` alone. The global whitelist refuses one
// sent anyway, 400 "property X should not exist".
export class CreateWorkflowStageDto {
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

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsInt()
  @Min(0)
  order!: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  slaWorkingHours?: number;

  @IsBoolean()
  @IsOptional()
  isInitial?: boolean;

  @IsBoolean()
  @IsOptional()
  isFinal?: boolean;

  @IsArray()
  @IsOptional()
  escalationConfig?: Record<string, unknown>[];

  // ACC-255 — what this stage allows to be done to the record, as action keys
  // from RECORD_ACTIONS (record-registry.ts). The set REPLACES the stage's
  // own; omitted leaves it. Keys are checked against the template's record
  // type in the service (STAGE_ACTION_UNKNOWN), not here.
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  actions?: string[];

  // ACC-255 — what this stage means, as flag keys from STAGE_FLAGS. Replaces
  // the stage's own; omitted leaves it (STAGE_FLAG_UNKNOWN in the service).
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  flags?: string[];

  // ACC-271 PR 3 / 5-be — who works the stage. On create it is required (the
  // service refuses a stage without it, WHO_REQUIRED, PR 6a) and written in the
  // transaction that creates the stage; on update (inherited by
  // UpdateWorkflowStageDto) it REPLACES the stage's entries and sets how they
  // decide, and omitted leaves them.
  @IsOptional()
  @ValidateNested()
  @Type(() => StageWhoDto)
  who?: StageWhoDto;
}
