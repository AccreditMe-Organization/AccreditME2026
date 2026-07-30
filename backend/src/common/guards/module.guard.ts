// ModuleGuard — checks Organization.settings.modules per request (ACC-13).
//
// Ships with nothing to decorate yet (step-12-admin-portal.md Section 1) —
// the functional modules this is meant to gate (Documents, Standards,
// Incidents, CAPA, Gap, Audit, KPI) don't exist until ACC-17+. No-op when
// @RequiresModule() metadata is absent from the handler, same "stubbed"
// shape PermissionGuard had before Step 8/ACC-8 enforced it for real.
//
// Never gates foundation modules (tasks/users/roles/lookups/workflow/org) —
// those are always-on regardless of plan; only functional modules ever get
// @RequiresModule() applied to their controllers.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRES_MODULE_KEY } from '../decorators/requires-module.decorator';

interface AuthenticatedRequest extends Request {
  tenantId: string;
}

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const moduleKey = this.reflector.get<string>(REQUIRES_MODULE_KEY, ctx.getHandler());
    if (!moduleKey) return true;

    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const org = await this.prisma.organization.findUnique({
      where: { id: request.tenantId },
      select: { settings: true },
    });

    const modules = (org?.settings as { modules?: Record<string, boolean> } | null)?.modules ?? {};

    if (modules[moduleKey] !== true) {
      throw new ForbiddenException(`The '${moduleKey}' module is not enabled for this organization`);
    }

    return true;
  }
}
