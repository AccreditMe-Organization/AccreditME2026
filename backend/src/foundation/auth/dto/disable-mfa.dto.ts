import { IsNotEmpty, IsString, Matches } from 'class-validator';

// ACC-164 — turning two-step sign-in off needs BOTH the password and a current
// code from the authenticator app (Ahmad). Better Auth's own disableTwoFactor
// also requires the password (allowPasswordless is never set) — see
// auth.service.ts's disableMfa().
export class DisableMfaDto {
  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be the 6-digit code from the authenticator app' })
  code!: string;
}
