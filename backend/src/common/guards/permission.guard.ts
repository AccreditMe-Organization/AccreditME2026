// PermissionGuard — enforces @Permissions() metadata on every route.
//
// ⚠ STUB UNTIL STEP 5 (Roles module) ⚠
//   Currently ALL authenticated requests pass this guard regardless of
//   the @Permissions() decorator. This is intentional — the Role and
//   Permission tables exist but the service layer to load user permissions
//   is built in Step 5. Do NOT rely on this guard for access control
//   until Step 5 is complete and the TODO below is resolved.
//
// Activation checklist (Step 5):
//   1. In TenantGuard, after JWT verification, load the user's roles from DB.
//   2. Resolve each role's permission strings via RolePermission → Permission.
//   3. Set request.userPermissions = string[] on the request object.
//   4. Remove the early-return bypass in canActivate below.

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

    // TODO(Step 5 — Roles): remove this bypass once request.userPermissions
    // is populated by TenantGuard. Until then all authenticated requests pass.
    if (userPermissions.length === 0) return true;

    const hasPermission = required.some((p) => userPermissions.includes(p));
    if (!hasPermission) {
      throw new ForbiddenException(
        `Required permission: ${required.join(' | ')}`,
      );
    }

    return true;
  }
}
