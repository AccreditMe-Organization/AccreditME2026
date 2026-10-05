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

  // ACC-120 slice 9b — when the lock lifts, and the neutral rows.
  describe('lockedUntil', () => {
    // A typed view of this file's untyped mock, so the new tests read it safely.
    const db = () =>
      mockPrisma as {
        loginAttempt: { findMany: jest.Mock };
        organization: { findUnique: jest.Mock };
      };
    const row = (
      minutes: number,
      over: Partial<{ success: boolean; failureReason: string | null }> = {},
    ) => ({
      success: false,
      failureReason: 'invalid_password',
      createdAt: minutesAgo(minutes),
      ...over,
    });

    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-10-05T09:00:00.000Z') });
      db().organization.findUnique.mockResolvedValue({
        id: ORG_A,
        authConfig: null,
      });
    });
    afterEach(() => jest.useRealTimers());

    it('is null with fewer than five failures in the streak', async () => {
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        row(3),
        row(4),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toBeNull();
    });

    it('is the fifth newest failure plus the window', async () => {
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        row(3),
        row(4),
        row(5),
        row(6),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toEqual(
        new Date(minutesAgo(5).getTime() + 15 * 60 * 1000),
      );
    });

    it('stops at a success', async () => {
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        row(3),
        row(4),
        row(5, { success: true, failureReason: null }),
        row(6),
        row(7),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toBeNull();
    });

    it('skips an account_inactive row — neither a failure nor a reset', async () => {
      const inactive = row(3, { failureReason: 'account_inactive' });
      // Four failures and an inactive refusal: not five failures, so no lock.
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        inactive,
        row(4),
        row(5),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toBeNull();
      // Five failures around it: locked, so it did not reset the streak.
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        inactive,
        row(4),
        row(5),
        row(6),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toEqual(
        new Date(minutesAgo(6).getTime() + 15 * 60 * 1000),
      );
    });

    it('counts a locked attempt as a failure, so trying while locked moves the lock later', async () => {
      db().loginAttempt.findMany.mockResolvedValue([
        row(1, { failureReason: 'locked' }),
        row(2),
        row(3),
        row(4),
        row(5),
        row(6),
      ]);
      expect(await service.lockedUntil(ORG_A, 'a@example.com')).toEqual(
        new Date(minutesAgo(5).getTime() + 15 * 60 * 1000),
      );
    });

    it('agrees with isLocked', async () => {
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        row(3),
        row(4),
        row(5),
      ]);
      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(true);
      db().loginAttempt.findMany.mockResolvedValue([
        row(1),
        row(2),
        row(3),
        row(4),
      ]);
      expect(await service.isLocked(ORG_A, 'a@example.com')).toBe(false);
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
