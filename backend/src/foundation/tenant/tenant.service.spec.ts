import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';
import { RoleService } from '../roles/role.service';
import { WorkflowTemplateService } from '../workflow/workflow-template.service';
import { OrgPositionService } from '../org-position/org-position.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// Valid 64-char hex string → 32 bytes, satisfies constructor guard
const MOCK_ENCRYPTION_KEY = 'a'.repeat(64);

const ORG_A = {
  id: 'org-a',
  name: 'Org Alpha',
  slug: 'alpha',
  country: 'SA',
  timezone: 'Asia/Riyadh',
  language: 'en',
  authProvider: 'LOCAL' as const,
  storageProvider: 'S3' as const,
  aiProvider: 'ANTHROPIC' as const,
  plan: 'STARTER' as const,
  status: 'TRIAL' as const,
  trialEndsAt: null,
  maxUsers: 25,
  maxStorageGb: 10,
  isBootstrapped: false,
  bootstrappedAt: null,
  authConfig: null,
  storageConfig: null,
  aiConfig: null,
  emailConfig: null,
  logo: null,
  isPlatformOrg: false,
  planId: null,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const ORG_B = { ...ORG_A, id: 'org-b', name: 'Org Beta', slug: 'beta' };

describe('TenantService', () => {
  let service: TenantService;
  let prisma: {
    organization: { findUnique: jest.Mock; update: jest.Mock };
    orgUnit: { findFirst: jest.Mock; create: jest.Mock };
    orgPosition: { findFirst: jest.Mock };
  };
  let auditLog: { log: jest.Mock };
  let lookupService: { seedSystemData: jest.Mock };
  let roleService: { seedSystemRoles: jest.Mock };
  let workflowTemplateService: { seedDefaultWorkflows: jest.Mock };
  let orgPositionService: { seedDefaultPositions: jest.Mock };

  beforeEach(async () => {
    process.env['ENCRYPTION_KEY'] = MOCK_ENCRYPTION_KEY;

    prisma = {
      organization: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      orgUnit: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(undefined),
      },
      orgPosition: {
        findFirst: jest.fn(),
      },
    };

    auditLog     = { log: jest.fn().mockResolvedValue(undefined) };
    lookupService = { seedSystemData: jest.fn().mockResolvedValue(undefined) };
    roleService  = { seedSystemRoles: jest.fn().mockResolvedValue(undefined) };
    workflowTemplateService = { seedDefaultWorkflows: jest.fn().mockResolvedValue(undefined) };
    orgPositionService = { seedDefaultPositions: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService,  useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
        { provide: LookupService,  useValue: lookupService },
        { provide: RoleService,    useValue: roleService },
        { provide: WorkflowTemplateService, useValue: workflowTemplateService },
        { provide: OrgPositionService, useValue: orgPositionService },
      ],
    }).compile();

    service = module.get(TenantService);
  });

  afterEach(() => {
    delete process.env['ENCRYPTION_KEY'];
    jest.clearAllMocks();
  });

  // ── findById ──────────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns mapped ITenant for a valid id', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      const result = await service.findById('org-a');
      expect(result.id).toBe('org-a');
      expect(result.name).toBe('Org Alpha');
      expect(result).not.toHaveProperty('authConfig');
      expect(result).not.toHaveProperty('stripeCustomerId');
    });

    it('defaults modules/ai when settings is absent', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      const result = await service.findById('org-a');
      expect(result.modules).toEqual({});
      expect(result.ai).toEqual({
        enabled: false, monthlyCredits: 0, creditsUsed: 0, creditsRemaining: 0,
        resetDate: null, overageEnabled: false,
      });
    });

    it('derives modules/ai from settings when present', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...ORG_A,
        settings: { modules: { documents: true }, ai: { enabled: true, monthlyCredits: 500 } },
      });
      const result = await service.findById('org-a');
      expect(result.modules).toEqual({ documents: true });
      expect(result.ai.enabled).toBe(true);
      expect(result.ai.monthlyCredits).toBe(500);
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    });

    // ── TENANT ISOLATION ────────────────────────────────────────────────────
    it('should NOT return records belonging to a different tenant', async () => {
      prisma.organization.findUnique.mockImplementation(
        ({ where }: { where: { id: string } }) => {
          if (where.id === 'org-b') return Promise.resolve(ORG_B);
          return Promise.resolve(ORG_A);
        },
      );

      const result = await service.findById('org-b');

      expect(result.id).toBe('org-b');
      expect(result.name).toBe('Org Beta');
      expect(result.id).not.toBe('org-a');
    });
  });

  // ── update ────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('updates the tenant and calls auditLog.log', async () => {
      const updated = { ...ORG_A, name: 'Org Alpha Renamed' };
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      prisma.organization.update.mockResolvedValue(updated);

      const result = await service.update(
        'org-a',
        { name: 'Org Alpha Renamed' },
        'user-1',
      );

      expect(result.name).toBe('Org Alpha Renamed');
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: 'org-a',
          actorId: 'user-1',
          tenantId: 'org-a',
        }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.update('missing', { name: 'X' }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
      expect(auditLog.log).not.toHaveBeenCalled();
    });
  });

  // ── bootstrap ─────────────────────────────────────────────────────────────

  describe('bootstrap', () => {
    it('sets isBootstrapped and logs audit entry', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      prisma.organization.update.mockResolvedValue({
        ...ORG_A,
        isBootstrapped: true,
      });

      await service.bootstrap('org-a', 'user-1');

      expect(orgPositionService.seedDefaultPositions).toHaveBeenCalledWith('org-a');
      expect(lookupService.seedSystemData).toHaveBeenCalledTimes(1);
      expect(roleService.seedSystemRoles).toHaveBeenCalledWith('org-a');
      // ACC-23 — this assertion was missing entirely: the mock existed and
      // bootstrap() genuinely calls seedDefaultWorkflows(), but nothing here
      // ever checked it, which is exactly the kind of gap that let
      // demo-seed.ts's hand-rolled tenant creation drift unnoticed for so
      // long (a test that mocks a dependency but never asserts on it proves
      // nothing about whether the real call happens).
      expect(workflowTemplateService.seedDefaultWorkflows).toHaveBeenCalledWith('org-a');
      // ACC-46 Section 2.7.d — bootstrap() now also writes a real
      // taskSla row, not left to getTaskSla()'s runtime fallback alone.
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-a' },
          data: expect.objectContaining({
            isBootstrapped: true,
            settings: expect.objectContaining({
              taskSla: expect.objectContaining({
                CRITICAL: { dueAfterHours: 4, managerEscalationAfterHours: 2, headEscalationAfterHours: 4 },
              }),
            }),
          }),
        }),
      );
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'CREATE',
          objectType: 'TenantBootstrap',
          tenantId: 'org-a',
        }),
      );
    });

    it('throws ConflictException when already bootstrapped', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...ORG_A,
        isBootstrapped: true,
      });

      await expect(service.bootstrap('org-a', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.organization.update).not.toHaveBeenCalled();
      expect(auditLog.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.bootstrap('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── resolveDefaultTenantAdminAssignment (ACC-40 Section 2.4) ────────────────

  describe('resolveDefaultTenantAdminAssignment', () => {
    it('resolves the seeded "Director" position and the root org unit', async () => {
      prisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-director', nameEn: 'Director' });
      prisma.orgUnit.findFirst.mockResolvedValue({ id: 'unit-root', parentId: null });

      const result = await service.resolveDefaultTenantAdminAssignment('org-a');

      expect(prisma.orgPosition.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', nameEn: 'Director' },
      });
      expect(prisma.orgUnit.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-a', parentId: null },
      });
      expect(result).toEqual({ positionId: 'pos-director', primaryOrgUnitId: 'unit-root' });
    });

    it('throws when the default "Director" position is missing — invariant violation, not a valid state', async () => {
      prisma.orgPosition.findFirst.mockResolvedValue(null);

      await expect(service.resolveDefaultTenantAdminAssignment('org-a')).rejects.toThrow(
        'Default "Director" position not found after bootstrap — this should never happen',
      );
    });

    it('throws when the root org unit is missing — invariant violation, not a valid state', async () => {
      prisma.orgPosition.findFirst.mockResolvedValue({ id: 'pos-director', nameEn: 'Director' });
      prisma.orgUnit.findFirst.mockResolvedValue(null);

      await expect(service.resolveDefaultTenantAdminAssignment('org-a')).rejects.toThrow(
        'Root org unit not found after bootstrap — this should never happen',
      );
    });

    // ── TENANT ISOLATION ────────────────────────────────────────────────────
    it('should NOT return records belonging to a different tenant', async () => {
      const positionsByOrg: Record<string, { id: string; nameEn: string }> = {
        'org-a': { id: 'pos-director-a', nameEn: 'Director' },
        'org-b': { id: 'pos-director-b', nameEn: 'Director' },
      };
      const rootUnitsByOrg: Record<string, { id: string; parentId: null }> = {
        'org-a': { id: 'unit-root-a', parentId: null },
        'org-b': { id: 'unit-root-b', parentId: null },
      };
      prisma.orgPosition.findFirst.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(positionsByOrg[where.organizationId] ?? null),
      );
      prisma.orgUnit.findFirst.mockImplementation(({ where }: { where: { organizationId: string } }) =>
        Promise.resolve(rootUnitsByOrg[where.organizationId] ?? null),
      );

      const result = await service.resolveDefaultTenantAdminAssignment('org-a');

      expect(result).toEqual({ positionId: 'pos-director-a', primaryOrgUnitId: 'unit-root-a' });
      expect(prisma.orgPosition.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) }),
      );
      expect(prisma.orgUnit.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-a' }) }),
      );
    });
  });

  // ── getTenantConfig ───────────────────────────────────────────────────────

  describe('getTenantConfig', () => {
    it('returns null configs when none are set', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      const config = await service.getTenantConfig('org-a');
      expect(config.authConfig).toBeNull();
      expect(config.storageConfig).toBeNull();
      expect(config.aiConfig).toBeNull();
    });

    it('decrypts stored configs', async () => {
      const payload = { apiKey: 'secret-key' };
      const encrypted = service.encryptConfig(payload);
      prisma.organization.findUnique.mockResolvedValue({
        ...ORG_A,
        aiConfig: encrypted,
      });

      const config = await service.getTenantConfig('org-a');
      expect(config.aiConfig).toEqual(payload);
    });
  });

  // ── getEmailConfig / updateEmailConfig ───────────────────────────────────

  describe('getEmailConfig', () => {
    it('returns null provider/config when none is set', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      const config = await service.getEmailConfig('org-a');
      expect(config).toEqual({ emailProvider: null, config: null });
    });

    it('decrypts a stored email config', async () => {
      const payload = { emailProvider: 'smtp' as const, config: { host: 'smtp.example.com' } };
      const encrypted = service.encryptConfig(payload);
      prisma.organization.findUnique.mockResolvedValue({ ...ORG_A, emailConfig: encrypted });

      const config = await service.getEmailConfig('org-a');
      expect(config).toEqual(payload);
    });
  });

  describe('updateEmailConfig', () => {
    it('encrypts and persists the email config, then logs an audit entry', async () => {
      prisma.organization.findUnique.mockResolvedValue(ORG_A);
      prisma.organization.update.mockResolvedValue({ ...ORG_A });

      await service.updateEmailConfig(
        'org-a',
        { emailProvider: 'resend', config: { apiKey: 'abc' } },
        'user-1',
      );

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-a' },
        data: { emailConfig: expect.any(String) },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: 'org-a',
          actorId: 'user-1',
          tenantId: 'org-a',
        }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.updateEmailConfig('missing', { emailProvider: 'resend', config: {} }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateAiOverageSetting', () => {
    it('merges overageEnabled into settings.ai without touching monthlyCredits/creditsUsed', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...ORG_A,
        settings: { ai: { monthlyCredits: 500, creditsUsed: 100 } },
      });

      await service.updateAiOverageSetting('org-a', { overageEnabled: true }, 'user-1');

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-a' },
        data: {
          settings: { ai: { monthlyCredits: 500, creditsUsed: 100, overageEnabled: true } },
        },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'UPDATE', objectType: 'Organization', tenantId: 'org-a' }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(
        service.updateAiOverageSetting('missing', { overageEnabled: true }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── getTaskSla / updateTaskSla (ACC-46 Section 2.7.d) ───────────────────────

  const CUSTOM_SLA = {
    LOW: { dueAfterHours: 80, managerEscalationAfterHours: 48, headEscalationAfterHours: 96 },
    MEDIUM: { dueAfterHours: 40, managerEscalationAfterHours: 24, headEscalationAfterHours: 48 },
    HIGH: { dueAfterHours: 12, managerEscalationAfterHours: 6, headEscalationAfterHours: 12 },
    CRITICAL: { dueAfterHours: 2, managerEscalationAfterHours: 1, headEscalationAfterHours: 2 },
  };

  describe('getTaskSla', () => {
    it('returns the stored settings when present', async () => {
      prisma.organization.findUnique.mockResolvedValue({ ...ORG_A, settings: { taskSla: CUSTOM_SLA } });

      const result = await service.getTaskSla('org-a');

      expect(result).toEqual(CUSTOM_SLA);
    });

    it('falls back to the platform default when settings.taskSla is absent', async () => {
      prisma.organization.findUnique.mockResolvedValue({ ...ORG_A, settings: null });

      const result = await service.getTaskSla('org-a');

      expect(result.CRITICAL.dueAfterHours).toBe(4);
      expect(result.LOW.dueAfterHours).toBe(80);
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.getTaskSla('missing')).rejects.toThrow(NotFoundException);
    });

    itEnforcesTenantIsolation('getTaskSla reads only the requested tenant\'s own settings', async () => {
      const settingsByOrg: Record<string, { taskSla: typeof CUSTOM_SLA }> = {
        'org-a': { taskSla: CUSTOM_SLA },
      };
      prisma.organization.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          settingsByOrg[where.id] ? { ...ORG_A, id: where.id, settings: settingsByOrg[where.id] } : null,
        ),
      );

      const resultA = await service.getTaskSla('org-a');
      expect(resultA).toEqual(CUSTOM_SLA);

      // org-b has no stored settings of its own — must never see org-a's.
      await expect(service.getTaskSla('org-b')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateTaskSla', () => {
    it('writes the full settings.taskSla object and logs an audit entry, without touching other settings keys', async () => {
      prisma.organization.findUnique.mockResolvedValue({
        ...ORG_A,
        settings: { ai: { monthlyCredits: 500 } },
      });
      prisma.organization.update.mockResolvedValue({ ...ORG_A });

      await service.updateTaskSla('org-a', CUSTOM_SLA, 'user-1');

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-a' },
        data: { settings: { ai: { monthlyCredits: 500 }, taskSla: CUSTOM_SLA } },
      });
      expect(auditLog.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'UPDATE',
          objectType: 'Organization',
          objectId: 'org-a',
          actorId: 'user-1',
          tenantId: 'org-a',
        }),
      );
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);
      await expect(service.updateTaskSla('missing', CUSTOM_SLA, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    itEnforcesTenantIsolation('updateTaskSla only ever writes the requested tenant\'s own row', async () => {
      prisma.organization.findUnique.mockResolvedValue({ ...ORG_A, id: 'org-a', settings: null });
      prisma.organization.update.mockResolvedValue({ ...ORG_A });

      await service.updateTaskSla('org-a', CUSTOM_SLA, 'user-1');

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({ where: { id: 'org-a' } });
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'org-a' } }),
      );
    });
  });
});
