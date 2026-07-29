import { IsNotEmpty, IsString } from 'class-validator';

// Better Auth's own disableTwoFactor endpoint requires the caller's current
// password (createBetterAuthInstance() never sets allowPasswordless) — see
// auth.service.ts's disableMfa().
export class DisableMfaDto {
  @IsString()
  @IsNotEmpty()
  password!: string;
}
