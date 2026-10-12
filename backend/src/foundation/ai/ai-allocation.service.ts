import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogService } from '../../common/services/audit-log.service';
import { activationOf, creditPeriodAt } from './ai-credit-period';

/** Where an allocation came from (Ahmad, 12 Oct, D3 and D15). */
export type AiAllocationSource = 'plan' | 'manual';

export interface AiAllocationOutcome {
  allocation: number;
  pendingAllocation: number | null;
  /** 'now' for a raise or a first allocation; 'next_renewal' for a cut. */
  takesEffect: 'now' | 'next_renewal';
  renewed: boolean;
}

interface LockedOrganization {
  id: string;
  aiMonthlyCredits: number;
  aiPendingMonthlyCredits: number | null;
  aiCreditsUsed: number;
  aiCreditsPeriodStart: Date | null;
  aiCreditsRenewsAt: Date | null;
  bootstrappedAt: Date | null;
  createdAt: Date;
}

type Tx = Parameters<Parameters<PrismaService['$transaction']>[0]>[0];

interface RenewalChange {
  previousPeriodStart: Date | null;
  usedBefore: number;
  allocationBefore: number;
  allocationAfter: number;
  periodStart: Date;
  renewsAt: Date;
}

/**
 * ACC-194 — the ONE writer of an organisation's AI allocation and its renewal.
 *
 * Both take the Organization row lock (SELECT … FOR UPDATE) in a short
 * transaction, so a plan change and a renewal cannot interleave, and a second
 * worker renewing the same organisation waits and then finds nothing due. The
 * hot path — reserving and refunding credits — is single statements in
 * AiCreditService and never takes this lock.
 *
 * The rules (Ahmad, 12 Oct):
 *   - D3: setting or changing a plan sets the allocation to the plan's
 *     aiCreditsPerMonth, replacing any earlier value, a manual one included.
 *   - D15: a manual allocation has the same timing. A RAISE applies now (the
 *     difference is available at once, since remaining = allocation − used); a
 *     CUT waits for the next renewal, in aiPendingMonthlyCredits.
 *   - Renewal restores the allocation (used back to 0) and applies a waiting
 *     cut. A missed renewal catches up straight to the current period with one
 *     refill, never one per missed period.
 */
