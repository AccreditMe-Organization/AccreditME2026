import { AiAllocationService } from '../../foundation/ai/ai-allocation.service';
// Importing signAccessToken/ACCESS_TOKEN_TTL_SECONDS from auth.service.ts
// pulls in its top-level import of better-auth.config.ts, which imports
// better-auth's own ESM-only package — same Jest/ESM interop issue this
// codebase already solved for auth.service.spec.ts/auth.controller.spec.ts.
// Explicit factory mock, not a bare jest.mock(path).
jest.mock('../../providers/auth/better-auth.config', () => ({
  createBetterAuthInstance: jest.fn(() => ({ api: {} })),
}));

// Same rationale as above — ACC-25 added AuthService's own top-level import
// of isAPIError from better-auth/api, which is also ESM-only.
jest.mock('better-auth/api', () => ({
  isAPIError: () => false,
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PlatformTenantService } from './platform-tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { TenantService } from '../../foundation/tenant/tenant.service';
import { UserService } from '../../foundation/user/user.service';
import { RoleService } from '../../foundation/roles/role.service';

const PLATFORM_ORG_ID = 'platform-org';
const TENANT_ID = 'tenant-a';
const ACTOR_ID = 'platform-admin-1';

function fakeRes() {
  return { cookie: jest.fn() } as any;
}

describe('PlatformTenantService', () => {
  let service: PlatformTenantService;
  let mockPrisma: any;
  let mockAuditLog: { log: jest.Mock };
  let mockTenantService: { bootstrap: jest.Mock; resolveDefaultTenantAdminAssignment: jest.Mock; assignWorkflowStartingAssignments: jest.Mock };
  let mockUserService: { invite: jest.Mock };
  let mockRoleService: { assignRoleToUser: jest.Mock };
  let mockAiAllocation: { setAllocation: jest.Mock };

  beforeEach(() => {
    process.env['JWT_SECRET'] = 'test-jwt-secret';

    mockPrisma = {
      organization: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
      user: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
      role: { findFirst: jest.fn() },
      userRole: { findFirst: jest.fn() },
      plan: { findUnique: jest.fn() },
    };
    mockAuditLog = { log: jest.fn() };
    mockTenantService = {
      bootstrap: jest.fn().mockResolvedValue(undefined),
      resolveDefaultTenantAdminAssignment: jest
        .fn()
        .mockResolvedValue({ positionId: 'pos-director', primaryOrgUnitId: 'unit-root' }),
      // ACC-271 — the seeded workflows' starting assignments, after the invite.
      assignWorkflowStartingAssignments: jest.fn().mockResolvedValue(undefined),
    };
    mockUserService = { invite: jest.fn() };
    mockRoleService = { assignRoleToUser: jest.fn().mockResolvedValue(undefined) };
    mockAiAllocation = {
      setAllocation: jest.fn().mockResolvedValue({ allocation: 0, pendingAllocation: null, takesEffect: 'now', renewed: false }),
    };

    service = new PlatformTenantService(
      mockPrisma as unknown as PrismaService,
      mockAuditLog as unknown as AuditLogService,
      mockTenantService as unknown as TenantService,
      mockUserService as unknown as UserService,
      mockRoleService as unknown as RoleService,
      mockAiAllocation as unknown as AiAllocationService,
    );
  });

  afterEach(() => {
    delete process.env['JWT_SECRET'];
  });

  describe('listTenants', () => {
    it('maps planCatalog.nameEn to planName', async () => {
      mockPrisma.organization.findMany.mockResolvedValue([
        {
          id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'ACTIVE', planId: 'plan-1',
          planCatalog: { nameEn: 'Professional' }, createdAt: new Date(),
        },
      ]);

      const result = await service.listTenants();

      expect(result[0]?.planName).toBe('Professional');
    });
  });

  describe('getTenantDetail', () => {
    it('throws NotFoundException when the tenant does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getTenantDetail('missing')).rejects.toThrow(NotFoundException);
    });

    it('defaults modules when settings is null, and reads the AI balance from the columns (ACC-194)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'ACTIVE', planId: null,
        planCatalog: null, settings: { ai: { monthlyCredits: 999, creditsUsed: 1 } }, createdAt: new Date(),
        bootstrappedAt: null,
        aiMonthlyCredits: 0, aiPendingMonthlyCredits: null, aiCreditsUsed: 0,
        aiCreditsPeriodStart: null, aiCreditsRenewsAt: null,
      });
      mockPrisma.user.count.mockResolvedValue(3);
      mockPrisma.user.findMany.mockResolvedValue([]);

      const result = await service.getTenantDetail(TENANT_ID);

      expect(result.modules).toEqual({});
      // The old settings.ai counters (999 here) are ignored.
      expect(result.ai).toEqual({
        enabled: false,
        monthlyCredits: 0,
        creditsUsed: 0,
        creditsRemaining: 0,
        resetDate: null,
        overageEnabled: false,
        pendingMonthlyCredits: null,
        periodStart: null,
      });
      expect(result.userCount).toBe(3);
    });
  });

  describe('createTenant', () => {
    const dto = {
      name: 'Acme', slug: 'acme', country: 'SA',
      adminEmail: 'admin@acme.com', adminName: 'Acme Admin',
    };

    it('throws ConflictException when the slug already exists', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: 'existing' });
      await expect(service.createTenant(dto, ACTOR_ID)).rejects.toThrow(ConflictException);
      expect(mockPrisma.organization.create).not.toHaveBeenCalled();
    });

    it('orchestrates organization creation, bootstrap, invite, and role assignment in order', async () => {
      mockPrisma.organization.findUnique.mockResolvedValueOnce(null); // slug check
      mockPrisma.organization.create.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
      mockUserService.invite.mockResolvedValue({ id: 'invited-user-1' });
      mockPrisma.role.findFirst.mockResolvedValue({ id: 'tenant-admin-role-1' });
      // getTenantDetail's own lookup at the end of createTenant
      mockPrisma.organization.findUnique.mockResolvedValueOnce({
        id: TENANT_ID, name: 'Acme', slug: 'acme', status: 'TRIAL', planId: null,
        planCatalog: null, settings: null, createdAt: new Date(),
      });
      mockPrisma.user.count.mockResolvedValue(1);
      mockPrisma.user.findMany.mockResolvedValue([]);

      await service.createTenant(dto, ACTOR_ID);

      expect(mockPrisma.organization.create).toHaveBeenCalledWith({
        data: { name: 'Acme', slug: 'acme', country: 'SA', planId: null },
      });
      expect(mockTenantService.bootstrap).toHaveBeenCalledWith(TENANT_ID, ACTOR_ID);
      expect(mockTenantService.resolveDefaultTenantAdminAssignment).toHaveBeenCalledWith(TENANT_ID);
      expect(mockUserService.invite).toHaveBeenCalledWith(
        {
          email: 'admin@acme.com',
          name: 'Acme Admin',
          positionId: 'pos-director',
          primaryOrgUnitId: 'unit-root',
        },
        TENANT_ID,
        ACTOR_ID,
      );
      expect(mockRoleService.assignRoleToUser).toHaveBeenCalledWith(
        'invited-user-1',
        { roleId: 'tenant-admin-role-1' },
        TENANT_ID,
        ACTOR_ID,
      );
      // ACC-271 (plan §5) — the seeded stages start on the invited admin, and
      // only once the admin exists: after the invite, in the same flow.
      expect(mockTenantService.assignWorkflowStartingAssignments).toHaveBeenCalledWith(TENANT_ID, 'invited-user-1', ACTOR_ID);
      expect(mockTenantService.assignWorkflowStartingAssignments.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockUserService.invite.mock.invocationCallOrder[0] ?? Infinity,
      );
    });

    it("a plan set at creation sets the AI allocation to the plan's credits, after bootstrap (ACC-194, D3)", async () => {
      mockPrisma.organization.findUnique.mockResolvedValueOnce(null);
      mockPrisma.organization.create.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
      mockPrisma.plan.findUnique.mockResolvedValue({ aiCreditsPerMonth: 300 });
      mockUserService.invite.mockResolvedValue({ id: 'invited-user-1' });
      mockPrisma.role.findFirst.mockResolvedValue(null); // stop after the allocation

      await expect(service.createTenant({ ...dto, planId: 'plan-pro' }, ACTOR_ID)).rejects.toThrow();

      expect(mockPrisma.plan.findUnique).toHaveBeenCalledWith({ where: { id: 'plan-pro' }, select: { aiCreditsPerMonth: true } });
      expect(mockAiAllocation.setAllocation).toHaveBeenCalledWith(TENANT_ID, 300, 'plan', ACTOR_ID);
      expect(mockTenantService.bootstrap.mock.invocationCallOrder[0]).toBeLessThan(mockAiAllocation.setAllocation.mock.invocationCallOrder[0] ?? 0);
    });

    it('no plan at creation, no allocation', async () => {
      mockPrisma.organization.findUnique.mockResolvedValueOnce(null);
      mockPrisma.organization.create.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
      mockUserService.invite.mockResolvedValue({ id: 'invited-user-1' });
      mockPrisma.role.findFirst.mockResolvedValue(null);
      await expect(service.createTenant(dto, ACTOR_ID)).rejects.toThrow();
      expect(mockAiAllocation.setAllocation).not.toHaveBeenCalled();
    });

    it('throws when TENANT_ADMIN role is not found after bootstrap', async () => {
      mockPrisma.organization.findUnique.mockResolvedValueOnce(null);
      mockPrisma.organization.create.mockResolvedValue({ id: TENANT_ID, slug: 'acme' });
      mockUserService.invite.mockResolvedValue({ id: 'invited-user-1' });
      mockPrisma.role.findFirst.mockResolvedValue(null);

      await expect(service.createTenant(dto, ACTOR_ID)).rejects.toThrow(
        'TENANT_ADMIN role not found after bootstrap — this should never happen',
      );
    });
  });

  describe('suspendTenant / reactivateTenant / extendTrial', () => {
    it('suspendTenant throws NotFoundException when tenant does not exist', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.suspendTenant(TENANT_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
    });

    it('suspendTenant sets status to SUSPENDED and logs', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID });
      await service.suspendTenant(TENANT_ID, ACTOR_ID);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID }, data: { status: 'SUSPENDED' },
      });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, actorId: ACTOR_ID, action: 'UPDATE' }),
      );
    });

    it('reactivateTenant sets status to ACTIVE', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID });
      await service.reactivateTenant(TENANT_ID, ACTOR_ID);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID }, data: { status: 'ACTIVE' },
      });
    });

    it('extendTrial sets trialEndsAt', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID });
      const newDate = new Date('2027-01-01');
      await service.extendTrial(TENANT_ID, newDate, ACTOR_ID);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID }, data: { trialEndsAt: newDate },
      });
    });
  });

  describe('updateTenantModules', () => {
    it('merges into settings.modules without clobbering unrelated settings keys', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({
        id: TENANT_ID,
        settings: { taskSla: { CRITICAL: 4 }, modules: { documents: true } },
      });

      await service.updateTenantModules(TENANT_ID, { modules: { standards: true } }, ACTOR_ID);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({
        where: { id: TENANT_ID },
        data: {
          settings: {
            taskSla: { CRITICAL: 4 },
            modules: { documents: true, standards: true },
          },
        },
      });
    });
  });

  describe('allocateAiCredits (ACC-194, D15/D19)', () => {
    it('goes through the one allocation writer as a manual allocation, and writes no settings JSON', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID, settings: { ai: { creditsUsed: 100 } } });

      await service.allocateAiCredits(TENANT_ID, { monthlyCredits: 500, overageEnabled: true }, ACTOR_ID);

      expect(mockAiAllocation.setAllocation).toHaveBeenCalledWith(TENANT_ID, 500, 'manual', ACTOR_ID);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
    });

    it('refuses an unknown tenant before allocating', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.allocateAiCredits('missing', { monthlyCredits: 5 }, ACTOR_ID)).rejects.toThrow(NotFoundException);
      expect(mockAiAllocation.setAllocation).not.toHaveBeenCalled();
    });
  });

  describe('changePlan (ACC-194, D18)', () => {
    it("sets the plan, audits the old and new plan, and sets the allocation to the plan's credits", async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID, planId: 'plan-starter' });
      mockPrisma.plan.findUnique
        .mockResolvedValueOnce({ id: 'plan-pro', nameEn: 'Professional', aiCreditsPerMonth: 300 })
        .mockResolvedValueOnce({ nameEn: 'Starter' });

      await service.changePlan(TENANT_ID, 'plan-pro', ACTOR_ID);

      expect(mockPrisma.organization.update).toHaveBeenCalledWith({ where: { id: TENANT_ID }, data: { planId: 'plan-pro' } });
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_ID,
          actorId: ACTOR_ID,
          before: { planId: 'plan-starter', planName: 'Starter' },
          after: { planId: 'plan-pro', planName: 'Professional' },
          metadata: { event: 'plan_changed' },
        }),
      );
      expect(mockAiAllocation.setAllocation).toHaveBeenCalledWith(TENANT_ID, 300, 'plan', ACTOR_ID);
    });

    it('removing the plan sets an allocation of 0 (a cut, at the next renewal)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID, planId: null });
      await service.changePlan(TENANT_ID, null, ACTOR_ID);
      expect(mockPrisma.organization.update).toHaveBeenCalledWith({ where: { id: TENANT_ID }, data: { planId: null } });
      expect(mockAiAllocation.setAllocation).toHaveBeenCalledWith(TENANT_ID, 0, 'plan', ACTOR_ID);
    });

    it('an unknown plan is refused and nothing changes', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue({ id: TENANT_ID, planId: null });
      mockPrisma.plan.findUnique.mockResolvedValue(null);
      await expect(service.changePlan(TENANT_ID, 'nope', ACTOR_ID)).rejects.toThrow(NotFoundException);
      expect(mockPrisma.organization.update).not.toHaveBeenCalled();
      expect(mockAiAllocation.setAllocation).not.toHaveBeenCalled();
    });
  });

  describe('startImpersonation', () => {
    it('throws NotFoundException when the target user is not an active member of the tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.startImpersonation(TENANT_ID, 'user-1', ACTOR_ID, PLATFORM_ORG_ID, fakeRes()),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the target user does not hold TENANT_ADMIN', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', tokenVersion: 1 });
      mockPrisma.userRole.findFirst.mockResolvedValue(null);
      await expect(
        service.startImpersonation(TENANT_ID, 'user-1', ACTOR_ID, PLATFORM_ORG_ID, fakeRes()),
      ).rejects.toThrow(BadRequestException);
    });

    it('sets the access_token cookie and logs IMPERSONATE_START under both the platform org and target tenant', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1', tokenVersion: 1 });
      mockPrisma.userRole.findFirst.mockResolvedValue({ id: 'ur-1' });
      const res = fakeRes();

      await service.startImpersonation(TENANT_ID, 'user-1', ACTOR_ID, PLATFORM_ORG_ID, res);

      // ACC-186 — Secure whatever NODE_ENV says ('test' here, never 'production').
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: PLATFORM_ORG_ID, actorId: ACTOR_ID, action: 'IMPERSONATE_START' }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_ID, actorId: ACTOR_ID, action: 'IMPERSONATE_START' }),
      );
    });
  });

  describe('endImpersonation', () => {
    it('throws BadRequestException when the session was never impersonated', async () => {
      const req = {} as any;
      await expect(service.endImpersonation(req, fakeRes())).rejects.toThrow(BadRequestException);
    });

    it('mints a fresh token for the original platform admin and logs IMPERSONATE_END', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: ACTOR_ID, organizationId: PLATFORM_ORG_ID, tokenVersion: 2 });
      const req = { impersonatedBy: ACTOR_ID, userId: 'user-1', tenantId: TENANT_ID } as any;
      const res = fakeRes();

      await service.endImpersonation(req, res);

      // ACC-186 — Secure whatever NODE_ENV says ('test' here, never 'production').
      expect(res.cookie).toHaveBeenCalledWith(
        'access_token',
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: '/',
        }),
      );
      expect(mockAuditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: PLATFORM_ORG_ID, actorId: ACTOR_ID, action: 'IMPERSONATE_END',
        }),
      );
    });
  });
});
