import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normaliseEmail } from '../../../common/utils/normalise-email.transform';

// organizationSlug resolves the tenant BEFORE authentication succeeds — there
// is no JWT yet at login time for TenantGuard to read organizationId from.
// The Angular login page resolves this from the subdomain in production, or
// a configured value in local dev — see auth.service.ts's resolveOrganizationId().
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  organizationSlug!: string;

  // Trimmed and lower-cased, so the lockout and Better Auth key on one
  // spelling — see normalise-email.transform.ts.
  @Transform(normaliseEmail)
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
