import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

export class OverrideLabelDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  labelOverrideEn!: string;

  // ACC-160 — optional, because Arabic fields are never mandatory. An empty
  // value stores NULL rather than '' (see trimToNull). Update DTOs built with
  // PartialType inherit both halves.
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(trimToNull)
  labelOverrideAr?: string | null;
}
