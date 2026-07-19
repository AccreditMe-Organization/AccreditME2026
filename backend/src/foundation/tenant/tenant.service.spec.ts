import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { TenantService } from './tenant.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { LookupService } from '../lookup/lookup.service';

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
  };
  let auditLog: { log: jest.Mock };
  let lookupService: { seedSystemData: jest.Mock };

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
    };

    auditLog     = { log: jest.fn().mockResolvedValue(undefined) };
    lookupService = { seedSystemData: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantService,
        { provide: PrismaService,  useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
        { provide: LookupService,  useValue: lookupService },
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

      expect(lookupService.seedSystemData).toHaveBeenCalledTimes(1);
      expect(prisma.organization.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'org-a' },
          data: expect.objectContaining({ isBootstrapped: true }),
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
});
