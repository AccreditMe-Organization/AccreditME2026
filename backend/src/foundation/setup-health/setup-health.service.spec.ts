import {
  OVERDUE_AFTER_MS,
  SETUP_CONDITION_TYPES,
  SetupHealthService,
} from './setup-health.service';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG_A = 'cmtr9x7zq0000ocp1am2rs14o';
const ORG_B = 'cmtr9x80q0001ocp1bq3kd2rz';

const NOW = new Date('2026-09-15T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);
const daysAgo = (d: number) => hoursAgo(d * 24);

// ACC-82 — the Setup health read model (SYSTEM-REFERENCE §13).
//
// SetupCondition and SetupConditionRun are in-memory tables that honour the
// filters the service sends the way Postgres would, so an unscoped query reaches
// the other tenant's rows and the isolation tests fail against it.

interface Row {
  id: string;
  organizationId: string;
  type: string;
  severity: string;
  objectId: string;
  subject: unknown;
  openedAt: Date;
  lastSeenAt: Date;
  clearedAt: Date | null;
}

interface Run {
  organizationId: string;
  type: string;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
}

type ConditionWhere = {
  organizationId?: string;
  type?: { in: string[] };
  clearedAt?: null | { gte: Date };
  severity?: string;
};

const matches = (r: Row, w: ConditionWhere) =>
  (w.organizationId === undefined || r.organizationId === w.organizationId) &&
  (w.type === undefined || w.type.in.includes(r.type)) &&
  (w.severity === undefined || r.severity === w.severity) &&
  (w.clearedAt === undefined ||
    (w.clearedAt === null
      ? r.clearedAt === null
      : r.clearedAt !== null && r.clearedAt >= w.clearedAt.gte));

describe('SetupHealthService (ACC-82)', () => {
  let rows: Row[];
  let runs: Run[];
  let prisma: {
    setupCondition: { findMany: jest.Mock; count: jest.Mock };
    setupConditionRun: { findMany: jest.Mock };
  };
  let service: SetupHealthService;

  const row = (overrides: Partial<Row> & Pick<Row, 'id'>): Row => ({
    organizationId: ORG_A,
    type: 'ORG_UNIT_WITHOUT_HEAD',
    severity: 'AT_RISK',
    objectId: `obj-${overrides.id}`,
    subject: { nameEn: overrides.id },
    openedAt: daysAgo(3),
    lastSeenAt: hoursAgo(1),
    clearedAt: null,
    ...overrides,
  });

  const succeededRuns = (organizationId: string, at: Date): Run[] =>
    SETUP_CONDITION_TYPES.map((type) => ({
      organizationId,
      type,
      lastSucceededAt: at,
      lastFailedAt: null,
    }));

  beforeEach(() => {
    rows = [];
    runs = [];
    prisma = {
      setupCondition: {
        findMany: jest.fn(
          ({
            where,
            orderBy,
          }: {
            where: ConditionWhere;
            orderBy?: { clearedAt: 'desc' };
          }) => {
            const hit = rows.filter((r) => matches(r, where));
            if (orderBy)
              hit.sort(
                (a, b) =>
                  (b.clearedAt?.getTime() ?? 0) - (a.clearedAt?.getTime() ?? 0),
              );
            return Promise.resolve(hit.map((r) => ({ ...r })));
          },
        ),
        count: jest.fn(({ where }: { where: ConditionWhere }) =>
          Promise.resolve(rows.filter((r) => matches(r, where)).length),
        ),
      },
      setupConditionRun: {
        findMany: jest.fn(
          ({
            where,
          }: {
            where: { organizationId?: string; type?: { in: string[] } };
          }) =>
            Promise.resolve(
              runs.filter(
                (r) =>
                  (where.organizationId === undefined ||
                    r.organizationId === where.organizationId) &&
                  (where.type === undefined || where.type.in.includes(r.type)),
              ),
            ),
        ),
      },
    };
    service = new SetupHealthService(prisma as unknown as PrismaService);
  });

  describe('getHealth — conditions', () => {
    it('orders open conditions blocking first, then oldest first', async () => {
      rows = [
        row({ id: 'risk-old', severity: 'AT_RISK', openedAt: daysAgo(10) }),
        row({ id: 'block-new', severity: 'BLOCKS_WORK', openedAt: daysAgo(1) }),
        row({ id: 'block-old', severity: 'BLOCKS_WORK', openedAt: daysAgo(5) }),
        row({ id: 'risk-new', severity: 'AT_RISK', openedAt: daysAgo(2) }),
      ];

      const { open } = await service.getHealth(ORG_A, NOW);

      expect(open.map((c) => c.id)).toEqual([
        'block-old',
        'block-new',
        'risk-old',
        'risk-new',
      ]);
    });

    it('lists conditions cleared within seven days, newest first, and nothing older', async () => {
      rows = [
        row({ id: 'open' }),
        row({ id: 'cleared-2d', clearedAt: daysAgo(2) }),
        row({ id: 'cleared-6d', clearedAt: daysAgo(6.9) }),
        row({ id: 'cleared-8d', clearedAt: daysAgo(8) }),
        row({ id: 'cleared-1h', clearedAt: hoursAgo(1) }),
      ];

      const { open, recentlyCleared } = await service.getHealth(ORG_A, NOW);

      expect(open.map((c) => c.id)).toEqual(['open']);
      expect(recentlyCleared.map((c) => c.id)).toEqual([
        'cleared-1h',
        'cleared-2d',
        'cleared-6d',
      ]);
    });

    // §13.3 — the page labels first-detection ages differently.
    it('marks the age basis per type', async () => {
      rows = [
        row({ id: 'unit', type: 'ORG_UNIT_WITHOUT_HEAD' }),
        row({ id: 'stage', type: 'STAGE_WITHOUT_ASSIGNEE' }),
        row({ id: 'task', type: 'TASK_WITHOUT_OWNER' }),
      ];

      const { open } = await service.getHealth(ORG_A, NOW);

      expect(Object.fromEntries(open.map((c) => [c.id, c.ageBasis]))).toEqual({
        unit: 'OBJECT',
        stage: 'OBJECT',
        task: 'FIRST_DETECTED',
      });
    });

    it('returns the subject snapshot and never the organization id', async () => {
      rows = [
        row({ id: 'unit', subject: { nameEn: 'Radiology', nameAr: 'الأشعة' } }),
      ];

      const { open } = await service.getHealth(ORG_A, NOW);

      expect(open[0]).toEqual({
        id: 'unit',
        type: 'ORG_UNIT_WITHOUT_HEAD',
        severity: 'AT_RISK',
        objectId: 'obj-unit',
        subject: { nameEn: 'Radiology', nameAr: 'الأشعة' },
        openedAt: daysAgo(3),
        ageBasis: 'OBJECT',
        lastSeenAt: hoursAgo(1),
        clearedAt: null,
      });
    });
  });

  // §13.5 — "when was this computed" must have an unambiguous answer per type.
  describe('getHealth — freshness', () => {
    const freshnessOf = async (type: string) =>
      (await service.getHealth(ORG_A, NOW)).freshness.find(
        (f) => f.type === type,
      );

    it('reports every type, NEVER_RUN when a type has no run record', async () => {
      const { freshness } = await service.getHealth(ORG_A, NOW);
      expect(freshness).toEqual(
        SETUP_CONDITION_TYPES.map((type) => ({
          type,
          status: 'NEVER_RUN',
          computedAt: null,
        })),
      );
    });

    it('is NEVER_RUN when a run row exists but no evaluation has finished', async () => {
      runs = [
        {
          organizationId: ORG_A,
          type: 'TASK_WITHOUT_OWNER',
          lastSucceededAt: null,
          lastFailedAt: null,
        },
      ];
      expect(await freshnessOf('TASK_WITHOUT_OWNER')).toEqual({
        type: 'TASK_WITHOUT_OWNER',
        status: 'NEVER_RUN',
        computedAt: null,
      });
    });

    it('is CURRENT within two hours of the last success', async () => {
      runs = succeededRuns(ORG_A, new Date(NOW.getTime() - OVERDUE_AFTER_MS));
      expect(await freshnessOf('ORG_UNIT_WITHOUT_HEAD')).toEqual({
        type: 'ORG_UNIT_WITHOUT_HEAD',
        status: 'CURRENT',
        computedAt: new Date(NOW.getTime() - OVERDUE_AFTER_MS),
      });
    });

    it('is OVERDUE when the last success is older than two hours', async () => {
      runs = succeededRuns(ORG_A, hoursAgo(2.5));
      expect(await freshnessOf('ORG_UNIT_WITHOUT_HEAD')).toMatchObject({
        status: 'OVERDUE',
        computedAt: hoursAgo(2.5),
      });
    });

    it('is FAILED when the latest evaluation failed, keeping when rows were last confirmed', async () => {
      runs = [
        {
          organizationId: ORG_A,
          type: 'TASK_WITHOUT_OWNER',
          lastSucceededAt: hoursAgo(5),
          lastFailedAt: hoursAgo(1),
        },
      ];
      expect(await freshnessOf('TASK_WITHOUT_OWNER')).toEqual({
        type: 'TASK_WITHOUT_OWNER',
        status: 'FAILED',
        computedAt: hoursAgo(5),
      });
    });

    it('is FAILED with no computedAt when a type has never succeeded', async () => {
      runs = [
        {
          organizationId: ORG_A,
          type: 'TASK_WITHOUT_OWNER',
          lastSucceededAt: null,
          lastFailedAt: hoursAgo(1),
        },
      ];
      expect(await freshnessOf('TASK_WITHOUT_OWNER')).toMatchObject({
        status: 'FAILED',
        computedAt: null,
      });
    });

    it('is CURRENT again once a success follows the failure', async () => {
      runs = [
        {
          organizationId: ORG_A,
          type: 'TASK_WITHOUT_OWNER',
          lastSucceededAt: hoursAgo(0.5),
          lastFailedAt: hoursAgo(1.5),
        },
      ];
      expect(await freshnessOf('TASK_WITHOUT_OWNER')).toMatchObject({
        status: 'CURRENT',
      });
    });
  });

  describe('getSummary', () => {
    it('counts open conditions and, separately, those blocking work', async () => {
      rows = [
        row({ id: 'a', severity: 'BLOCKS_WORK' }),
        row({ id: 'b', severity: 'AT_RISK' }),
        row({ id: 'c', severity: 'AT_RISK' }),
        row({ id: 'cleared', severity: 'BLOCKS_WORK', clearedAt: hoursAgo(1) }),
      ];
      expect(await service.getSummary(ORG_A)).toEqual({
        open: 3,
        blocksWork: 1,
      });
    });
  });

  // ACC-82 — POSITION_WITHOUT_ROLE is deferred. Its leftover rows are never
  // reconciled again, so reporting them would show conditions nothing clears.
  describe('deferred types', () => {
    beforeEach(() => {
      rows = [
        row({ id: 'unit', type: 'ORG_UNIT_WITHOUT_HEAD' }),
        row({
          id: 'pos-open',
          type: 'POSITION_WITHOUT_ROLE',
          severity: 'BLOCKS_WORK',
        }),
        row({
          id: 'pos-cleared',
          type: 'POSITION_WITHOUT_ROLE',
          clearedAt: hoursAgo(1),
        }),
      ];
      runs = [
        {
          organizationId: ORG_A,
          type: 'POSITION_WITHOUT_ROLE',
          lastSucceededAt: hoursAgo(9),
          lastFailedAt: null,
        },
      ];
    });

    it('reports no open or cleared row, and no freshness, for a deferred type', async () => {
      const { open, recentlyCleared, freshness } = await service.getHealth(
        ORG_A,
        NOW,
      );

      expect(open.map((c) => c.id)).toEqual(['unit']);
      expect(recentlyCleared).toEqual([]);
      expect(freshness.map((f) => f.type)).toEqual([
        'ORG_UNIT_WITHOUT_HEAD',
        'STAGE_WITHOUT_ASSIGNEE',
        'TASK_WITHOUT_OWNER',
        'ACTING_HEAD_OPEN_ENDED',
      ]);
    });

    it('leaves a deferred type out of the badge counts', async () => {
      expect(await service.getSummary(ORG_A)).toEqual({
        open: 1,
        blocksWork: 0,
      });
    });
  });

  describe('tenant isolation', () => {
    beforeEach(() => {
      rows = [
        row({ id: 'b-open', organizationId: ORG_B, severity: 'BLOCKS_WORK' }),
        row({ id: 'b-cleared', organizationId: ORG_B, clearedAt: hoursAgo(1) }),
      ];
      runs = succeededRuns(ORG_B, hoursAgo(0.5));
    });

    itEnforcesTenantIsolation('getHealth conditions', async () => {
      const { open, recentlyCleared } = await service.getHealth(ORG_A, NOW);
      expect(open).toEqual([]);
      expect(recentlyCleared).toEqual([]);
    });

    itEnforcesTenantIsolation('getHealth freshness', async () => {
      const { freshness } = await service.getHealth(ORG_A, NOW);
      expect(freshness.every((f) => f.status === 'NEVER_RUN')).toBe(true);
    });

    itEnforcesTenantIsolation('getSummary', async () => {
      expect(await service.getSummary(ORG_A)).toEqual({
        open: 0,
        blocksWork: 0,
      });
    });
  });
});
