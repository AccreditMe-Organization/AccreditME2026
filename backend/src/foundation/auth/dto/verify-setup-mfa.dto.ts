import { IsNotEmpty, IsString, Length } from 'class-validator';

// Distinct from VerifyMfaDto (used for the login-time 2FA challenge) even
// though the shape matches today — this confirms a just-generated TOTP
// secret during enrollment, a different Better Auth session context. See
// auth.service.ts's verifySetupMfa().
export class VerifySetupMfaDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code!: string;
}
