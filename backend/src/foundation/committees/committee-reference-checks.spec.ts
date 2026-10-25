import { Logger } from '@nestjs/common';
import {
  assertCommitteeReferences,
  CommitteeReferenceChange,
  CommitteeTx,
  lockCommitteeHierarchy,
} from './committee-reference-checks';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-233 — each rule, one refusal and one code apiece. The loop walk and the
// lock are proved against a real Postgres in committee-reference-checks.db-spec.ts;
// here the database answers are faked so each rule can be pinned on its own.

const ORG_A = 'org-a';
const ORG_B = 'org-b';

interface Fake {
  committees: Map<string, string>; // id -> organizationId
  units: Map<string, { organizationId: string; isActive: boolean }>;
  parentReaches: boolean;
  reportsToReaches: boolean;
  stage: Map<string, { stageId: string; flags: string[] } | null>; // committee -> current stage (ACC-255: its flags)
}

function fakeTx(fake: Fake) {
  const queries: string[] = [];
  const tx = {
    committee: {
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string } }) =>
        Promise.resolve(fake.committees.get(where.id) === where.organizationId ? { id: where.id } : null),
      ),
    },
    orgUnit: {
      findFirst: jest.fn(({ where }: { where: { id: string; organizationId: string; isActive: boolean } }) => {
        const unit = fake.units.get(where.id);
        return Promise.resolve(unit && unit.organizationId === where.organizationId && unit.isActive === where.isActive ? { id: where.id } : null);
      }),
    },
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      queries.push(sql);
      if (sql.includes('pg_advisory_xact_lock')) return Promise.resolve([{ pg_advisory_xact_lock: '' }]);
      if (sql.includes('"parentCommitteeId"')) return Promise.resolve([{ reaches: fake.parentReaches }]);
      if (sql.includes('"reportingToCommitteeId"')) return Promise.resolve([{ reaches: fake.reportsToReaches }]);
      if (sql.includes('"WorkflowInstance"')) {
        const committeeId = values[1] as string;
        const stage = fake.stage.get(committeeId);
        return Promise.resolve(stage ? [stage] : []);
      }
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  return { tx: tx as unknown as CommitteeTx, raw: tx, queries };
}

function world(overrides: Partial<Fake> = {}): Fake {
  return {
    committees: new Map([
      ['self', ORG_A],
      ['other', ORG_A],
      ['foreign', ORG_B],
    ]),
    units: new Map([
      ['unit-a', { organizationId: ORG_A, isActive: true }],
      ['unit-closed', { organizationId: ORG_A, isActive: false }],
      ['unit-b', { organizationId: ORG_B, isActive: true }],
    ]),
    parentReaches: false,
    reportsToReaches: false,
    stage: new Map([['other', { stageId: 'stage-active', flags: ['IN_FORCE'] }]]),
    ...overrides,
  };
}

const logger = { warn: jest.fn() } as unknown as Logger & { warn: jest.Mock };

async function refusal(fake: Fake, change: Omit<CommitteeReferenceChange, 'organizationId'> & { organizationId?: string }): Promise<string | null> {
  const { tx } = fakeTx(fake);
  try {
    await assertCommitteeReferences(tx, { organizationId: ORG_A, ...change }, logger);
    return null;
  } catch (e) {
    const err = e as { getStatus?: () => number; getResponse?: () => { code?: string } };
    expect(err.getStatus?.()).toBe(400);
    return err.getResponse?.()?.code ?? 'NO_CODE';
  }
}

