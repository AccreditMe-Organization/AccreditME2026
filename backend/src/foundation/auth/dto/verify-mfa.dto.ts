import { IsNotEmpty, IsString, Length } from 'class-validator';

// No organizationSlug/challengeToken field needed — Better Auth's own
// two-factor-pending cookie (set on the /auth/login response when MFA is
// required, read back automatically by the browser on this call) carries
// that context. See auth.service.ts's verifyMfa().
export class VerifyMfaDto {
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  code!: string;
}
