import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

// ACC-177 — the tenant admin's storage settings. Secrets (both keys) are
// WRITE-ONLY: sent to change them, omitted to keep the stored ones, and never
// read back — GET /tenant/storage answers "set" or null.
//
// The same body is what POST /tenant/storage/test takes as a candidate: it is
// tested, merged with the stored secrets, and saved nowhere.

export const STORAGE_PROVIDER_VALUES = ['S3', 'MINIO', 'LOCAL_FILESYSTEM'] as const;

export class MinioSettingsDto {
  // http is accepted here and refused by the resolver unless the installation
  // allows private endpoints (Tier 2/3); the message then says why.
  @IsOptional()
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  endpoint?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,32}$/, { message: 'region must look like a storage region, for example us-east-1' })
  region?: string;

  // S3 bucket naming: 3–63 characters, lower-case letters, digits, dots and
  // hyphens, starting and ending with a letter or digit.
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, { message: 'bucket must be a valid bucket name' })
  bucket?: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(256)
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  secretAccessKey?: string;
}

export class LocalFolderSettingsDto {
  // Relative to the installation's LOCAL_STORAGE_BASE; the resolver confines
  // it there. Segments of letters, digits, dot, underscore and hyphen.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^(?!.*(^|\/)\.\.?(\/|$))[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/, {
    message: 'rootPath must be a relative folder path',
  })
  rootPath?: string;
}

export class UpdateStorageSettingsDto {
  @IsIn(STORAGE_PROVIDER_VALUES)
  provider!: (typeof STORAGE_PROVIDER_VALUES)[number];

  @IsOptional()
  @ValidateNested()
  @Type(() => MinioSettingsDto)
  minio?: MinioSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => LocalFolderSettingsDto)
  local?: LocalFolderSettingsDto;
}

// POST /tenant/storage/test — every field optional: an empty body tests the
// stored settings; a body is a candidate, merged with the stored secrets.
export class TestStorageSettingsDto extends PartialType(UpdateStorageSettingsDto) {}
