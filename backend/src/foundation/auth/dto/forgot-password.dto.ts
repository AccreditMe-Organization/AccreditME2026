import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normaliseEmail } from '../../../common/utils/normalise-email.transform';

export class ForgotPasswordDto {
  @IsString()
  @IsNotEmpty()
  organizationSlug!: string;

  // Trimmed and lower-cased, the same as LoginDto: one spelling for every
  // email a person types to identify themselves (normalise-email.transform.ts).
  @Transform(normaliseEmail)
  @IsEmail()
  email!: string;
}
