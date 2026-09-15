import { SetupConditionReconciler } from './setup-condition.reconciler';
import {
  DetectedCondition,
  SetupConditionDetectors,
} from './setup-condition.detectors';
import { PrismaService } from '../../prisma/prisma.service';
import type { SetupConditionType } from '../../../generated/prisma/client';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

const ORG_A = 'cmtr9x7zq0000ocp1am2rs14o';
const ORG_B = 'cmtr9x80q0001ocp1bq3kd2rz';

const T0 = new Date('2026-09-10T08:00:00.000Z');
const T1 = new Date('2026-09-10T09:00:00.000Z');
const T2 = new Date('2026-09-10T10:00:00.000Z');

// ACC-82 — the Setup health reconciler (SYSTEM-REFERENCE §13.5).
//
// SetupCondition and SetupConditionRun are in-memory tables that honour the
// filters the reconciler sends the way Postgres would: a query WITHOUT a tenant
// filter reaches another tenant's rows. $transaction snapshots and restores on a
// throw, so "a failure part-way changes nothing" is tested against rollback
// semantics rather than assumed.

interface ConditionRow {
  id: string;
  organizationId: string;
  type: string;
  objectId: string;
  severity: string;
  subject: Record<string, unknown>;
  openedAt: Date;
  lastSeenAt: Date;
  clearedAt: Date | null;
}

interface RunRow {
  organizationId: string;
  type: string;
  lastAttemptedAt: Date;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
  lastError: string | null;
}

type Where = {
  id?: string | { in: string[] };
  organizationId?: string;
  type?: string;
  clearedAt?: null;
};

const matches = (row: ConditionRow, where: Where): boolean => {
  if (
    where.organizationId !== undefined &&
    row.organizationId !== where.organizationId
  )
    return false;
  if (where.type !== undefined && row.type !== where.type) return false;
  if (where.clearedAt === null && row.clearedAt !== null) return false;
  if (typeof where.id === 'string' && row.id !== where.id) return false;
  if (typeof where.id === 'object' && !where.id.in.includes(row.id))
    return false;
  return true;
};

function buildDb() {
  let conditions: ConditionRow[] = [];
  let runs: RunRow[] = [];
  let nextId = 1;

  const runKey = (w: {
    organizationId_type: { organizationId: string; type: string };
  }) =>
    runs.find(
      (r) =>
        r.organizationId === w.organizationId_type.organizationId &&
        r.type === w.organizationId_type.type,
    );

  const setupCondition = {
    findMany: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(
        conditions
          .filter((r) => matches(r, where))
          .sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime())
          .map((r) => ({ ...r })),
      ),
    ),
    create: jest.fn(
      ({ data }: { data: Omit<ConditionRow, 'id' | 'clearedAt'> }) => {
        const row: ConditionRow = {
          id: `sc-${nextId++}`,
          clearedAt: null,
          ...data,
        };
        conditions.push(row);
        return Promise.resolve({ ...row });
      },
    ),
    updateMany: jest.fn(
      ({ where, data }: { where: Where; data: Partial<ConditionRow> }) => {
        const hit = conditions.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hit.length });
      },
    ),
    deleteMany: jest.fn(({ where }: { where: Where }) => {
      const before = conditions.length;
      conditions = conditions.filter((r) => !matches(r, where));
      return Promise.resolve({ count: before - conditions.length });
    }),
  };

  const setupConditionRun = {
    upsert: jest.fn(
      ({
        where,
        create,
        update,
      }: {
        where: {
          organizationId_type: { organizationId: string; type: string };
        };
        create: Partial<RunRow> & { organizationId: string; type: string };
        update: Partial<RunRow>;
      }) => {
        const existing = runKey(where);
        if (existing) Object.assign(existing, update);
        else
          runs.push({
            lastSucceededAt: null,
            lastFailedAt: null,
            lastError: null,
            lastAttemptedAt: create.lastAttemptedAt as Date,
            ...create,
          });
        return Promise.resolve({});
      },
    ),
    update: jest.fn(
      ({
        where,
        data,
      }: {
        where: {
          organizationId_type: { organizationId: string; type: string };
        };
        data: Partial<RunRow>;
      }) => {
        const existing = runKey(where);
        if (!existing)
          return Promise.reject(new Error('Record to update not found'));
        Object.assign(existing, data);
        return Promise.resolve({});
      },
    ),
  };

  const tx = { setupCondition };
  const prisma = {
    setupCondition,
    setupConditionRun,
    organization: { findMany: jest.fn() },
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      const snapshot = conditions.map((r) => ({ ...r }));
      try {
        return await fn(tx);
      } catch (err) {
        conditions = snapshot;
        throw err;
      }
    }),
  };

  return {
    prisma,
    rows: () => conditions,
    seed: (
      row: Partial<ConditionRow> &
        Pick<ConditionRow, 'organizationId' | 'objectId'>,
    ) => {
      const full: ConditionRow = {
        id: `sc-${nextId++}`,
        type: 'ORG_UNIT_WITHOUT_HEAD',
        severity: 'AT_RISK',
        subject: {},
        openedAt: T0,
        lastSeenAt: T0,
        clearedAt: null,
        ...row,
      };
      conditions.push(full);
      return full;
    },
    run: (organizationId: string, type: string) =>
      runs.find((r) => r.organizationId === organizationId && r.type === type),
  };
}

