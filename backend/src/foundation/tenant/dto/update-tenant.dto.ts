import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  timezone?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  language?: string;

  @IsIn(['LOCAL', 'AZURE_AD', 'GOOGLE'])
  @IsOptional()
  authProvider?: 'LOCAL' | 'AZURE_AD' | 'GOOGLE';

  @IsIn(['S3', 'MINIO', 'LOCAL_FILESYSTEM'])
  @IsOptional()
  storageProvider?: 'S3' | 'MINIO' | 'LOCAL_FILESYSTEM';

  @IsIn(['ANTHROPIC', 'AZURE_OPENAI', 'OPENAI', 'OLLAMA'])
  @IsOptional()
  aiProvider?: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';

  // S3 key, typed BY HAND into a text box on the tenant's own Settings screen.
  //
  // CORRECTED 2026-10-03, same sweep as login.dto.ts. This read: "uploaded
  // separately via the existing signed-upload flow, this field only ever
  // receives the resulting key, never a raw file (ACC-13)." THERE IS NO
  // SIGNED-UPLOAD FLOW. No upload endpoint, no FileInterceptor, no signed-URL
  // issuance, and no S3 bucket provisioned at all (CLAUDE.md, File Upload
  // Security — measured 2026-10-01). The second half is accurate by accident:
  // the field never receives a raw file because nothing can send one.
  //
  // What actually reaches it: organization-profile.component.ts renders
  // <input placeholder="S3 key"> to a tenant administrator, who types a
  // storage path. The design removes that field; until then this is what the
  // column holds.
  @IsString()
  @IsOptional()
  @MaxLength(500)
  logo?: string;
}
