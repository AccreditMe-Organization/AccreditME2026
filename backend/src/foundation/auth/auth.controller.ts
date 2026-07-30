import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ImpersonatedBy } from '../../common/decorators/impersonated-by.decorator';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { VerifyMfaDto } from './dto/verify-mfa.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetupMfaDto } from './dto/setup-mfa.dto';
import { VerifySetupMfaDto } from './dto/verify-setup-mfa.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';

// Every endpoint here is deliberately pre-authentication or self-service —
// no @UseGuards(TenantGuard, PermissionGuard) at class level, unlike every
// other controller in this codebase (see step-09 plan, Commit 3). /logout is
// the one exception, guarded individually, since it needs the caller's
// identity for the audit log entry.
//
// Zero business logic here — AuthService does everything, per CLAUDE.md's
// NestJS Conventions.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {}

  // Session-restore endpoint (Step 9 follow-up) — reads the access_token
  // cookie via TenantGuard exactly like every other guarded endpoint; there is
  // no separate cookie-parsing here. Returns 401 (via TenantGuard) if the
  // cookie is missing, expired, or its tokenVersion is stale.
  @Get('me')
  @UseGuards(TenantGuard)
  async getMe(
    @CurrentUser() userId: string,
    @CurrentTenant() organizationId: string,
    @ImpersonatedBy() impersonatedByUserId: string | undefined,
  ) {
    const user = await this.userService.getById(userId, organizationId);
    const impersonatedBy = impersonatedByUserId
      ? await this.authService.getPublicUserById(impersonatedByUserId)
      : null;
    return { id: user.id, email: user.email, name: user.name, impersonatedBy };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto, req, res);
  }

  @Post('mfa/verify')
  @HttpCode(HttpStatus.OK)
  verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.verifyMfa(dto, req, res);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.refresh(req, res);
  }

  @Post('logout')
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req, res);
  }

  @Post('accept-invitation')
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // MFA enrollment (Step 9 follow-up) — distinct from the pre-auth
  // 'mfa/verify' endpoint above (which confirms a pending sign-in 2FA
  // challenge). These four require an existing AccreditMe session
  // (TenantGuard) since they manage MFA for the already-logged-in user.
  @Post('mfa/setup')
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  setupMfa(
    @Body() dto: SetupMfaDto,
    @CurrentUser() userId: string,
    @CurrentTenant() organizationId: string,
  ) {
    return this.authService.setupMfa(userId, organizationId, dto);
  }

  @Post('mfa/setup/verify')
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  verifySetupMfa(
    @Body() dto: VerifySetupMfaDto,
    @CurrentUser() userId: string,
    @CurrentTenant() organizationId: string,
  ) {
    return this.authService.verifySetupMfa(userId, organizationId, dto);
  }

  @Post('mfa/disable')
  @UseGuards(TenantGuard)
  @HttpCode(HttpStatus.OK)
  disableMfa(
    @Body() dto: DisableMfaDto,
    @CurrentUser() userId: string,
    @CurrentTenant() organizationId: string,
  ) {
    return this.authService.disableMfa(userId, organizationId, dto);
  }

  @Get('mfa/status')
  @UseGuards(TenantGuard)
  getMfaStatus(@CurrentUser() userId: string, @CurrentTenant() organizationId: string) {
    return this.authService.getMfaStatus(userId, organizationId);
  }
}
