import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { SetupConditionType } from '../../../generated/prisma/client';
import {
  DetectedCondition,
  SetupConditionDetectors,
} from './setup-condition.detectors';

// ACC-82 — SYSTEM-REFERENCE §13.5. The ONLY writer of SetupCondition and
// SetupConditionRun.
//
// For each (tenant, condition type):
//   1. record the attempt (SetupConditionRun.lastAttemptedAt)
//   2. run the type's detector
//   3. in one transaction: open a row for each newly detected object, refresh
//      rows still open, and set clearedAt on open rows whose object is gone
//   4. record success (lastSucceededAt)
//
// FAILURE NEVER CLEARS. If the detector throws, or the transaction fails, no
// SetupCondition row changes — the open rows stay as the last known truth — and
// the failure is recorded (lastFailedAt). A clear means "evaluated and found
// fixed", never "not evaluated". The API reads SetupConditionRun to say which of
// those a type's rows are.
//
// Each pair is isolated: one type failing, or one tenant failing, does not stop
// the rest (the same contract as SlaMonitorProcessor, ACC-49).

// Operators read lastError in the database; it is never returned by the API.
// Bounded so a pathological message cannot bloat the row.
const MAX_ERROR_LENGTH = 1000;

export interface ReconcileTypeResult {
  type: SetupConditionType;
  outcome: 'SUCCEEDED' | 'FAILED';
  opened: number;
  refreshed: number;
  cleared: number;
}

export interface ReconcileAllResult {
  tenants: number;
  failed: { organizationId: string; type: SetupConditionType }[];
}

@Injectable()
export class SetupConditionReconciler {
  private readonly logger = new Logger(SetupConditionReconciler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly detectors: SetupConditionDetectors,
  ) {}

  // Every tenant. The platform org has no tenant configuration to report on.
  async reconcileAll(now: Date = new Date()): Promise<ReconcileAllResult> {
    const tenants = await this.prisma.organization.findMany({
      where: { isPlatformOrg: false },
      select: { id: true },
    });

    const failed: ReconcileAllResult['failed'] = [];
    for (const tenant of tenants) {
      const results = await this.reconcileTenant(tenant.id, now);
      for (const r of results) {
        if (r.outcome === 'FAILED')
          failed.push({ organizationId: tenant.id, type: r.type });
      }
    }
    return { tenants: tenants.length, failed };
  }

  async reconcileTenant(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<ReconcileTypeResult[]> {
    const results: ReconcileTypeResult[] = [];
    const types = Object.keys(this.detectors.byType) as SetupConditionType[];

    for (const type of types) {
      results.push(await this.reconcileType(organizationId, type, now));
    }
    return results;
  }

  async reconcileType(
    organizationId: string,
    type: SetupConditionType,
    now: Date,
  ): Promise<ReconcileTypeResult> {
    const failedResult: ReconcileTypeResult = {
      type,
      outcome: 'FAILED',
      opened: 0,
      refreshed: 0,
      cleared: 0,
    };

    try {
      await this.prisma.setupConditionRun.upsert({
        where: { organizationId_type: { organizationId, type } },
        create: { organizationId, type, lastAttemptedAt: now },
        update: { lastAttemptedAt: now },
      });

      const detected = await this.detectors.byType[type](organizationId);
      const counts = await this.apply(organizationId, type, detected, now);

      await this.prisma.setupConditionRun.update({
        where: { organizationId_type: { organizationId, type } },
        data: { lastSucceededAt: now, lastError: null },
      });

      return { type, outcome: 'SUCCEEDED', ...counts };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Setup health reconciliation failed for ${type} in ${organizationId} — its open conditions are left unchanged. ${message}`,
        err instanceof Error ? err.stack : undefined,
      );
      await this.recordFailure(organizationId, type, now, message);
      return failedResult;
    }
  }

  // Opens, refreshes and clears in one transaction, so a failure part-way leaves
  // every row as it was rather than half-reconciled.
  private async apply(
    organizationId: string,
    type: SetupConditionType,
    detected: DetectedCondition[],
    now: Date,
  ): Promise<Pick<ReconcileTypeResult, 'opened' | 'refreshed' | 'cleared'>> {
    return this.prisma.$transaction(async (tx) => {
      const openRows = await tx.setupCondition.findMany({
        where: { organizationId, type, clearedAt: null },
        select: { id: true, objectId: true, openedAt: true },
        orderBy: { openedAt: 'asc' },
      });

      // One open row per (tenant, type, object) is an invariant the database
      // cannot enforce (§13.4). If a duplicate ever exists, the earliest-opened
      // row is the episode; later duplicates are deleted rather than cleared, so
      // they never appear as a false self-closure.
      const openByObject = new Map<string, { id: string }>();
      const duplicateIds: string[] = [];
      for (const row of openRows) {
        if (openByObject.has(row.objectId)) duplicateIds.push(row.id);
        else openByObject.set(row.objectId, { id: row.id });
      }
      if (duplicateIds.length > 0) {
        await tx.setupCondition.deleteMany({
          where: { organizationId, id: { in: duplicateIds } },
        });
      }

      let opened = 0;
      let refreshed = 0;
      const stillOpen = new Set<string>();

      for (const condition of detected) {
        stillOpen.add(condition.objectId);
        const existing = openByObject.get(condition.objectId);
        if (existing) {
          // openedAt is deliberately untouched: severity may move with coverage,
          // but it is the same episode.
          await tx.setupCondition.updateMany({
            where: { id: existing.id, organizationId },
            data: {
              lastSeenAt: now,
              severity: condition.severity,
              subject: condition.subject,
            },
          });
          refreshed++;
        } else {
          await tx.setupCondition.create({
            data: {
              organizationId,
              type,
              objectId: condition.objectId,
              severity: condition.severity,
              subject: condition.subject,
              // No timestamp on the object: first detection (§13.3).
              openedAt: condition.openedAt ?? now,
              lastSeenAt: now,
            },
          });
          opened++;
        }
      }

      const clearIds = [...openByObject.entries()]
        .filter(([objectId]) => !stillOpen.has(objectId))
        .map(([, row]) => row.id);
      if (clearIds.length > 0) {
        await tx.setupCondition.updateMany({
          where: { organizationId, id: { in: clearIds }, clearedAt: null },
          data: { clearedAt: now },
        });
      }

      return { opened, refreshed, cleared: clearIds.length };
    });
  }

  // Best effort: if even recording the failure fails (the database is
  // unreachable), the log line above is the record, and the run row keeps
  // whatever it last had — which the API already reports as stale.
  private async recordFailure(
    organizationId: string,
    type: SetupConditionType,
    now: Date,
    message: string,
  ): Promise<void> {
    try {
      await this.prisma.setupConditionRun.upsert({
        where: { organizationId_type: { organizationId, type } },
        create: {
          organizationId,
          type,
          lastAttemptedAt: now,
          lastFailedAt: now,
          lastError: message.slice(0, MAX_ERROR_LENGTH),
        },
        update: {
          lastFailedAt: now,
          lastError: message.slice(0, MAX_ERROR_LENGTH),
        },
      });
    } catch (recordErr) {
      this.logger.error(
        `Could not record the Setup health failure for ${type} in ${organizationId}.`,
        recordErr instanceof Error ? recordErr.stack : undefined,
      );
    }
  }
}
