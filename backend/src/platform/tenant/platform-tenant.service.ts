// PlatformTenantService — Super Admin tenant management (ACC-13). Every
// method here is deliberately cross-tenant (no organizationId filter on
// listTenants/createTenant) — gated entirely by PlatformGuard at the
// controller, not by tenant scoping. This IS the "see every tenant" surface.

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TenantService } from '../../foundation/tenant/tenant.service';
import { UserService } from '../../foundation/user/user.service';
import { RoleService } from '../../foundation/roles/role.service';
import { signAccessToken, ACCESS_TOKEN_TTL_SECONDS } from '../../foundation/auth/auth.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantModulesDto } from './dto/update-tenant-modules.dto';
import { AllocateAiCreditsDto } from './dto/allocate-ai-credits.dto';
import { IPlatformTenantDetail, IPlatformTenantSummary } from './interfaces/platform-tenant.interface';

interface OrgSettings {
  modules?: Record<string, boolean>;
  ai?: {
    monthlyCredits?: number;
    creditsUsed?: number;
    creditsRemaining?: number;
    overageEnabled?: boolean;
  };
  [key: string]: unknown;
}

@Injectable()
export class PlatformTenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly tenantService: TenantService,
    private readonly userService: UserService,
    private readonly roleService: RoleService,
  ) {}

  async listTenants(filters?: {
    status?: 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'OFFBOARDING';
    planId?: string;
  }): Promise<IPlatformTenantSummary[]> {
    const orgs = await this.prisma.organization.findMany({
      where: {
        status: filters?.status,
        planId: filters?.planId,
      },
      include: { planCatalog: true },
      orderBy: { createdAt: 'desc' },
    });

    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      planId: o.planId,
      planName: o.planCatalog?.nameEn ?? null,
      createdAt: o.createdAt,
    }));
  }

  async getTenantDetail(id: string): Promise<IPlatformTenantDetail> {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { planCatalog: true },
    });
    if (!org) throw new NotFoundException('Tenant not found');

    const userCount = await this.prisma.user.count({
      where: { organizationId: id, status: { in: ['ACTIVE', 'INVITED'] } },
    });

    const tenantAdmins = await this.prisma.user.findMany({
      where: {
        organizationId: id,
        status: 'ACTIVE',
        userRoles: { some: { role: { key: 'TENANT_ADMIN' } } },
      },
      select: { id: true, name: true, email: true },
    });

    const settings = (org.settings as OrgSettings | null) ?? {};

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      status: org.status,
      planId: org.planId,
      planName: org.planCatalog?.nameEn ?? null,
      createdAt: org.createdAt,
      userCount,
      modules: settings.modules ?? {},
      ai: {
        monthlyCredits: settings.ai?.monthlyCredits ?? 0,
        creditsUsed: settings.ai?.creditsUsed ?? 0,
        creditsRemaining: settings.ai?.creditsRemaining ?? 0,
        overageEnabled: settings.ai?.overageEnabled ?? false,
      },
      tenantAdmins,
    };
  }

  // Orchestrates 3 already-built services — see step-12-admin-portal.md
  // Section 1's finding: TenantService.bootstrap() alone cannot create a
  // tenant (it requires the Organization row to already exist). This method
  // creates that row directly, then delegates the rest, duplicating zero
  // logic from bootstrap()/invite()/assignRoleToUser().
  async createTenant(dto: CreateTenantDto, actorId: string): Promise<IPlatformTenantDetail> {
    const existing = await this.prisma.organization.findUnique({ where: { slug: dto.slug } });
    if (existing) throw new ConflictException('An organization with this slug already exists');

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        country: dto.country,
        planId: dto.planId ?? null,
      },
    });

    await this.tenantService.bootstrap(org.id, actorId);

    // ACC-40 Section 2.4 — positionId/primaryOrgUnitId are now required on
    // invite(); bootstrap() guarantees a default position and root org
    // unit exist by this point.
    const defaultAssignment = await this.tenantService.resolveDefaultTenantAdminAssignment(org.id);

    const invitedUser = await this.userService.invite(
      { email: dto.adminEmail, name: dto.adminName, ...defaultAssignment },
      org.id,
      actorId,
    );

    const tenantAdminRole = await this.prisma.role.findFirst({
      where: { organizationId: org.id, key: 'TENANT_ADMIN' },
    });
    if (!tenantAdminRole) {
      throw new Error('TENANT_ADMIN role not found after bootstrap — this should never happen');
    }

    await this.roleService.assignRoleToUser(
      invitedUser.id,
      { roleId: tenantAdminRole.id },
      org.id,
      actorId,
    );

    return this.getTenantDetail(org.id);
  }

  async suspendTenant(id: string, actorId: string): Promise<void> {
    await this.assertTenantExists(id);
    await this.prisma.organization.update({ where: { id }, data: { status: 'SUSPENDED' } });
    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      metadata: { event: 'suspended' },
    });
  }

  async reactivateTenant(id: string, actorId: string): Promise<void> {
    await this.assertTenantExists(id);
    await this.prisma.organization.update({ where: { id }, data: { status: 'ACTIVE' } });
    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      metadata: { event: 'reactivated' },
    });
  }

  async extendTrial(id: string, newTrialEndsAt: Date, actorId: string): Promise<void> {
    await this.assertTenantExists(id);
    await this.prisma.organization.update({ where: { id }, data: { trialEndsAt: newTrialEndsAt } });
    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      metadata: { event: 'trial_extended', newTrialEndsAt },
    });
  }

  async updateTenantModules(id: string, dto: UpdateTenantModulesDto, actorId: string): Promise<void> {
    const org = await this.assertTenantExists(id);
    const settings = (org.settings as OrgSettings | null) ?? {};
    const modules = { ...(settings.modules ?? {}), ...dto.modules };

    await this.prisma.organization.update({
      where: { id },
      data: { settings: { ...settings, modules } },
    });

    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      metadata: { event: 'modules_updated', modules: dto.modules },
    });
  }

  async allocateAiCredits(id: string, dto: AllocateAiCreditsDto, actorId: string): Promise<void> {
    const org = await this.assertTenantExists(id);
    const settings = (org.settings as OrgSettings | null) ?? {};
    const existingAi = settings.ai ?? {};

    const ai = {
      ...existingAi,
      monthlyCredits: dto.monthlyCredits,
      creditsRemaining: dto.monthlyCredits - (existingAi.creditsUsed ?? 0),
      ...(dto.overageEnabled !== undefined ? { overageEnabled: dto.overageEnabled } : {}),
    };

    await this.prisma.organization.update({
      where: { id },
      data: { settings: { ...settings, ai } },
    });

    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      metadata: { event: 'ai_credits_allocated', monthlyCredits: dto.monthlyCredits },
    });
  }

  // Mints a normal access_token JWT for targetUserId (must belong to
  // tenantId and hold TENANT_ADMIN), with an added impersonatedBy claim.
  // Only the access_token cookie is replaced — the platform admin's own
  // refresh_token cookie (if any) is left untouched; calling /auth/refresh
  // mid-impersonation would silently refresh back to the platform admin's
  // own identity, not the impersonated one. Acceptable for this ticket's
  // scope (impersonation sessions are short-lived support actions) but
  // worth knowing if this surfaces confusingly later.
  async startImpersonation(
    tenantId: string,
    targetUserId: string,
    platformAdminUserId: string,
    platformOrgId: string,
    res: ExpressResponse,
  ): Promise<void> {
    const targetUser = await this.prisma.user.findFirst({
      where: { id: targetUserId, organizationId: tenantId, status: 'ACTIVE' },
    });
    if (!targetUser) throw new NotFoundException('Target user not found in this tenant');

    const holdsTenantAdmin = await this.prisma.userRole.findFirst({
      where: { userId: targetUserId, role: { organizationId: tenantId, key: 'TENANT_ADMIN' } },
    });
    if (!holdsTenantAdmin) {
      throw new BadRequestException('Target user does not hold TENANT_ADMIN');
    }

    const secret = process.env['JWT_SECRET'];
    if (!secret) throw new Error('JWT_SECRET is not configured');

    const token = signAccessToken(
      {
        sub: targetUser.id,
        organizationId: tenantId,
        tokenVersion: targetUser.tokenVersion,
        impersonatedBy: platformAdminUserId,
      },
      secret,
    );

    this.setAccessTokenCookie(res, token);

    await this.auditLog.log({
      tenantId: platformOrgId,
      actorId: platformAdminUserId,
      action: 'IMPERSONATE_START',
      objectType: 'User',
      objectId: targetUser.id,
      metadata: { targetTenantId: tenantId, targetUserId: targetUser.id },
    });

    await this.auditLog.log({
      tenantId,
      actorId: platformAdminUserId,
      action: 'IMPERSONATE_START',
      objectType: 'User',
      objectId: targetUser.id,
      metadata: { platformAdminUserId },
    });
  }

  // Reads impersonatedBy off the CURRENT request (attached by TenantGuard —
  // see tenant.guard.ts) and mints a fresh normal JWT for that original
  // platform admin. Fails closed if this session was never impersonated.
  async endImpersonation(
    req: ExpressRequest & { impersonatedBy?: string; userId?: string; tenantId?: string },
    res: ExpressResponse,
  ): Promise<void> {
    if (!req.impersonatedBy) {
      throw new BadRequestException('This session is not an impersonated session');
    }

    const platformAdmin = await this.prisma.user.findFirst({ where: { id: req.impersonatedBy } });
    if (!platformAdmin) throw new NotFoundException('Original platform admin user not found');

    const secret = process.env['JWT_SECRET'];
    if (!secret) throw new Error('JWT_SECRET is not configured');

    const token = signAccessToken(
      {
        sub: platformAdmin.id,
        organizationId: platformAdmin.organizationId,
        tokenVersion: platformAdmin.tokenVersion,
      },
      secret,
    );

    this.setAccessTokenCookie(res, token);

    await this.auditLog.log({
      tenantId: platformAdmin.organizationId,
      actorId: platformAdmin.id,
      action: 'IMPERSONATE_END',
      objectType: 'User',
      objectId: req.userId,
      metadata: { targetTenantId: req.tenantId },
    });
  }

  private setAccessTokenCookie(res: ExpressResponse, token: string): void {
    res.cookie('access_token', token, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'strict',
      maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
      path: '/',
    });
  }

  private async assertTenantExists(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}
