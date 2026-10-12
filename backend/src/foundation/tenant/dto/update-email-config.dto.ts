import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { EMAIL_PROVIDERS, EmailProvider, SMTP_ENCRYPTIONS, SmtpEncryption } from '../email-config';

/*
 * ACC-181 — a tenant's email provider settings, typed per provider. Replaces
 * the untyped `{ emailProvider, config }`: the global ValidationPipe's
 * forbidNonWhitelisted now refuses `config`, `emailProvider` and any field a
 * provider does not have.
 *
 * WRITE-ONLY SECRETS (apiKey, password, clientSecret, secretAccessKey): send a
 * new value to replace the stored one; omit it, or send '', to keep it. A
 * secret is never returned.
 *
 * Every field is optional HERE because a save merges with what is stored;
 * whether the chosen provider ends up COMPLETE is the service's check (400
 * EMAIL_SETTINGS_INCOMPLETE, naming the fields). An ordinary field sent as ''
 * is cleared, so its format is checked only when it holds a value.
 */

const filled = (field: string) => (o: Record<string, unknown>) => o[field] !== undefined && o[field] !== '';

const HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const AWS_REGION = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;
const AWS_ACCESS_KEY_ID = /^[A-Z0-9]{16,128}$/;

class SenderFields {
  @ValidateIf(filled('fromAddress'))
  @IsEmail()
  @MaxLength(254)
  fromAddress?: string;
}

class SenderWithNameFields extends SenderFields {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fromName?: string;
}

export class ResendEmailSettingsDto extends SenderWithNameFields {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

export class SmtpEmailSettingsDto extends SenderWithNameFields {
  @ValidateIf(filled('host'))
  @Matches(HOST, { message: 'host must be a host name or IP address' })
  host?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;

  @IsOptional()
  @IsIn(SMTP_ENCRYPTIONS)
  encryption?: SmtpEncryption;

  @IsOptional()
  @IsString()
  @MaxLength(254)
  username?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  password?: string;
}

export class Office365EmailSettingsDto extends SenderFields {
  @ValidateIf(filled('tenantId'))
  @IsUUID('all')
  tenantId?: string;

  @ValidateIf(filled('clientId'))
  @IsUUID('all')
  clientId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  clientSecret?: string;
}

export class SendGridEmailSettingsDto extends SenderWithNameFields {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;
}

export class SesEmailSettingsDto extends SenderFields {
  @ValidateIf(filled('region'))
  @Matches(AWS_REGION, { message: 'region must be an AWS region, such as eu-central-1' })
  region?: string;

  @ValidateIf(filled('accessKeyId'))
  @Matches(AWS_ACCESS_KEY_ID, { message: 'accessKeyId must be an AWS access key ID' })
  accessKeyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  secretAccessKey?: string;
}

export class UpdateEmailConfigDto {
  @IsIn(EMAIL_PROVIDERS)
  provider!: EmailProvider;

  // Only the chosen provider's block is read; the others are ignored, and only
  // the chosen one is stored.
  @IsOptional()
  @ValidateNested()
  @Type(() => ResendEmailSettingsDto)
  resend?: ResendEmailSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SmtpEmailSettingsDto)
  smtp?: SmtpEmailSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => Office365EmailSettingsDto)
  office365?: Office365EmailSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SendGridEmailSettingsDto)
  sendgrid?: SendGridEmailSettingsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SesEmailSettingsDto)
  ses?: SesEmailSettingsDto;
}
