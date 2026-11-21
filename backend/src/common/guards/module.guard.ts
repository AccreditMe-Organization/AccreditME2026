// ModuleGuard — ACC-102. Refuses a request on a module the organisation's PLAN
// does not grant, or grants read-only to a route that writes.
//
// It decides through resolveModuleEntitlements(), the one plan-aware rule, which
// the entitlements endpoint the rail reads also uses — so the API and the rail
// cannot disagree about a module. (Before ACC-102 it read the bare
// settings.modules boolean and ignored the plan, and nothing registered it.)
//
// REGISTERED BY THE DECORATOR, per route: @RequiresModule(key, mode) applies
// SetMetadata AND UseGuards(ModuleGuard) to the handler. Nest runs global
// guards, then the controller's, then the route's, so this always runs after
// the class-level TenantGuard every controller carries, and a decorated route
// cannot forget the guard. Never list ModuleGuard in a controller's @UseGuards
// as well: it would run twice. It is not an APP_GUARD — a global guard runs
// before TenantGuard, with no tenant on the request yet.
//
// COST (Ahmad, 20 Nov — a named exception to the performance rule, for routes
// that carry @RequiresModule only): ONE query per gated request, the
// organisation's settings joined to its own plan's modules. A route with no
// @RequiresModule makes none. TenantGuard's own read is not reused: it reads
// the user and the organisation's status, not settings or the plan, and adding
// them there would put the cost on every request.
//
// Gates functional modules only. Foundation areas (tasks, users, roles,
// lookups, workflow, org, committees) are always on and never decorated.

import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ModuleAccessLevel,
  PlanModuleAccess,
  resolveModuleEntitlements,
} from '../../foundation/tenant/module-entitlements';
import { ModuleRefusalException } from './module-refusal.exception';

export const REQUIRES_MODULE_KEY = 'requiresModule';

/**
 * What a route does to its module. Stated per handler and REQUIRED, never
 * inferred from the HTTP method: a POST that only reads (a search, a preview)
 * is a 'read', and a GET with an effect would be a 'write'.
 */
export type ModuleAccessMode = 'read' | 'write';

export interface RequiredModule {
  moduleKey: string;
  mode: ModuleAccessMode;
}

interface ModuleGuardRequest {
  tenantId?: string;
}

/** One row per plan module; the organisation's columns repeat on each. */
interface EntitlementRow {
  settings: unknown;
  planId: string | null;
  moduleKey: string | null;
  accessLevel: string | null;
}

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<RequiredModule | undefined>(REQUIRES_MODULE_KEY, ctx.getHandler());
    if (!required) return true;

    const tenantId = ctx.switchToHttp().getRequest<ModuleGuardRequest>().tenantId;
    // A decorated route on a controller without TenantGuard is a defect, not a
    // refusal: fail loudly (500) rather than guess an organisation.
    if (!tenantId) {
      throw new Error(`ModuleGuard: no tenant on the request for module '${required.moduleKey}'; TenantGuard must run first`);
    }

    const level = await this.levelFor(tenantId, required.moduleKey);
    if (!level) throw new ModuleRefusalException('MODULE_NOT_ENABLED', required.moduleKey);
    if (required.mode === 'write' && level === 'READ_ONLY') {
      throw new ModuleRefusalException('MODULE_READ_ONLY', required.moduleKey);
    }
    return true;
  }

  /**
   * The organisation's level for one module, or undefined for NONE / absent.
   *
   * One statement. The plan is reached only through THIS organisation's own
   * planId, so no other organisation's plan can be read, and no plan id from
   * outside enters the query.
   */
  private async levelFor(
    organizationId: string,
    moduleKey: string,
  ): Promise<Exclude<ModuleAccessLevel, 'NONE'> | undefined> {
    const rows = await this.prisma.$queryRaw<EntitlementRow[]>`
      SELECT o."settings", o."planId", pm."moduleKey", pm."accessLevel"::text AS "accessLevel"
      FROM "Organization" o
      LEFT JOIN "PlanModule" pm ON pm."planId" = o."planId"
      WHERE o."id" = ${organizationId}`;
    if (rows.length === 0) return undefined;

    const { settings, planId } = rows[0];
    const enabledModules = (settings as { modules?: Record<string, boolean> } | null)?.modules ?? {};
    // null, not [], with no plan: the resolver's NULL_PLAN_FALLBACK_ACCESS
    // applies only to the no-plan state. A plan with no rows grants nothing.
    const planModules: PlanModuleAccess[] | null = planId
      ? rows
          .filter((r) => r.moduleKey !== null && r.accessLevel !== null)
          .map((r) => ({ moduleKey: r.moduleKey as string, accessLevel: r.accessLevel as ModuleAccessLevel }))
      : null;

    return resolveModuleEntitlements(enabledModules, planModules)[moduleKey];
  }
}