@Injectable()
export class AiAllocationService {
  private readonly logger = new Logger(AiAllocationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  async setAllocation(
    organizationId: string,
    credits: number,
    source: AiAllocationSource,
    actorId?: string,
    now: Date = new Date(),
  ): Promise<AiAllocationOutcome> {
    const result = await this.prisma.$transaction(async (tx) => {
      const org = await this.lock(tx, organizationId);
      const renewal = this.renewalIfDue(org, now);
      const current = renewal ? renewal.allocationAfter : org.aiMonthlyCredits;
      const pendingBefore = renewal ? null : org.aiPendingMonthlyCredits;

      const raise = credits >= current;
      const allocation = raise ? credits : current;
      const pendingAllocation = raise ? null : credits;

      // A first allocation sets up the period the organisation is in now.
      let periodStart = renewal ? renewal.periodStart : org.aiCreditsPeriodStart;
      let renewsAt = renewal ? renewal.renewsAt : org.aiCreditsRenewsAt;
      let used = renewal ? 0 : org.aiCreditsUsed;
      if (periodStart === null && allocation > 0) {
        const period = creditPeriodAt(activationOf(org), now);
        periodStart = period.start;
        renewsAt = period.renewsAt;
        used = 0;
      }

      await tx.organization.update({
        where: { id: organizationId },
        data: {
          aiMonthlyCredits: allocation,
          aiPendingMonthlyCredits: pendingAllocation,
          aiCreditsUsed: used,
          aiCreditsPeriodStart: periodStart,
          aiCreditsRenewsAt: renewsAt,
        },
      });

      return { renewal, before: { allocation: current, pendingAllocation: pendingBefore }, allocation, pendingAllocation, raise };
    });

    if (result.renewal) await this.auditRenewal(organizationId, result.renewal);
    await this.auditLog.log({
      tenantId: organizationId,
      actorId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      before: { aiMonthlyCredits: result.before.allocation, aiPendingMonthlyCredits: result.before.pendingAllocation },
      after: { aiMonthlyCredits: result.allocation, aiPendingMonthlyCredits: result.pendingAllocation },
      metadata: {
        event: 'ai_allocation_changed',
        source,
        requested: credits,
        takesEffect: result.raise ? 'now' : 'next_renewal',
      },
    });

    return {
      allocation: result.allocation,
      pendingAllocation: result.pendingAllocation,
      takesEffect: result.raise ? 'now' : 'next_renewal',
      renewed: result.renewal !== null,
    };
  }

  /** Renew this organisation's period if its renewal time has passed. Idempotent. */
  async renewIfDue(organizationId: string, now: Date = new Date()): Promise<boolean> {
    const renewal = await this.prisma.$transaction(async (tx) => {
      const org = await this.lock(tx, organizationId);
      const change = this.renewalIfDue(org, now);
      if (!change) return null;
      await tx.organization.update({
        where: { id: organizationId },
        data: {
          aiCreditsUsed: 0,
          aiMonthlyCredits: change.allocationAfter,
          aiPendingMonthlyCredits: null,
          aiCreditsPeriodStart: change.periodStart,
          aiCreditsRenewsAt: change.renewsAt,
        },
      });
      return change;
    });
    if (!renewal) return false;
    await this.auditRenewal(organizationId, renewal);
    return true;
  }

  /**
   * The hourly sweep: every organisation whose renewal time has passed. One
   * organisation failing never stops the others; failures are returned so the
   * job can show as failed.
   */
  async renewDue(now: Date = new Date()): Promise<{ renewed: number; failed: string[] }> {
    const due = await this.prisma.organization.findMany({
      where: { aiCreditsRenewsAt: { lte: now } },
      select: { id: true },
    });
    let renewed = 0;
    const failed: string[] = [];
    for (const { id } of due) {
      try {
        if (await this.renewIfDue(id, now)) renewed++;
      } catch (error) {
        failed.push(id);
        this.logger.error(`AI credit renewal failed for org ${id}: ${(error as Error).message}`);
      }
    }
    return { renewed, failed };
  }

  private async lock(tx: Tx, organizationId: string): Promise<LockedOrganization> {
    await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
    return tx.organization.findFirstOrThrow({
      where: { id: organizationId },
      select: {
        id: true,
        aiMonthlyCredits: true,
        aiPendingMonthlyCredits: true,
        aiCreditsUsed: true,
        aiCreditsPeriodStart: true,
        aiCreditsRenewsAt: true,
        bootstrappedAt: true,
        createdAt: true,
      },
    });
  }

  private renewalIfDue(org: LockedOrganization, now: Date): RenewalChange | null {
    if (!org.aiCreditsRenewsAt || org.aiCreditsRenewsAt.getTime() > now.getTime()) return null;
    const period = creditPeriodAt(activationOf(org), now);
    return {
      previousPeriodStart: org.aiCreditsPeriodStart,
      usedBefore: org.aiCreditsUsed,
      allocationBefore: org.aiMonthlyCredits,
      allocationAfter: org.aiPendingMonthlyCredits ?? org.aiMonthlyCredits,
      periodStart: period.start,
      renewsAt: period.renewsAt,
    };
  }

  private async auditRenewal(organizationId: string, change: RenewalChange): Promise<void> {
    await this.auditLog.log({
      tenantId: organizationId,
      action: 'UPDATE',
      objectType: 'Organization',
      objectId: organizationId,
      before: {
        aiCreditsPeriodStart: change.previousPeriodStart?.toISOString() ?? null,
        aiCreditsUsed: change.usedBefore,
        aiMonthlyCredits: change.allocationBefore,
      },
      after: {
        aiCreditsPeriodStart: change.periodStart.toISOString(),
        aiCreditsRenewsAt: change.renewsAt.toISOString(),
        aiCreditsUsed: 0,
        aiMonthlyCredits: change.allocationAfter,
      },
      metadata: { event: 'ai_credits_renewed' },
    });
  }
}
