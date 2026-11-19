import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { TenantGuard } from '../../../common/guards/tenant.guard';
import { PermissionGuard } from '../../../common/guards/permission.guard';
import { CurrentTenant } from '../../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { CurrentUserPermissions } from '../../../common/decorators/current-user-permissions.decorator';
import { ImpersonatedBy } from '../../../common/decorators/impersonated-by.decorator';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { SessionStartedAt } from '../../../common/decorators/session-started-at.decorator';
import { USERS_PERMISSIONS } from '../../../common/constants/permissions';
import { REFRESH_TOKEN_COOKIE } from '../../../common/config/session-cookies';
import { SessionsEnded, UserSessionsService } from './user-sessions.service';
import { IUserSessions } from './user-sessions.interface';

/**
 * ACC-216 — a person's sign-ins, beside UserController under the same prefix
 * (as UserCommitteesController is). Routing only: every rule is the service's.
 *
 * The read carries no @Permissions(): the rule is yourself, OR users:view plus
 * users:manage_sessions, so the service checks it before any read
 * (assertMayReadSessions()). "Sign out everywhere" is never yourself, so it
 * carries its key; the service checks users:view and the account-action rule.
 */
@Controller('users')
@UseGuards(TenantGuard, PermissionGuard)
export class UserSessionsController {
  constructor(private readonly sessions: UserSessionsService) {}

  @Get(':userId/sessions')
  list(
    @Param('userId') userId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() permissions: string[],
    @SessionStartedAt() sessionStartedAt: Date | undefined,
  ): Promise<IUserSessions> {
    return this.sessions.list(tenantId, { id: actorId, permissions, sessionStartedAt }, userId);
  }

  @Post(':userId/sessions/end-all')
  @Permissions(USERS_PERMISSIONS.MANAGE_SESSIONS)
  @HttpCode(HttpStatus.OK)
  endEverywhere(
    @Param('userId') userId: string,
    @CurrentTenant() tenantId: string,
    @CurrentUser() actorId: string,
    @CurrentUserPermissions() permissions: string[],
    @ImpersonatedBy() impersonatedBy: string | undefined,
  ): Promise<SessionsEnded> {
    return this.sessions.endEverywhere(tenantId, { id: actorId, permissions, impersonating: impersonatedBy !== undefined }, userId);
  }
}

/**
 * ACC-216 — your OWN sign-ins. Under /auth on purpose: the refresh cookie's path
 * is /api/v1/auth (ACC-203), so only here does the server receive it and know,
 * by its hash, which sign-in is the one you are using. TenantGuard only: these
 * act on the caller alone, so there is no permission to hold.
 */
@Controller('auth/sessions')
@UseGuards(TenantGuard)
export class OwnSessionsController {
  constructor(private readonly sessions: UserSessionsService) {}

  @Post('end-others')
  @HttpCode(HttpStatus.OK)
  endOthers(
    @Req() req: Request,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @ImpersonatedBy() impersonatedBy: string | undefined,
  ): Promise<SessionsEnded> {
    return this.sessions.endOtherOwn(tenantId, { id: userId, impersonating: impersonatedBy !== undefined }, cookieOf(req));
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  endOne(
    @Param('id') sessionId: string,
    @Req() req: Request,
    @CurrentTenant() tenantId: string,
    @CurrentUser() userId: string,
    @ImpersonatedBy() impersonatedBy: string | undefined,
  ): Promise<SessionsEnded> {
    return this.sessions.endOwn(tenantId, { id: userId, impersonating: impersonatedBy !== undefined }, cookieOf(req), sessionId);
  }
}

function cookieOf(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_TOKEN_COOKIE];
  return typeof value === 'string' ? value : undefined;
}
