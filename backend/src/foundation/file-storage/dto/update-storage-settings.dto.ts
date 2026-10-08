import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsIn, IsISO8601, IsOptional, IsString, IsUrl, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';

// ACC-177 — the tenant admin's storage settings. Secrets (both keys) are
// WRITE-ONLY: sent to change them, omitted to keep the stored ones, and never
// read back — GET /tenant/storage answers "set" or null.
//
// The same body is what POST /tenant/storage/test takes as a candidate: it is
// tested, merged with the stored secrets, and saved nowhere.

export const STORAGE_PROVIDER_VALUES = ['S3', 'MINIO', 'LOCAL_FILESYSTEM', 'SHAREPOINT'] as const;

const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// ACC-185 — the customer's own SharePoint app and one library, entered by the
// tenant admin from the customer guide (docs/customer/sharepoint-storage-setup.md).
// The client secret is WRITE-ONLY like the MinIO secret: send it to set or
// replace it, omit it to keep the stored one; GET answers "set".
export class SharePointSettingsDto {
  // A GUID, or a domain — Microsoft's token endpoint takes either.
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+)$/, {
    message: 'tenant must be a tenant ID or a domain such as contoso.onmicrosoft.com',
  })
  tenant?: string;

  @IsOptional()
  @IsString()
  @Matches(GUID, { message: 'clientId must be the Application (client) ID' })
  clientId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(512)
  clientSecret?: string;

  // Checked properly (https, a .sharepoint.com host) when used; this only
  // bounds it.
  @IsOptional()
  @IsString()
  @MaxLength(500)
  siteUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  libraryName?: string;

  // The fallback inputs (Q2), from the guide's PowerShell output. A site id is
  // "{host},{site-collection guid},{web guid}".
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9.-]+,[0-9a-fA-F-]{36},[0-9a-fA-F-]{36}$/, { message: 'siteId must be the Site ID from the setup guide' })
  siteId?: string;

  @IsOptional()
  @IsString()
  @Matches(GUID, { message: 'listId must be the Library ID from the setup guide' })
  listId?: string;

  @IsOptional()
  @IsString()
  // The shape, then a real calendar day (strict ISO 8601 refuses 2026-02-31).
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'secretExpiresOn must be a date, YYYY-MM-DD' })
  @IsISO8601({ strict: true }, { message: 'secretExpiresOn must be a real date' })
  secretExpiresOn?: string;
}

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

  @IsOptional()
  @ValidateNested()
  @Type(() => SharePointSettingsDto)
  sharepoint?: SharePointSettingsDto;
}

// POST /tenant/storage/test — every field optional: an empty body tests the
// stored settings; a body is a candidate, merged with the stored secrets.
export class TestStorageSettingsDto extends PartialType(UpdateStorageSettingsDto) {}

// POST /tenant/storage/change-request — an optional note for AccreditMe.
export class StorageChangeRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
