import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptTenantConfig, getEncryptionKey } from '../../common/utils/tenant-config-crypto';

const DEFAULT_LOCKOUT_THRESHOLD = 5;
const DEFAULT_LOCKOUT_WINDOW_MINUTES = 15;

export interface RecordLoginAttemptInput {
  organizationId: string;
  email: string;
  success: boolean;
  failureReason?: 'invalid_password' | 'locked' | 'no_such_user' | 'mfa_failed';
  ipAddress?: string;
  userAgent?: string;
}

interface LockoutConfig {
  threshold: number;
  windowMinutes: number;
}

@Injectable()
export class LoginAttemptService {
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: RecordLoginAttemptInput): Promise<void> {
    await this.prisma.loginAttempt.create({
      data: {
        organizationId: entry.organizationId,
        email: entry.email,
        success: entry.success,
        failureReason: entry.failureReason ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  // Reads Organization.authConfig.lockoutThreshold/lockoutWindowMinutes —
  // same encrypted-JSON pattern as storageConfig/aiConfig, decrypted via the
  // shared tenant-config-crypto helpers directly (not through TenantService,
  // per that helper's own stated purpose: avoid depending on TenantModule).
  // Falls back to platform defaults (5 / 15) when authConfig is absent or
  // doesn't specify them.
  private async getLockoutConfig(organizationId: string): Promise<LockoutConfig> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org?.authConfig) {
      return { threshold: DEFAULT_LOCKOUT_THRESHOLD, windowMinutes: DEFAULT_LOCKOUT_WINDOW_MINUTES };
    }

    try {
      const decrypted = decryptTenantConfig(org.authConfig, getEncryptionKey());
      const parsed = JSON.parse(decrypted) as {
        lockoutThreshold?: number;
        lockoutWindowMinutes?: number;
      };
      return {
        threshold: parsed.lockoutThreshold ?? DEFAULT_LOCKOUT_THRESHOLD,
        windowMinutes: parsed.lockoutWindowMinutes ?? DEFAULT_LOCKOUT_WINDOW_MINUTES,
      };
    } catch {
      return { threshold: DEFAULT_LOCKOUT_THRESHOLD, windowMinutes: DEFAULT_LOCKOUT_WINDOW_MINUTES };
    }
  }

  // "Locked if 5+ consecutive failures for this email with no success since,
  // within a rolling window" — computed on read from LoginAttempt's
  // append-only history, no stored mutable counter (same reasoning as
  // AuditLog's design). Counts the failure streak from the most recent
  // attempt backward, stopping at the first success or the window edge.
  async isLocked(organizationId: string, email: string): Promise<boolean> {
    const { threshold, windowMinutes } = await this.getLockoutConfig(organizationId);
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);

    const attempts = await this.prisma.loginAttempt.findMany({
      where: { organizationId, email, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });

    let consecutiveFailures = 0;
    for (const attempt of attempts) {
      if (attempt.success) break;
      consecutiveFailures += 1;
    }

    return consecutiveFailures >= threshold;
  }

  // Deliberately NOT a DB query against LoginAttempt (which has no userId
  // column at all — only the attempted email, since an attempt may never
  // resolve to a real user). User.lastLoginIp already tracks exactly what
  // this needs and is already loaded by AuthService.completeLogin() before
  // it gets overwritten — a pure comparison here is simpler and cheaper than
  // re-deriving the same fact from LoginAttempt rows.
  isNewIp(previousLastLoginIp: string | null, currentIp: string | undefined): boolean {
    if (!currentIp) return false;
    return previousLastLoginIp !== currentIp;
  }
}
