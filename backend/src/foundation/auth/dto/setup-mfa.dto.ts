import { IsNotEmpty, IsString } from 'class-validator';

// Better Auth's own enableTwoFactor endpoint requires the caller's current
// password (createBetterAuthInstance() never sets allowPasswordless) — see
// auth.service.ts's setupMfa().
export class SetupMfaDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