const detected = (
  objectId: string,
  overrides: Partial<DetectedCondition> = {},
): DetectedCondition => ({
  objectId,
  severity: 'AT_RISK',
  openedAt: null,
  subject: { nameEn: objectId },
  ...overrides,
});

describe('SetupConditionReconciler (ACC-82)', () => {
  let db: ReturnType<typeof buildDb>;
  let byType: Record<SetupConditionType, jest.Mock>;
  let reconciler: SetupConditionReconciler;

  beforeEach(() => {
    db = buildDb();
    byType = {
      ORG_UNIT_WITHOUT_HEAD: jest.fn().mockResolvedValue([]),
      STAGE_WITHOUT_ASSIGNEE: jest.fn().mockResolvedValue([]),
      TASK_WITHOUT_OWNER: jest.fn().mockResolvedValue([]),
      POSITION_WITHOUT_ROLE: jest.fn().mockResolvedValue([]),
    };
    reconciler = new SetupConditionReconciler(
      db.prisma as unknown as PrismaService,
      { byType } as unknown as SetupConditionDetectors,
    );
    jest
      .spyOn(reconciler['logger'], 'error')
      .mockImplementation(() => undefined);
  });

  describe('reconcileType — success', () => {
    it("opens a row per new object, at the object's own timestamp when it has one", async () => {
      const since = new Date('2026-09-01T00:00:00.000Z');
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([
        detected('unit-1', { openedAt: since }),
      ]);

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T1,
      );

      expect(result).toEqual({
        type: 'ORG_UNIT_WITHOUT_HEAD',
        outcome: 'SUCCEEDED',
        opened: 1,
        refreshed: 0,
        cleared: 0,
      });
      expect(db.rows()).toEqual([
        expect.objectContaining({
          organizationId: ORG_A,
          type: 'ORG_UNIT_WITHOUT_HEAD',
          objectId: 'unit-1',
          openedAt: since,
          lastSeenAt: T1,
          clearedAt: null,
        }),
      ]);
    });

    // §13.3 — tasks and positions carry no timestamp, so age is first detection.
    it('opens at the reconciliation time when the object has no timestamp', async () => {
      byType.TASK_WITHOUT_OWNER.mockResolvedValue([detected('task-1')]);
      await reconciler.reconcileType(ORG_A, 'TASK_WITHOUT_OWNER', T1);
      expect(db.rows()[0]?.openedAt).toEqual(T1);
    });

    it('refreshes an open row in place, keeping openedAt when severity changes', async () => {
      const row = db.seed({
        organizationId: ORG_A,
        objectId: 'unit-1',
        severity: 'AT_RISK',
      });
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([
        detected('unit-1', {
          severity: 'BLOCKS_WORK',
          // A detector timestamp that moved must not re-date the episode.
          openedAt: T1,
          subject: { nameEn: 'Renamed unit' },
        }),
      ]);

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T2,
      );

      expect(result).toMatchObject({ opened: 0, refreshed: 1, cleared: 0 });
      expect(db.rows()).toHaveLength(1);
      expect(db.rows()[0]).toMatchObject({
        id: row.id,
        severity: 'BLOCKS_WORK',
        subject: { nameEn: 'Renamed unit' },
        openedAt: T0,
        lastSeenAt: T2,
        clearedAt: null,
      });
    });

    it('clears an open row whose object is no longer detected, keeping its subject', async () => {
      db.seed({
        organizationId: ORG_A,
        objectId: 'unit-1',
        subject: { nameEn: 'Radiology' },
      });

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T1,
      );

      expect(result).toMatchObject({ opened: 0, refreshed: 0, cleared: 1 });
      expect(db.rows()[0]).toMatchObject({
        clearedAt: T1,
        lastSeenAt: T0,
        subject: { nameEn: 'Radiology' },
      });
    });

    // A cleared row is a closed episode. The condition returning is a new one.
    it('opens a new episode when a cleared condition returns, leaving the old row closed', async () => {
      db.seed({ organizationId: ORG_A, objectId: 'unit-1', clearedAt: T1 });
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([detected('unit-1')]);

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T2,
      );

      expect(result).toMatchObject({ opened: 1, refreshed: 0, cleared: 0 });
      expect(db.rows().map((r) => r.clearedAt)).toEqual([T1, null]);
    });

    it('only touches rows of the type being reconciled', async () => {
      db.seed({
        organizationId: ORG_A,
        objectId: 'task-1',
        type: 'TASK_WITHOUT_OWNER',
      });

      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);

      expect(db.rows()[0]?.clearedAt).toBeNull();
    });

    // §13.4 — the invariant the database cannot enforce.
    it('collapses duplicate open rows onto the earliest, deleting rather than clearing the rest', async () => {
      const first = db.seed({
        organizationId: ORG_A,
        objectId: 'unit-1',
        openedAt: T0,
      });
      db.seed({ organizationId: ORG_A, objectId: 'unit-1', openedAt: T1 });
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([detected('unit-1')]);

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T2,
      );

      expect(result).toMatchObject({ opened: 0, refreshed: 1, cleared: 0 });
      expect(db.rows()).toEqual([
        expect.objectContaining({
          id: first.id,
          clearedAt: null,
          lastSeenAt: T2,
        }),
      ]);
    });

    it('records the attempt and the success on the run row', async () => {
      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);
      expect(db.run(ORG_A, 'ORG_UNIT_WITHOUT_HEAD')).toEqual({
        organizationId: ORG_A,
        type: 'ORG_UNIT_WITHOUT_HEAD',
        lastAttemptedAt: T1,
        lastSucceededAt: T1,
        lastFailedAt: null,
        lastError: null,
      });
    });

    it('keeps the last failure time after a later success, and drops its error', async () => {
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValueOnce(new Error('boom'));
      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);
      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T2);

      expect(db.run(ORG_A, 'ORG_UNIT_WITHOUT_HEAD')).toMatchObject({
        lastAttemptedAt: T2,
        lastSucceededAt: T2,
        lastFailedAt: T1,
        lastError: null,
      });
    });
  });

  // FAILURE NEVER CLEARS — the rule the whole freshness model rests on.
  describe('reconcileType — failure', () => {
    it('leaves every open row untouched when the detector throws', async () => {
      db.seed({ organizationId: ORG_A, objectId: 'unit-1' });
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValue(
        new Error('connection reset'),
      );

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T1,
      );

      expect(result).toEqual({
        type: 'ORG_UNIT_WITHOUT_HEAD',
        outcome: 'FAILED',
        opened: 0,
        refreshed: 0,
        cleared: 0,
      });
      expect(db.rows()[0]).toMatchObject({ clearedAt: null, lastSeenAt: T0 });
      expect(db.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('records the failure without a success, leaving the previous success in place', async () => {
      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T0);
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValue(
        new Error('connection reset'),
      );

      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);

      expect(db.run(ORG_A, 'ORG_UNIT_WITHOUT_HEAD')).toEqual({
        organizationId: ORG_A,
        type: 'ORG_UNIT_WITHOUT_HEAD',
        lastAttemptedAt: T1,
        lastSucceededAt: T0,
        lastFailedAt: T1,
        lastError: 'connection reset',
      });
    });

    it('bounds the stored error message', async () => {
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValue(
        new Error('x'.repeat(5000)),
      );
      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);
      expect(db.run(ORG_A, 'ORG_UNIT_WITHOUT_HEAD')?.lastError).toHaveLength(
        1000,
      );
    });

    it('rolls back a transaction that fails part-way, so nothing is half-reconciled', async () => {
      db.seed({ organizationId: ORG_A, objectId: 'gone' });
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([
        detected('new-1'),
        detected('new-2'),
      ]);
      db.prisma.setupCondition.create
        .mockImplementationOnce(
          db.prisma.setupCondition.create.getMockImplementation()!,
        )
        .mockRejectedValueOnce(new Error('deadlock detected'));

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T1,
      );

      expect(result.outcome).toBe('FAILED');
      expect(db.rows()).toEqual([
        expect.objectContaining({ objectId: 'gone', clearedAt: null }),
      ]);
      expect(db.run(ORG_A, 'ORG_UNIT_WITHOUT_HEAD')).toMatchObject({
        lastSucceededAt: null,
        lastFailedAt: T1,
      });
    });

    it('does not throw when recording the failure itself fails', async () => {
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValue(new Error('boom'));
      db.prisma.setupConditionRun.upsert
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('database unreachable'));

      await expect(
        reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1),
      ).resolves.toMatchObject({ outcome: 'FAILED' });
    });
  });

  describe('reconcileTenant / reconcileAll', () => {
    it('reconciles every type, and one failing type does not stop the others', async () => {
      byType.STAGE_WITHOUT_ASSIGNEE.mockRejectedValue(new Error('boom'));
      byType.POSITION_WITHOUT_ROLE.mockResolvedValue([detected('pos-1')]);

      const results = await reconciler.reconcileTenant(ORG_A, T1);

      expect(results.map((r) => [r.type, r.outcome])).toEqual([
        ['ORG_UNIT_WITHOUT_HEAD', 'SUCCEEDED'],
        ['STAGE_WITHOUT_ASSIGNEE', 'FAILED'],
        ['TASK_WITHOUT_OWNER', 'SUCCEEDED'],
        ['POSITION_WITHOUT_ROLE', 'SUCCEEDED'],
      ]);
      expect(db.rows()).toEqual([
        expect.objectContaining({ objectId: 'pos-1' }),
      ]);
    });

    it('reconciles every tenant except the platform org, and reports failed pairs', async () => {
      db.prisma.organization.findMany.mockResolvedValue([
        { id: ORG_A },
        { id: ORG_B },
      ]);
      byType.TASK_WITHOUT_OWNER.mockImplementation((org: string) =>
        org === ORG_B ? Promise.reject(new Error('boom')) : Promise.resolve([]),
      );

      const result = await reconciler.reconcileAll(T1);

      expect(db.prisma.organization.findMany).toHaveBeenCalledWith({
        where: { isPlatformOrg: false },
        select: { id: true },
      });
      expect(result).toEqual({
        tenants: 2,
        failed: [{ organizationId: ORG_B, type: 'TASK_WITHOUT_OWNER' }],
      });
      expect(byType.ORG_UNIT_WITHOUT_HEAD).toHaveBeenCalledWith(ORG_A);
      expect(byType.ORG_UNIT_WITHOUT_HEAD).toHaveBeenCalledWith(ORG_B);
    });
  });

  // Another tenant's open row for the same object id must be neither refreshed
  // nor cleared, and must not stop this tenant opening its own.
  describe('tenant isolation', () => {
    itEnforcesTenantIsolation('reconcileType clearing', async () => {
      db.seed({ organizationId: ORG_B, objectId: 'shared-id' });

      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);

      expect(db.rows()).toEqual([
        expect.objectContaining({
          organizationId: ORG_B,
          clearedAt: null,
          lastSeenAt: T0,
        }),
      ]);
    });

    itEnforcesTenantIsolation('reconcileType refreshing', async () => {
      db.seed({ organizationId: ORG_B, objectId: 'shared-id' });
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([detected('shared-id')]);

      const result = await reconciler.reconcileType(
        ORG_A,
        'ORG_UNIT_WITHOUT_HEAD',
        T1,
      );

      expect(result).toMatchObject({ opened: 1, refreshed: 0 });
      const byOrg = Object.fromEntries(
        db.rows().map((r) => [r.organizationId, r]),
      );
      expect(byOrg[ORG_B]).toMatchObject({ lastSeenAt: T0, clearedAt: null });
      expect(byOrg[ORG_A]).toMatchObject({ lastSeenAt: T1, clearedAt: null });
    });

    itEnforcesTenantIsolation('reconcileType run record', async () => {
      byType.ORG_UNIT_WITHOUT_HEAD.mockRejectedValue(new Error('boom'));
      await reconciler.reconcileType(ORG_B, 'ORG_UNIT_WITHOUT_HEAD', T0);
      byType.ORG_UNIT_WITHOUT_HEAD.mockResolvedValue([]);

      await reconciler.reconcileType(ORG_A, 'ORG_UNIT_WITHOUT_HEAD', T1);

      expect(db.run(ORG_B, 'ORG_UNIT_WITHOUT_HEAD')).toMatchObject({
        lastSucceededAt: null,
        lastFailedAt: T0,
      });
    });
  });
});
