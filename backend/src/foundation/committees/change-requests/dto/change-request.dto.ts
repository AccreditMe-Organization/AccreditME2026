import { OmitType, PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { CreateCommitteeDto } from '../../dto/create-committee.dto';

// ACC-239 — the change request's DTOs.

/**
 * The proposed values: the committee's own fields and validators, as an edit
 * in Formation takes them (ACC-238), less the terms-of-reference link (Q6: no
 * Document module to pick from yet). A field left out is not changing; a
 * field sent as null is cleared (the Arabic name, purpose, parent, reports to).
 */
export class CommitteeChangeValuesDto extends PartialType(OmitType(CreateCommitteeDto, ['termsOfReferenceDocumentId'] as const)) {}

export class CreateChangeRequestDto {
  @ValidateNested()
  @Type(() => CommitteeChangeValuesDto)
  changes!: CommitteeChangeValuesDto;

  // "Why is this change needed?" — required.
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  /** Create and submit for review in one call. */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdateChangeRequestDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CommitteeChangeValuesDto)
  changes?: CommitteeChangeValuesDto;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason?: string;

  /** The request's updatedAt as the page loaded it: a stale save is refused (CHANGE_REQUEST_CHANGED). */
  @IsOptional()
  @IsISO8601({ strict: true })
  expectedUpdatedAt?: string;
}

export class PreviewChangeRequestDto {
  @ValidateNested()
  @Type(() => CommitteeChangeValuesDto)
  changes!: CommitteeChangeValuesDto;
}

/** Return for changes: the note is required, and is what the requester reads. */
export class ReturnChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  note!: string;
}

/** Reject: the reason is required. */
export class RejectChangeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export const CHANGE_REQUEST_SORTS = ['number', 'status', 'requested'] as const;

/** The committee's list, for its panel and See all (ACC-234: sorted by column header). */
export class ChangeRequestListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @IsIn(CHANGE_REQUEST_SORTS)
  sort?: (typeof CHANGE_REQUEST_SORTS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}
