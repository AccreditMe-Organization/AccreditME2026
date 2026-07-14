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
}
