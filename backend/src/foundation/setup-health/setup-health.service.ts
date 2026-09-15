import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  SetupConditionSeverity,
  SetupConditionType,
} from '../../../generated/prisma/client';
import {
  ISetupCondition,
  ISetupConditionFreshness,
  ISetupHealth,
  ISetupHealthSummary,
  SetupConditionAgeBasis,
} from './interfaces/setup-health.interface';

// ACC-82 — SYSTEM-REFERENCE §13. Read side of Setup health. Never writes: the
// reconciler is the only writer of SetupCondition and SetupConditionRun.

// Twice the hourly interval: one missed run is tolerated, two are reported.
export const OVERDUE_AFTER_MS = 2 * 60 * 60 * 1000;
export const RECENTLY_CLEARED_DAYS = 7;

// Every type, in page order. Kept here rather than read from the enum object,
// which does not exist under Jest's generated-client stub.
export const SETUP_CONDITION_TYPES: SetupConditionType[] = [
  'ORG_UNIT_WITHOUT_HEAD',
  'STAGE_WITHOUT_ASSIGNEE',
  'TASK_WITHOUT_OWNER',
  'POSITION_WITHOUT_ROLE',
];

// §13.3. Per type, because it follows from what each detector can read: units
// carry headVacantSince and stage instances unassignedAt; tasks and positions
// carry nothing. (If a unit's headVacantSince were ever null, its age would also
// be first detection — the flag and the timestamp are written together by the
// same sweep, so that is not expected.)
const AGE_BASIS: Record<SetupConditionType, SetupConditionAgeBasis> = {
  ORG_UNIT_WITHOUT_HEAD: 'OBJECT',
  STAGE_WITHOUT_ASSIGNEE: 'OBJECT',
  TASK_WITHOUT_OWNER: 'FIRST_DETECTED',
  POSITION_WITHOUT_ROLE: 'FIRST_DETECTED',
};

const SEVERITY_RANK: Record<SetupConditionSeverity, number> = {
  BLOCKS_WORK: 0,
  AT_RISK: 1,
};

const CONDITION_SELECT = {
  id: true,
  type: true,
  severity: true,
  objectId: true,
  subject: true,
  openedAt: true,
  lastSeenAt: true,
  clearedAt: true,
} as const;

@Injectable()
export class SetupHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<ISetupHealth> {
    const clearedSince = new Date(
      now.getTime() - RECENTLY_CLEARED_DAYS * 24 * 60 * 60 * 1000,
    );

    const [openRows, clearedRows, runs] = await Promise.all([
      this.prisma.setupCondition.findMany({
        where: { organizationId, clearedAt: null },
        select: CONDITION_SELECT,
      }),
      this.prisma.setupCondition.findMany({
        where: { organizationId, clearedAt: { gte: clearedSince } },
        select: CONDITION_SELECT,
        orderBy: { clearedAt: 'desc' },
      }),
      this.prisma.setupConditionRun.findMany({
        where: { organizationId },
        select: { type: true, lastSucceededAt: true, lastFailedAt: true },
      }),
    ]);

    const open = openRows
      .map((row) => this.toCondition(row))
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          a.openedAt.getTime() - b.openedAt.getTime(),
      );

    return {
      open,
      recentlyCleared: clearedRows.map((row) => this.toCondition(row)),
      freshness: SETUP_CONDITION_TYPES.map((type) =>
        this.freshnessOf(
          type,
          runs.find((r) => r.type === type),
          now,
        ),
      ),
    };
  }

  // The rail badge. Counts every open row, including those of a type whose last
  // evaluation failed: they are the last known truth, not resolved.
  async getSummary(organizationId: string): Promise<ISetupHealthSummary> {
    const [open, blocksWork] = await Promise.all([
      this.prisma.setupCondition.count({
        where: { organizationId, clearedAt: null },
      }),
      this.prisma.setupCondition.count({
        where: { organizationId, clearedAt: null, severity: 'BLOCKS_WORK' },
      }),
    ]);
    return { open, blocksWork };
  }

  private toCondition(row: {
    id: string;
    type: SetupConditionType;
    severity: SetupConditionSeverity;
    objectId: string;
    subject: unknown;
    openedAt: Date;
    lastSeenAt: Date;
    clearedAt: Date | null;
  }): ISetupCondition {
    return {
      id: row.id,
      type: row.type,
      severity: row.severity,
      objectId: row.objectId,
      subject:
        row.subject && typeof row.subject === 'object'
          ? (row.subject as Record<string, unknown>)
          : {},
      openedAt: row.openedAt,
      ageBasis: AGE_BASIS[row.type],
      lastSeenAt: row.lastSeenAt,
      clearedAt: row.clearedAt,
    };
  }

  private freshnessOf(
    type: SetupConditionType,
    run:
      { lastSucceededAt: Date | null; lastFailedAt: Date | null } | undefined,
    now: Date,
  ): ISetupConditionFreshness {
    const succeeded = run?.lastSucceededAt ?? null;
    const failed = run?.lastFailedAt ?? null;

    if (!succeeded && !failed) {
      return { type, status: 'NEVER_RUN', computedAt: null };
    }
    if (failed && (!succeeded || failed > succeeded)) {
      return { type, status: 'FAILED', computedAt: succeeded };
    }
    const age = now.getTime() - (succeeded as Date).getTime();
    return {
      type,
      status: age > OVERDUE_AFTER_MS ? 'OVERDUE' : 'CURRENT',
      computedAt: succeeded,
    };
  }
}
