import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

// organizationSlug resolves the tenant BEFORE authentication succeeds — there
// is no JWT yet at login time for TenantGuard to read organizationId from.
// That first sentence is true. The rest of what used to be here was not.
//
// CORRECTED 2026-10-03. This comment previously read: "The Angular login page
// resolves this from the subdomain in production, or a configured value in
// local dev — see auth.service.ts's resolveOrganizationId()." EVERY CLAUSE OF
// THAT WAS FALSE, and it was read by whoever next built against this DTO:
//
//   - The Angular login page does NOT resolve the slug. It renders
//     organizationSlug as a REQUIRED TEXT BOX and asks the person to type it
//     (login.component.ts, Validators.required).
//   - There is no subdomain logic anywhere in the frontend — no hostname read,
//     no location parse. `window.location` appears three times in the whole
//     application and every one is a full-page redirect.
//   - There is no "configured value in local dev" either.
//   - resolveOrganizationId() is a PRIVATE method on the BACKEND AuthService
//     (slug -> id, this file's sibling). The frontend has no such method, and
//     pointing a frontend claim at a backend private was the tell.
//
// So a hospital employee is currently asked to type their tenant's slug to
// sign in. Whether that stays is Ahmad's design decision, not something to
// infer from a comment — it is open, and this comment describes what the code
// DOES rather than what someone intended.
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
