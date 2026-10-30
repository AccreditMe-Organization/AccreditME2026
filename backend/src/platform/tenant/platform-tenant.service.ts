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
import { AiAllocationService } from '../../foundation/ai/ai-allocation.service';
import { aiBalanceOf } from '../../foundation/ai/ai-balance';
import { IPlatformTenantDetail, IPlatformTenantSummary } from './interfaces/platform-tenant.interface';
import { isOrganizationOpen } from '../../common/tenant/organization-status';
import {
  ACCESS_TOKEN_COOKIE,
  accessTokenCookieOptions,
} from '../../common/config/session-cookies';

// ACC-194 — the AI balance is NOT here any more: it lives in dedicated
// Organization columns (foundation/ai/), and the old settings.ai counters are
// ignored everywhere.
interface OrgSettings {
  modules?: Record<string, boolean>;
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
    private readonly aiAllocation: AiAllocationService,
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
      ai: aiBalanceOf(org),
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

    // ACC-194 (D3) — a plan set at creation sets the AI allocation to the
    // plan's credits. After bootstrap, so the period anchors to bootstrappedAt.
    if (dto.planId) {
      const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId }, select: { aiCreditsPerMonth: true } });
      if (plan) await this.aiAllocation.setAllocation(org.id, plan.aiCreditsPerMonth, 'plan', actorId);
    }

    // ACC-40 Section 2.4 — positionId/primaryOrgUnitId are now required on
    // invite(); bootstrap() guarantees a default position and root org
    // unit exist by this point.
    const defaultAssignment = await this.tenantService.resolveDefaultTenantAdminAssignment(org.id);

    const invitedUser = await this.userService.invite(
      { email: dto.adminEmail, name: dto.adminName, ...defaultAssignment },
      org.id,
      actorId,
    );

    // ACC-221 — the person created with the tenant is its account owner, in
    // the new organisation's own trail, in the shape the backfill writes.
    await this.prisma.organization.update({ where: { id: org.id }, data: { ownerUserId: invitedUser.id } });
    await this.auditLog.log({
      tenantId: org.id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: org.id,
      before: { ownerUserId: null },
      after: { ownerUserId: invitedUser.id },
      metadata: {
        source: 'tenant_creation',
        ticket: 'ACC-221',
        reason: "The organisation's account owner (ACC-221) is the person it was created with.",
      },
    });

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

    // ACC-271 (plan §5) — the seeded workflows start on the first admin: one
    // starting assignment per stage the seed marked. The admin is INVITED, so
    // those stages read as unassigned until they accept.
    await this.tenantService.assignWorkflowStartingAssignments(org.id, invitedUser.id, actorId);

    return this.getTenantDetail(org.id);
  }

  async suspendTenant(id: string, actorId: string): Promise<void> {
    const org = await this.assertTenantExists(id);
    // ACC-168 — the platform organisation is never closed. A closed
    // organisation is refused by TenantGuard on every request, and the guard
    // deliberately makes no exception for it, so suspending the platform would
    // lock every platform administrator out of the means to reopen it. This is
    // the only path that writes a closed status (UpdateTenantDto has no status
    // field; creation defaults to TRIAL), so it is the only guard needed.
    if (org.isPlatformOrg) {
      throw new ConflictException(
        'The platform organization cannot be suspended',
      );
    }
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

  // ACC-194 — a manual allocation, for a special agreement (D3, D15). It goes
  // through AiAllocationService, the one writer of the allocation: a raise
  // applies now, a cut waits for the next renewal, and the next plan set or
  // change replaces it. That service writes the audit row. overageEnabled in
  // the DTO is ignored (D19): overage stays off and nothing reads it.
  async allocateAiCredits(id: string, dto: AllocateAiCreditsDto, actorId: string): Promise<void> {
    await this.assertTenantExists(id);
    await this.aiAllocation.setAllocation(id, dto.monthlyCredits, 'manual', actorId);
  }

  // ACC-194 (D18) — set or change a tenant's plan, the first way to do so after
  // creation. The AI allocation follows the plan (D3, same timing as a manual
  // allocation), and so do the module entitlements, which are read through
  // planId. null removes the plan: an allocation of 0, which as a cut waits for
  // the next renewal. Editing a plan's own credits reaches nobody until their
  // plan is next set (D16).
  async changePlan(id: string, planId: string | null, actorId: string): Promise<void> {
    const org = await this.assertTenantExists(id);
    const plan = planId
      ? await this.prisma.plan.findUnique({ where: { id: planId }, select: { id: true, nameEn: true, aiCreditsPerMonth: true } })
      : null;
    if (planId && !plan) throw new NotFoundException('Plan not found');
    const previous = org.planId
      ? await this.prisma.plan.findUnique({ where: { id: org.planId }, select: { nameEn: true } })
      : null;

    await this.prisma.organization.update({ where: { id }, data: { planId: plan?.id ?? null } });
    await this.auditLog.log({
      tenantId: id,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: id,
      before: { planId: org.planId, planName: previous?.nameEn ?? null },
      after: { planId: plan?.id ?? null, planName: plan?.nameEn ?? null },
      metadata: { event: 'plan_changed' },
    });
    await this.aiAllocation.setAllocation(id, plan?.aiCreditsPerMonth ?? 0, 'plan', actorId);
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
    // ACC-168 — a closed organisation is refused HERE, before a token is
    // issued or IMPERSONATE_START is written. TenantGuard would refuse the
    // impersonated token on its very first request anyway, but by then this
    // method has already replaced the platform administrator's own cookie —
    // signing them out — and written a start that nothing will ever end.
    const tenant = await this.prisma.organization.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (tenant && !isOrganizationOpen(tenant.status)) {
      throw new ConflictException('This organization is not active');
    }

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

  // ACC-186 — the same options sign-in uses, from the one place they live.
  private setAccessTokenCookie(res: ExpressResponse, token: string): void {
    res.cookie(
      ACCESS_TOKEN_COOKIE,
      token,
      accessTokenCookieOptions(ACCESS_TOKEN_TTL_SECONDS * 1000),
    );
  }

  private async assertTenantExists(id: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Tenant not found');
    return org;
  }
}
