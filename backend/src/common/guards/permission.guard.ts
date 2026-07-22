// PermissionGuard — enforces @Permissions() metadata on every route.
//
// Active since Step 4 (Roles module). TenantGuard populates
// request.userPermissions via PERMISSION_RESOLVER before this guard runs.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
  userPermissions?: string[];
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );

    if (!required || required.length === 0) return true;

    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const userPermissions = request.userPermissions ?? [];

    const hasPermission = required.some((p) => userPermissions.includes(p));
    if (!hasPermission) {
      throw new ForbiddenException(
        `Required permission: ${required.join(' | ')}`,
      );
    }

    return true;
  }
}
