import { SetupConditionDetectors } from './setup-condition.detectors';
import { PrismaService } from '../../prisma/prisma.service';
import { itEnforcesTenantIsolation } from '../../common/testing/tenant-isolation';

// ACC-286 PR 2 — the "Committee missing a required seat" detector, with the
// database answers faked by SQL shape so each part is pinned on its own. The
// real reads (in force, seats, holders, isolation, a Suspended committee) are
// proved against Postgres in committees/committee-seat-detector.db-spec.ts.

const ORG_A = 'cmtr9x7zq0000ocp1am2rs14o';
const ORG_B = 'cmtr9x80q0001ocp1bq3kd2rz';
const CHAIRMAN = { id: 'seat-chair', key: 'chairman', labelEn: 'Chairman', labelAr: 'رئيس اللجنة' };
const SECRETARY = { id: 'seat-sec', key: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' };

interface World {
  inForce: { id: string; nameEn: string; nameAr: string | null }[];
  seats: (typeof CHAIRMAN)[];
  holders: { committeeId: string; roleValueId: string }[];
}

function build(world: World) {
  const queries: { sql: string; values: unknown[] }[] = [];
  const $queryRaw = jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join('?');
    queries.push({ sql, values });
    if (sql.includes('"WorkflowInstance"')) return Promise.resolve(world.inForce);
    if (sql.includes('"LookupCategory"')) return Promise.resolve(world.seats);
    if (sql.includes('"CommitteeMember"')) {
      return Promise.resolve(world.holders.map((h, i) => ({ ...h, memberId: `m${i}`, userId: `u${i}` })));
    }
    throw new Error(`unexpected query: ${sql}`);
  });
  const detectors = new SetupConditionDetectors({ $queryRaw } as unknown as PrismaService);
  return { detectors, queries, $queryRaw };
}

describe('SetupConditionDetectors — committees missing a required seat (ACC-286)', () => {
  it('one AT_RISK row per committee in force with an empty required seat, its empty seats in seat order, age first detected', async () => {
    const { detectors } = build({
      inForce: [
        { id: 'c-empty', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
        { id: 'c-half', nameEn: 'Safety Committee', nameAr: null },
        { id: 'c-full', nameEn: 'Ethics Committee', nameAr: null },
      ],
      seats: [CHAIRMAN, SECRETARY],
      holders: [
        { committeeId: 'c-half', roleValueId: CHAIRMAN.id },
        { committeeId: 'c-full', roleValueId: CHAIRMAN.id },
        { committeeId: 'c-full', roleValueId: SECRETARY.id },
      ],
    });

    expect(await detectors.byType.COMMITTEE_MISSING_REQUIRED_SEAT(ORG_A)).toEqual([
      {
        objectId: 'c-empty',
        severity: 'AT_RISK',
        openedAt: null,
        subject: {
          nameEn: 'Quality Committee',
          nameAr: 'لجنة الجودة',
          seats: [
            { id: CHAIRMAN.id, labelEn: 'Chairman', labelAr: 'رئيس اللجنة' },
            { id: SECRETARY.id, labelEn: 'Secretary', labelAr: 'أمين السر' },
          ],
        },
      },
      {
        objectId: 'c-half',
        severity: 'AT_RISK',
        openedAt: null,
        subject: { nameEn: 'Safety Committee', nameAr: null, seats: [{ id: SECRETARY.id, labelEn: 'Secretary', labelAr: 'أمين السر' }] },
      },
    ]);
  });

  it('a holder of a seat on ANOTHER committee does not fill this one', async () => {
    const { detectors } = build({
      inForce: [{ id: 'c-1', nameEn: 'One', nameAr: null }, { id: 'c-2', nameEn: 'Two', nameAr: null }],
      seats: [CHAIRMAN],
      holders: [{ committeeId: 'c-2', roleValueId: CHAIRMAN.id }],
    });
    expect((await detectors.committeesMissingRequiredSeat(ORG_A)).map((c) => c.objectId)).toEqual(['c-1']);
  });

  it('with no committee in force it reads nothing else; with no required seat it opens nothing', async () => {
    const none = build({ inForce: [], seats: [CHAIRMAN], holders: [] });
    expect(await none.detectors.committeesMissingRequiredSeat(ORG_A)).toEqual([]);
    expect(none.$queryRaw).toHaveBeenCalledTimes(1);

    const unticked = build({ inForce: [{ id: 'c-1', nameEn: 'One', nameAr: null }], seats: [], holders: [] });
    expect(await unticked.detectors.committeesMissingRequiredSeat(ORG_A)).toEqual([]);
    expect(unticked.$queryRaw).toHaveBeenCalledTimes(2);
  });

  it('reads "in force" from the IN_FORCE flag and the committee being active, never a stage key', async () => {
    const { detectors, queries } = build({ inForce: [{ id: 'c-1', nameEn: 'One', nameAr: null }], seats: [CHAIRMAN], holders: [] });
    await detectors.committeesMissingRequiredSeat(ORG_A);
    const committees = queries.find((q) => q.sql.includes('"WorkflowInstance"'))!;
    expect(committees.sql).toContain('= ANY(s.flags)');
    expect(committees.sql).toContain('c."isActive"');
    expect(committees.sql).not.toContain('s.key');
    expect(committees.values).toContain('IN_FORCE');
  });

  itEnforcesTenantIsolation('committees missing a required seat — every query is bound to the organisation', async () => {
    const { detectors, queries } = build({ inForce: [{ id: 'c-1', nameEn: 'One', nameAr: null }], seats: [CHAIRMAN], holders: [] });
    await detectors.committeesMissingRequiredSeat(ORG_A);
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.values).toContain(ORG_A);
      expect(q.values).not.toContain(ORG_B);
    }
  });
});
