import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// organizationSlug resolves the tenant BEFORE authentication succeeds — there
// is no JWT yet at login time for TenantGuard to read organizationId from.
// The Angular login page resolves this from the subdomain in production, or
// a configured value in local dev — see auth.service.ts's resolveOrganizationId().
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  organizationSlug!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
