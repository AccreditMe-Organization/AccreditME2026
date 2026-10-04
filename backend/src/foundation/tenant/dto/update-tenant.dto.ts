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

  /**
   * ACC-120 — the Arabic half of the organisation's name pair.
   *
   * OPTIONAL, because this DTO is PATCH-shaped and serves screens that have
   * nothing to do with the name: making it required would break every
   * unrelated tenant update. The REQUIREMENT lives on Organization Profile,
   * which refuses to save without it. Those are different promises and the
   * column is nullable precisely because only the weaker one is enforced
   * everywhere.
   *
   * AN EMPTY VALUE BECOMES NULL RATHER THAN BEING REFUSED, and this supersedes
   * what I said when the migration was approved ("an explicitly empty value is
   * refused, so the pair cannot be cleared"). Refusing it is the worse of the
   * two:
   *
   *   - a PATCH DTO that 400s on '' makes the form's own clear-the-field path
   *     fail with a validation error rather than doing the obvious thing, and
   *   - storing '' would be worse than storing null, because every future
   *     reader would then have to treat two different falsy values as "no
   *     Arabic name" — which is exactly how a `nameAr || name` fallback comes
   *     to be written in nine places with two different behaviours.
   *
   * So the column holds a real name or null, never an empty string, and the
   * screen is what stops a tenant clearing it by accident.
   */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  })
  nameAr?: string | null;

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

  // S3 key — uploaded separately via the existing signed-upload flow, this
  // field only ever receives the resulting key, never a raw file (ACC-13).
  @IsString()
  @IsOptional()
  @MaxLength(500)
  logo?: string;
}
