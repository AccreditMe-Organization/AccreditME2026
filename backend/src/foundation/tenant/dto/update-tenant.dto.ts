import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { trimToNull } from '../../../common/utils/trim-to-null.transform';

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
   * OPTIONAL AT EVERY LAYER, DELIBERATELY. The column is nullable, this DTO is
   * optional, and Organization Profile does NOT require it either.
   *
   * CORRECTED: an earlier version of this comment said "the REQUIREMENT lives
   * on Organization Profile, which refuses to save without it". That was wrong
   * and it contradicted a standing product decision — ARABIC FIELDS ARE NEVER
   * MANDATORY, because the product is sold to customers who do not operate in
   * Arabic. It is why Organization.nameAr, OrgUnit.nameAr, OrgPosition.nameAr,
   * PublicHoliday.nameAr and AiCreditPack.nameAr are all nullable: a rule, not
   * an accident of those slices.
   *
   * It also contradicted this ticket's own acceptance criteria, which say an
   * empty field stores null — only reachable if the screen lets the field be
   * empty. Shipping it as written would have added a seventh mandatory Arabic
   * field in the ticket that recorded six existing ones as defects.
   *
   * There is no stronger promise anywhere. An optional field whose empty value
   * stores null is the whole rule.
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
   * So the column holds a real name or null, never an empty string.
   */
  @IsString()
  @IsOptional()
  @MaxLength(255)
  // ACC-160 — the rule now lives in one place, shared with every other
  // optional bilingual name. This spec's own tests still pin it here.
  @Transform(trimToNull)
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

  // ACC-185 (Q6) — storageProvider is NOT settable here. Only
  // POST /tenant/storage/confirm writes it, and after confirmation the location
  // is AccreditMe's to change. This field used to be accepted and written
  // straight to the organisation, which let a tenant admin switch where files
  // go without the connection test or the post-confirmation lock; with
  // forbidNonWhitelisted, sending it is now a 400 rather than a silent switch.

  @IsIn(['ANTHROPIC', 'AZURE_OPENAI', 'OPENAI', 'OLLAMA'])
  @IsOptional()
  aiProvider?: 'ANTHROPIC' | 'AZURE_OPENAI' | 'OPENAI' | 'OLLAMA';

  // The organisation's logo, as a plain string. Nothing uploads a logo and
  // nothing shows one: there is no logo upload (ACC-177's file storage does not
  // cover it), Organization profile stopped sending this field when its S3-key
  // box was removed, and every place a logo would appear shows the monogram.
  // Whatever a caller sends here is saved as is (any string up to 500
  // characters) and returned as is by GET /tenant — it is not checked against
  // a stored file and is not turned into a signed URL.
  // Corrected 2026-10-08: this used to describe a "signed-upload flow" that
  // has never existed.
  @IsString()
  @IsOptional()
  @MaxLength(500)
  logo?: string;
}
