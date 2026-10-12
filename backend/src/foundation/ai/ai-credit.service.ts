import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** What a successful reservation took, and from which period. */
export interface ReservedCredits {
  used: number;
  allocation: number;
  periodStart: Date;
  renewsAt: Date;
}

/** The organisation's credit state, read to explain a refusal. */
export interface AiCreditState {
  allocation: number;
  used: number;
  periodStart: Date | null;
  renewsAt: Date | null;
  /** settings.ai.enabled is exactly false. */
  switchedOff: boolean;
}

/**
 * ACC-194 — the hot path of AI metering, as single statements on the
 * Organization row's dedicated columns.
 *
 * WHY THE COLUMNS AND NOT settings.ai: six Organization.settings writers read
 * the whole JSON and write it back with no lock (ACC-215). A stale copy written
 * back would erase a deduction. None of them writes these columns, so none of
 * them can reach the counters.
 *
 * WHY ONE STATEMENT IS ENOUGH: Postgres serialises concurrent UPDATEs of one
 * row, and under READ COMMITTED the second re-checks its WHERE against the row
 * the first committed. Two calls can never both take the last credits, and the
 * balance can never go negative. Proved against a real Postgres in
 * ai-credit.db-spec.ts (npm run test:db), not by these comments.
 */
@Injectable()
export class AiCreditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Take `cost` credits from the current period, or nothing. Null when the
   * organisation has no allocation, is switched off, has a period that is due
   * for renewal (the caller renews and retries), or has too few credits left.
   */
  async reserve(organizationId: string, cost: number, now: Date = new Date()): Promise<ReservedCredits | null> {
    const rows = await this.prisma.$queryRaw<
      { aiCreditsUsed: number; aiMonthlyCredits: number; aiCreditsPeriodStart: Date; aiCreditsRenewsAt: Date }[]
    >`
      UPDATE "Organization"
      SET "aiCreditsUsed" = "aiCreditsUsed" + ${cost}::int
      WHERE "id" = ${organizationId}
        AND "aiMonthlyCredits" > 0
        AND NOT COALESCE(("settings" -> 'ai' -> 'enabled') = 'false'::jsonb, false)
        AND "aiCreditsRenewsAt" > ${now}
        AND "aiCreditsUsed" + ${cost}::int <= "aiMonthlyCredits"
      RETURNING "aiCreditsUsed", "aiMonthlyCredits", "aiCreditsPeriodStart", "aiCreditsRenewsAt"`;
    const row = rows[0];
    if (!row) return null;
    return {
      used: row.aiCreditsUsed,
      allocation: row.aiMonthlyCredits,
      periodStart: row.aiCreditsPeriodStart,
      renewsAt: row.aiCreditsRenewsAt,
    };
  }

  /**
   * Give back a failed call's credits — only within the period they were taken
   * from. If the period renewed during the call, the old period's usage is
   * already gone, and refunding into the new period would give credits away.
   */
  async refund(organizationId: string, cost: number, periodStart: Date): Promise<boolean> {
    const changed = await this.prisma.$executeRaw`
      UPDATE "Organization"
      SET "aiCreditsUsed" = GREATEST("aiCreditsUsed" - ${cost}::int, 0)
      WHERE "id" = ${organizationId}
        AND "aiCreditsPeriodStart" = ${periodStart}`;
    return changed === 1;
  }

  async state(organizationId: string): Promise<AiCreditState | null> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId },
      select: {
        aiMonthlyCredits: true,
        aiCreditsUsed: true,
        aiCreditsPeriodStart: true,
        aiCreditsRenewsAt: true,
        settings: true,
      },
    });
    if (!org) return null;
    return {
      allocation: org.aiMonthlyCredits,
      used: org.aiCreditsUsed,
      periodStart: org.aiCreditsPeriodStart,
      renewsAt: org.aiCreditsRenewsAt,
      switchedOff: aiSwitchedOff(org.settings),
    };
  }

  /**
   * Claim this period's "credits used up" notice. Only the call that moves the
   * stamp to this period gets true, so the notice is sent once per period, and
   * a new period makes it sendable again on its own.
   */
  async claimNotice(organizationId: string, periodStart: Date): Promise<boolean> {
    const claimed = await this.prisma.organization.updateMany({
      where: {
        id: organizationId,
        OR: [{ aiCreditsNoticeFor: null }, { aiCreditsNoticeFor: { not: periodStart } }],
      },
      data: { aiCreditsNoticeFor: periodStart },
    });
    return claimed.count === 1;
  }
}

/** settings.ai.enabled is exactly false. Absent, or anything else, counts as on (D13). */
export function aiSwitchedOff(settings: unknown): boolean {
  const ai = (settings as { ai?: { enabled?: unknown } } | null)?.ai;
  return ai?.enabled === false;
}
