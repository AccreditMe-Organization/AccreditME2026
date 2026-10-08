import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { normaliseEmail } from '../../../common/utils/normalise-email.transform';

// organizationSlug resolves the tenant BEFORE authentication succeeds — there
// is no JWT yet at login time for TenantGuard to read organizationId from.
// Nobody types it (ACC-139): the Angular login page takes it from the address
// the person opened — the one label in front of the base domain,
// al-nakheel.accreditme.app in production and al-nakheel.localhost:4200
// locally (frontend core/tenant/tenant-host.ts). A host with no such label
// shows a note instead of a form, so the request is never sent without one.
// An unknown slug is answered exactly like a wrong password — see
// auth.service.ts's resolveOrganizationId().
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
