import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

export class CreateRoleDto {
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

  // Initial permission set, format "module:action". Validated against the
  // Permission table in the service. Never persisted directly from here —
  // createRole() always forces key=null, isSystem=false regardless of input.
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  permissionKeys?: string[];
}
