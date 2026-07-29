// PlatformGuard — gates the Super Admin Portal (ACC-13).
//
// Two independent checks, both required (see step-12-admin-portal.md
// Section 1/8): the caller's own organization must be the one designated
// AccreditMe platform org (Organization.isPlatformOrg), AND the caller must
// hold platform:admin. Neither alone is sufficient — this is the fix for a
// real gap found during planning: SYSTEM_ROLE_SEED seeds a PLATFORM_ADMIN
// role (holding platform:admin) into EVERY tenant's own Role table, so
// platform:admin alone (checked the normal PermissionGuard way) would let any
// tenant admin who self-assigns that role in their own org pass straight
// through. Always used as @UseGuards(TenantGuard, PlatformGuard) — never
// PermissionGuard, never without TenantGuard first (needs request.tenantId/
// request.userPermissions, both populated by TenantGuard).

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_PERMISSIONS } from '../constants/permissions';

interface AuthenticatedRequest extends Request {
  tenantId: string;
  userId: string;
  userPermissions?: string[];
}

@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();

    const org = await this.prisma.organization.findUnique({
      where: { id: request.tenantId },
      select: { isPlatformOrg: true },
    });

    if (!org?.isPlatformOrg) {
      throw new ForbiddenException(
        'Platform admin access requires an AccreditMe platform account',
      );
    }

    const userPermissions = request.userPermissions ?? [];
    if (!userPermissions.includes(PLATFORM_PERMISSIONS.ADMIN)) {
      throw new ForbiddenException('Requires platform:admin permission');
    }

    return true;
  }
}