describe('Committee reference checks (ACC-233)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('rule 1 — not itself', () => {
    it('a committee cannot be its own parent', async () => {
      expect(await refusal(world(), { committeeId: 'self', parentCommitteeId: 'self' })).toBe('COMMITTEE_OWN_PARENT');
    });
    it('a committee cannot report to itself', async () => {
      expect(await refusal(world(), { committeeId: 'self', reportingToCommitteeId: 'self' })).toBe('COMMITTEE_REPORTS_TO_ITSELF');
    });
  });

  describe('rule 2 — no loops, each chain walked separately', () => {
    it('a parent that is one of its own sub-committees is refused', async () => {
      expect(await refusal(world({ parentReaches: true }), { committeeId: 'self', parentCommitteeId: 'other' })).toBe('COMMITTEE_PARENT_LOOP');
    });
    it('a reports-to that reports to it is refused', async () => {
      expect(await refusal(world({ reportsToReaches: true }), { committeeId: 'self', reportingToCommitteeId: 'other' })).toBe(
        'COMMITTEE_REPORTS_TO_LOOP',
      );
    });
    it('the parent walk does not read the reports-to chain, and the other way round', async () => {
      // A loop on the reports-to chain says nothing about the parent.
      expect(await refusal(world({ reportsToReaches: true }), { committeeId: 'self', parentCommitteeId: 'other' })).toBeNull();
      expect(await refusal(world({ parentReaches: true }), { committeeId: 'self', reportingToCommitteeId: 'other' })).toBeNull();
    });
    it('a NEW committee is not walked: nothing sits under it yet', async () => {
      const fake = world({ parentReaches: true, reportsToReaches: true });
      const { tx, queries } = fakeTx(fake);
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: null, parentCommitteeId: 'other', reportingToCommitteeId: 'other' }, logger);
      expect(queries.some((q) => q.includes('WITH RECURSIVE'))).toBe(false);
    });
    it('the walk is scoped to the organisation and starts at the proposed target', async () => {
      const { tx, raw } = fakeTx(world());
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self', parentCommitteeId: 'other' }, logger);
      const walk = raw.$queryRaw.mock.calls.find(([s]) => (s as TemplateStringsArray).join('?').includes('WITH RECURSIVE'))!;
      expect(walk.slice(1)).toEqual(['other', ORG_A, 'self']);
    });
  });

  // ACC-255 PR 2 — decided by the stage's DISSOLVING flag, never its key or name.
  describe('rule 3 — not a dissolving or dissolved committee, by the stage FLAG', () => {
    it('a parent in a stage flagged DISSOLVING is refused', async () => {
      const fake = world({ stage: new Map([['other', { stageId: 's', flags: ['DISSOLVING'] }]]) });
      expect(await refusal(fake, { committeeId: 'self', parentCommitteeId: 'other' })).toBe('COMMITTEE_PARENT_DISSOLVING');
    });
    it('a reports-to in a stage flagged DISSOLVING is refused', async () => {
      const fake = world({ stage: new Map([['other', { stageId: 's', flags: ['DISSOLVING'] }]]) });
      expect(await refusal(fake, { committeeId: 'self', reportingToCommitteeId: 'other' })).toBe('COMMITTEE_REPORTS_TO_DISSOLVING');
    });
    it('a stage without the flag is allowed, whatever else it is flagged', async () => {
      for (const flags of [[], ['IN_FORCE']]) {
        const fake = world({ stage: new Map([['other', { stageId: 's', flags }]]) });
        expect(await refusal(fake, { committeeId: 'self', parentCommitteeId: 'other' })).toBeNull();
      }
    });
    it('reads the stage FLAGS, not its key', async () => {
      const { tx, raw } = fakeTx(world());
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: null, parentCommitteeId: 'other' }, logger);
      const read = raw.$queryRaw.mock.calls.find(([s]) => (s as TemplateStringsArray).join('?').includes('"WorkflowInstance"'))!;
      expect((read[0] as TemplateStringsArray).join('?')).toContain('ws."flags"');
      expect((read[0] as TemplateStringsArray).join('?')).not.toContain('ws."key"');
    });
    it('a committee with no workflow instance is not dissolving', async () => {
      expect(await refusal(world({ stage: new Map() }), { committeeId: 'self', parentCommitteeId: 'other' })).toBeNull();
    });
    it('the stage read takes a share lock on the instance, scoped to the organisation', async () => {
      const { tx, raw } = fakeTx(world());
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: null, parentCommitteeId: 'other' }, logger);
      const read = raw.$queryRaw.mock.calls.find(([s]) => (s as TemplateStringsArray).join('?').includes('"WorkflowInstance"'))!;
      expect((read[0] as TemplateStringsArray).join('?')).toContain('FOR SHARE OF wi');
      expect(read.slice(1)).toEqual([ORG_A, 'other']);
    });
  });

  describe('rule 4 — the owning unit', () => {
    it("'' is refused: choose the unit", async () => {
      expect(await refusal(world(), { committeeId: 'self', orgUnitId: '' })).toBe('COMMITTEE_UNIT_REQUIRED');
    });
    it('null is refused: choose the unit', async () => {
      expect(await refusal(world(), { committeeId: 'self', orgUnitId: null })).toBe('COMMITTEE_UNIT_REQUIRED');
    });
    it('an inactive unit is refused', async () => {
      expect(await refusal(world(), { committeeId: 'self', orgUnitId: 'unit-closed' })).toBe('COMMITTEE_UNIT_NOT_FOUND');
    });
    it('an unknown unit is refused', async () => {
      expect(await refusal(world(), { committeeId: 'self', orgUnitId: 'nope' })).toBe('COMMITTEE_UNIT_NOT_FOUND');
    });
    it('an active unit in this organisation is accepted', async () => {
      expect(await refusal(world(), { committeeId: 'self', orgUnitId: 'unit-a' })).toBeNull();
    });
    it('an omitted unit is not checked', async () => {
      const { tx, raw } = fakeTx(world());
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self' }, logger);
      expect(raw.orgUnit.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('rule 5 — another organisation is indistinguishable from nothing', () => {
    itEnforcesTenantIsolation('committee parent, reports-to and owning unit references', async () => {
      // Another organisation's committee and unit get EXACTLY the refusal an
      // invented id does: same status, same code, and the read itself is
      // scoped, so nothing about the other organisation is ever looked at.
      const fake = world();
      expect(await refusal(fake, { committeeId: 'self', parentCommitteeId: 'foreign' })).toBe(
        await refusal(fake, { committeeId: 'self', parentCommitteeId: 'invented' }),
      );
      expect(await refusal(fake, { committeeId: 'self', parentCommitteeId: 'foreign' })).toBe('COMMITTEE_PARENT_NOT_FOUND');
      expect(await refusal(fake, { committeeId: 'self', reportingToCommitteeId: 'foreign' })).toBe(
        await refusal(fake, { committeeId: 'self', reportingToCommitteeId: 'invented' }),
      );
      expect(await refusal(fake, { committeeId: 'self', reportingToCommitteeId: 'foreign' })).toBe('COMMITTEE_REPORTS_TO_NOT_FOUND');
      expect(await refusal(fake, { committeeId: 'self', orgUnitId: 'unit-b' })).toBe(await refusal(fake, { committeeId: 'self', orgUnitId: 'invented' }));

      const { tx, raw } = fakeTx(fake);
      await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self', parentCommitteeId: 'other', orgUnitId: 'unit-a' }, logger);
      expect(raw.committee.findFirst).toHaveBeenCalledWith({ where: { id: 'other', organizationId: ORG_A }, select: { id: true } });
      expect(raw.orgUnit.findFirst).toHaveBeenCalledWith({ where: { id: 'unit-a', organizationId: ORG_A, isActive: true }, select: { id: true } });
    });

    it('the refusal names nothing from the other organisation', async () => {
      const { tx } = fakeTx(world());
      const err = await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self', parentCommitteeId: 'foreign' }, logger).catch(
        (e: { getResponse: () => unknown }) => e.getResponse(),
      );
      expect(JSON.stringify(err)).not.toContain('foreign');
      expect(JSON.stringify(err)).not.toContain(ORG_B);
    });
  });

  it('clearing a parent or reports-to (null) is always allowed and reads nothing', async () => {
    const { tx, raw } = fakeTx(world());
    await assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self', parentCommitteeId: null, reportingToCommitteeId: null }, logger);
    expect(raw.committee.findFirst).not.toHaveBeenCalled();
    expect(raw.$queryRaw).not.toHaveBeenCalled();
  });

  it('self is refused before anything is read', async () => {
    const { tx, raw } = fakeTx(world());
    await expect(assertCommitteeReferences(tx, { organizationId: ORG_A, committeeId: 'self', parentCommitteeId: 'self' }, logger)).rejects.toBeTruthy();
    expect(raw.committee.findFirst).not.toHaveBeenCalled();
  });

  it('the hierarchy lock is per organisation', async () => {
    const { tx, raw } = fakeTx(world());
    await lockCommitteeHierarchy(tx, ORG_A);
    expect(raw.$queryRaw.mock.calls[0]!.slice(1)).toEqual([`committee-hierarchy:${ORG_A}`]);
  });
});
