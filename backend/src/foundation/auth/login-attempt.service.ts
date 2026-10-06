import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptTenantConfig, getEncryptionKey } from '../../common/utils/tenant-config-crypto';

const DEFAULT_LOCKOUT_THRESHOLD = 5;
const DEFAULT_LOCKOUT_WINDOW_MINUTES = 15;

export interface RecordLoginAttemptInput {
  organizationId: string;
  email: string;
  success: boolean;
  failureReason?:
    | 'invalid_password'
    | 'locked'
    | 'no_such_user'
    | 'mfa_failed'
    | 'account_inactive'
    | 'organization_unavailable';
  ipAddress?: string;
  userAgent?: string;
}

// ACC-120 slice 9b — reasons that are RECORDED but are neither a failure nor a
// success as far as the lock is concerned. `account_inactive` is a sign-in with
// the CORRECT password, refused because the account is deactivated or
// suspended: counting it as a failure would lock someone for knowing their own
// password, and counting it as a success would wipe a real failure streak. So
// the streak skips it in both directions, and the attempt is still written down
// (every attempt is — CLAUDE.md, Account Lockout).
//
// ACC-168 — `organization_unavailable` is the same kind of row: the right
// password, refused because the person's organisation is closed. It must not
// lock them out for when the organisation reopens, nor wipe a real streak.
export const NEUTRAL_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'account_inactive',
  'organization_unavailable',
]);

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
    return (await this.lockedUntil(organizationId, email)) !== null;
  }

  // ACC-120 slice 9b — WHEN the lock lifts, or null when there is none.
  //
  // The lock holds while at least `threshold` failures of the current streak
  // are inside the window. The streak is read newest first, so it lifts when
  // the threshold-th most recent failure ages out: that failure's time plus
  // the window. A locked attempt is itself recorded as a failure, so every try
  // made while locked moves this later — by design, see CLAUDE.md's Account
  // Lockout section. Callers that record a locked attempt should read this
  // AFTER recording it, or they report a time the attempt has already moved.
  //
  // Computed purely from (organization, email) rows, so a non-existent email
  // gets exactly the same answer as a real one: the lock never discloses
  // whether an account exists.
  async lockedUntil(
    organizationId: string,
    email: string,
  ): Promise<Date | null> {
    const { threshold, windowMinutes } =
      await this.getLockoutConfig(organizationId);
    const windowMs = windowMinutes * 60 * 1000;
    const since = new Date(Date.now() - windowMs);

    const attempts = await this.prisma.loginAttempt.findMany({
      where: { organizationId, email, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
    });

    const streak: Date[] = [];
    for (const attempt of attempts) {
      if (attempt.success) break;
      if (
        attempt.failureReason &&
        NEUTRAL_FAILURE_REASONS.has(attempt.failureReason)
      )
        continue;
      streak.push(attempt.createdAt);
    }

    const pivot = streak[threshold - 1];
    return pivot ? new Date(pivot.getTime() + windowMs) : null;
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
