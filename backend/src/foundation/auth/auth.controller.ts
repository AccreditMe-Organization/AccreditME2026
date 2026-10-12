import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { TenantGuard } from '../../common/guards/tenant.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { ImpersonatedBy } from '../../common/decorators/impersonated-by.decorator';
import { UserService } from '../user/user.service';
import { WorkingCalendarService } from '../working-calendar/working-calendar.service';
import { AuthService } from './auth.service';
import { RATE_LIMITS } from '../../common/throttle/rate-limits';
import { perAddress } from '../../common/throttle/throttle.config';
import { LimitResetsPerEmail } from '../../common/throttle/accreditme-throttler.guard';
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
// other controller in this codebase (see step-09 plan, Commit 3). The
// self-service routes (/me and the MFA routes) are guarded individually.
// /logout is NOT guarded any more (ACC-203): it must work after the access
// cookie has expired, and finds the caller's identity for the audit log itself.
//
// Zero business logic here — AuthService does everything, per CLAUDE.md's
// NestJS Conventions.
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly workingCalendarService: WorkingCalendarService,
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
    // ACC-94 (D2) — timeZone and hijriDisplay join language as the display
    // context: the zone is the one the SLA engine computes due dates in
    // (WorkingCalendarService, decision D3), the calendar is the user's own.
    // Additive and read-only; nothing here writes.
    const [language, timeZone, hijriDisplay] = await Promise.all([
      this.authService.resolveLanguage(user.language, organizationId),
      this.workingCalendarService.getEffectiveTimeZone(organizationId),
      this.userService.getHijriDisplay(userId, organizationId),
    ]);
    return { id: user.id, email: user.email, name: user.name, language, timeZone, hijriDisplay, impersonatedBy };
  }

  // ACC-129 — the public auth routes each have their own limit, counted per
  // address (common/throttle/rate-limits.ts). Generous on sign-in: the
  // per-account lockout is what stops password guessing.
  @Post('login')
  @perAddress(RATE_LIMITS.login)
  @HttpCode(HttpStatus.OK)
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(dto, req, res);
  }

  @Post('mfa/verify')
  @perAddress(RATE_LIMITS.mfaVerify)
  @HttpCode(HttpStatus.OK)
  verifyMfa(
    @Body() dto: VerifyMfaDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.verifyMfa(dto, req, res);
  }

  // ACC-120 slice 9b — abandon a pending sign-in MFA challenge. Unauthenticated
  // like login: the caller is mid-sign-in and has no session yet. Clears only
  // the challenge named by this browser's own signed cookie.
  @Post('mfa/cancel')
  @HttpCode(HttpStatus.OK)
  cancelMfa(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.cancelMfa(req, res);
  }

  @Post('refresh')
  @perAddress(RATE_LIMITS.refresh)
  @HttpCode(HttpStatus.OK)
  refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.refresh(req, res);
  }

  // ACC-203 — PUBLIC on purpose. Behind TenantGuard, a sign-out after an idle
  // wait (frozen tab, slept laptop) arrived with the 15-minute access cookie
  // already gone, got a 401, and revoked nothing — so the next visit renewed
  // the session. It now always answers 200 and revokes whatever refresh token
  // the browser presents (AuthService.logout()). Still rate-limited: with no
  // valid session the global guard counts it per address (ACC-129).
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authService.logout(req, res);
  }

  // ACC-120 slice 9c — which organisation is inviting the holder of a token.
  // Public, like accept-invitation: the caller has no account yet. POST so the
  // token travels in the body and never lands in a URL or an access log. The
  // body is `unknown` on purpose — see AuthService.lookupInvitation().
  @Post('invitations/lookup')
  @perAddress(RATE_LIMITS.invitationLookup)
  @HttpCode(HttpStatus.OK)
  lookupInvitation(@Body() body: unknown) {
    return this.authService.lookupInvitation(body);
  }

  @Post('accept-invitation')
  @perAddress(RATE_LIMITS.acceptInvitation)
  @HttpCode(HttpStatus.OK)
  acceptInvitation(@Body() dto: AcceptInvitationDto) {
    return this.authService.acceptInvitation(dto);
  }

  // Two limits: per address, and per organisation + email — so nobody can
  // flood one inbox, or the Resend quota, from many addresses.
  @Post('forgot-password')
  @perAddress(RATE_LIMITS.forgotPassword)
  @LimitResetsPerEmail()
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @perAddress(RATE_LIMITS.resetPassword)
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
