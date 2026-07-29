import { LoginAttemptService } from './login-attempt.service';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptTenantConfig, getEncryptionKey } from '../../common/utils/tenant-config-crypto';

const ORG_A = 'org-a';

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

describe('LoginAttemptService', () => {
  let service: LoginAttemptService;
  let mockPrisma: any;

  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = 'a'.repeat(64); // 32-byte hex
    mockPrisma = {
      loginAttempt: { create: jest.fn().mockResolvedValue({}), findMany: jest.fn() },
      organization: { findUnique: jest.fn() },
    };
    service = new LoginAttemptService(mockPrisma as unknown as PrismaService);
  });

  describe('record', () => {
    it('creates a LoginAttempt row with the given fields', async () => {
      await service.record({
        organizationId: ORG_A,
        email: 'a@example.com',
        success: false,
        failureReason: 'invalid_password',
        ipAddress: '1.2.3.4',
        userAgent: 'jest',
      });

      expect(mockPrisma.loginAttempt.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG_A,
          email: 'a@example.com',
          success: false,
          failureReason: 'invalid_password',
          ipAddress: '1.2.3.4',
          userAgent: 'jest',
        },
      });
    });
  });

  describe('isLocked', () => {
    it('returns false when there are fewer consecutive failures than the platform default threshold (5)', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.loginAttempt.findMany.mockResolvedValue([
        { success: false, createdAt: minutesAgo(1) },
        { success: false, createdAt: minutesAgo(2) },
      ]);

      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(false);
    });

    it('returns true when there are 5+ consecutive failures with no success since', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.loginAttempt.findMany.mockResolvedValue([
        { success: false, createdAt: minutesAgo(1) },
        { success: false, createdAt: minutesAgo(2) },
        { success: false, createdAt: minutesAgo(3) },
        { success: false, createdAt: minutesAgo(4) },
        { success: false, createdAt: minutesAgo(5) },
      ]);

      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(true);
    });

    it('stops counting at the most recent success', async () => {
      mockPrisma.organization.findUnique.mockResolvedValue(null);
      mockPrisma.loginAttempt.findMany.mockResolvedValue([
        { success: false, createdAt: minutesAgo(1) },
        { success: false, createdAt: minutesAgo(2) },
        { success: true, createdAt: minutesAgo(3) },
        { success: false, createdAt: minutesAgo(4) },
        { success: false, createdAt: minutesAgo(5) },
      ]);

      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(false);
    });

    it('honors a tenant-configured lockoutThreshold from authConfig', async () => {
      const encrypted = encryptTenantConfig({ lockoutThreshold: 2 }, getEncryptionKey());
      mockPrisma.organization.findUnique.mockResolvedValue({ authConfig: encrypted });
      mockPrisma.loginAttempt.findMany.mockResolvedValue([
        { success: false, createdAt: minutesAgo(1) },
        { success: false, createdAt: minutesAgo(2) },
      ]);

      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(true);
    });
  });

  describe('isNewIp', () => {
    it('returns true when the current IP differs from the previous lastLoginIp', () => {
      expect(service.isNewIp('1.1.1.1', '2.2.2.2')).toBe(true);
    });

    it('returns false when the current IP matches the previous lastLoginIp', () => {
      expect(service.isNewIp('1.1.1.1', '1.1.1.1')).toBe(false);
    });

    it('returns true when there is no previous lastLoginIp (first-ever login)', () => {
      expect(service.isNewIp(null, '2.2.2.2')).toBe(true);
    });

    it('returns false when the current IP is unknown', () => {
      expect(service.isNewIp('1.1.1.1', undefined)).toBe(false);
    });
  });
});
