import {
  IsEmail,
  IsNotEmpty,
  IsNotIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import {
  DNS_LABEL,
  RESERVED_SLUGS,
} from '../../../common/tenant/reserved-slugs';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsString()
  @IsNotEmpty()
  // ACC-139 — the slug is the tenant's address, {slug}.accreditme.app, so it
  // must be a DNS label and must not be a name reserved for us.
  @Matches(DNS_LABEL, {
    message:
      'slug must be lowercase letters, numbers and hyphens, start and end with a letter or number, and not start with xn--',
  })
  @IsNotIn([...RESERVED_SLUGS], { message: 'slug is reserved: choose another' })
  @MaxLength(63)
  slug!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  country!: string;

  @IsString()
  @IsOptional()
  planId?: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  adminName!: string;
}
