// ACC-62 — permanent coverage for the seed fixtures and their ordering.
//
// These are pure-function tests over the fixture data and the two ordering
// algorithms. They deliberately do NOT hit a database: the seed's own
// correctness against real services is proven by running it, and a test that
// mocked every service it calls would only assert that the mocks were called.
//
// What genuinely needs protecting is different, and is what this file covers:
// the fixtures encode four edge cases whose meaning can be silently destroyed
// by an innocuous edit — renaming a person, moving them between units,
// swapping a position. Nothing would fail at seed time; the seed would run
// clean and simply stop demonstrating anything. That is the failure this
// pins.
//
// Lives under src/ rather than beside the fixtures because jest's rootDir is
// src, so a spec under prisma/ is never collected.
import { HOSPITAL_FIXTURE } from '../../../prisma/seed/fixtures/hospital.fixture';
import { UNIVERSITY_FIXTURE } from '../../../prisma/seed/fixtures/university.fixture';
import {
  TenantFixture,
  flattenUnits,
  validateFixture,
} from '../../../prisma/seed/fixtures/fixture.types';
import { orderPeopleForInvite } from '../../../prisma/seed/apply/order-people';

const FIXTURES: Array<[string, TenantFixture]> = [
  ['hospital', HOSPITAL_FIXTURE],
  ['university', UNIVERSITY_FIXTURE],
];

// The head-conferring set as the seed itself computes it: the fixture's own
// declarations plus 'Director', which ships with isUnitHeadPosition among
// DEFAULT_POSITIONS and is used by both fixtures.
function headPositionsOf(fixture: TenantFixture): Set<string> {
  const heads = new Set(
    fixture.positions.filter((p) => p.isUnitHeadPosition).map((p) => p.nameEn),
  );
  heads.add('Director');
  return heads;
}

describe('ACC-62 seed fixtures', () => {
  describe.each(FIXTURES)('%s', (_name, fixture) => {
    it('passes its own validation', () => {
      expect(() => validateFixture(fixture)).not.toThrow();
    });

    it('has a tree at most 3 levels below the root, with codes the DTO accepts', () => {
      const units = flattenUnits(fixture.tree);
      expect(Math.max(...units.map((u) => u.depth))).toBe(3);
      for (const { unit } of units) {
        // CreateOrgUnitDto: @MaxLength(10) and /^[A-Z0-9-]+$/.
        expect(unit.key.length).toBeLessThanOrEqual(10);
        expect(unit.key).toMatch(/^[A-Z0-9-]+$/);
      }
    });

    it('yields parents before children, which the single-pass tree applier requires', () => {
      const seen = new Set<string>();
      for (const { unit, parentKey } of flattenUnits(fixture.tree)) {
        if (parentKey !== null) expect(seen.has(parentKey)).toBe(true);
        seen.add(unit.key);
      }
    });

    // ── The edge cases ──────────────────────────────────────────────────────

    it('leaves exactly one unit headless after the departure — the declared one', () => {
      const heads = headPositionsOf(fixture);
      const departing = fixture.edgeCases.vacantHeadUnit.departingHead;

      const headlessBefore = flattenUnits(fixture.tree)
        .filter(({ unit }) => !fixture.people.some((p) => p.unit === unit.key && heads.has(p.position)))
        .map((u) => u.unit.key);
      // Every unit must have a head BEFORE the departure, or invite() refuses
      // to place staff into it (the ACC-46 block).
      expect(headlessBefore).toEqual([]);

      const headlessAfter = flattenUnits(fixture.tree)
        .filter(
          ({ unit }) =>
            !fixture.people.some(
              (p) => p.unit === unit.key && heads.has(p.position) && p.key !== departing,
            ),
        )
        .map((u) => u.unit.key);
      expect(headlessAfter).toEqual([fixture.edgeCases.vacantHeadUnit.unit]);
    });

    it('keeps the vacancy PARTIAL — an ancestor still has a head', () => {
      const heads = headPositionsOf(fixture);
      const departing = fixture.edgeCases.vacantHeadUnit.departingHead;
      const parentByUnit = new Map(
        flattenUnits(fixture.tree).map((u) => [u.unit.key, u.parentKey]),
      );

      let ancestor = parentByUnit.get(fixture.edgeCases.vacantHeadUnit.unit) ?? null;
      let covered = false;
      while (ancestor) {
        if (
          fixture.people.some(
            (p) => p.unit === ancestor && heads.has(p.position) && p.key !== departing,
          )
        ) {
          covered = true;
          break;
        }
        ancestor = parentByUnit.get(ancestor) ?? null;
      }
      // A fully-unresolved chain would notify tenant admins on every sweep —
      // ACC-62 deliberately does not seed that case.
      expect(covered).toBe(true);
    });

    it('leaves a real staffer in the vacated unit, reporting outside it', () => {
      const { unit, departingHead } = fixture.edgeCases.vacantHeadUnit;
      const remaining = fixture.people.filter((p) => p.unit === unit && p.key !== departingHead);
      expect(remaining.length).toBeGreaterThan(0);
      // deactivate() does not touch its reports' managerId, so reporting to
      // the departing head would dangle at an INACTIVE user.
      for (const staff of remaining) expect(staff.reportsTo).not.toBe(departingHead);
    });

    it('dates the handover in the future so the SLA sweep cannot consume it', () => {
      // sweepDueHandovers() completes any handover with
      // headHandoverEffectiveDate <= now, within 15 minutes.
      expect(fixture.edgeCases.handover.effectiveInDays).toBeGreaterThan(0);
    });

    it('gives the handover a real outgoing head and a NON-head successor', () => {
      const heads = headPositionsOf(fixture);
      const person = (key: string) => fixture.people.find((p) => p.key === key)!;
      const { unit, from, to } = fixture.edgeCases.handover;

      expect(person(from).unit).toBe(unit);
      expect(heads.has(person(from).position)).toBe(true);
      // declareHandover() rejects a successor who already heads something
      // else, to avoid orphaning that unit with no VACATED event.
      expect(heads.has(person(to).position)).toBe(false);
    });

    it('spans today with the out-of-office window, and does not self-cover', () => {
      const { person, covering, startsDaysAgo, endsInDays } = fixture.edgeCases.outOfOffice;
      expect(startsDaysAgo).toBeGreaterThanOrEqual(0);
      expect(endsInDays).toBeGreaterThan(0);
      expect(person).not.toBe(covering);
    });

    it('keeps duplicate-name pairs sharing a name in DIFFERENT units', () => {
      expect(fixture.edgeCases.duplicateNames.length).toBeGreaterThan(0);
      for (const pair of fixture.edgeCases.duplicateNames) {
        const [a, b] = pair.people.map((k) => fixture.people.find((p) => p.key === k)!);
        expect(a!.name).toBe(b!.name);
        expect(a!.unit).not.toBe(b!.unit);
        // Distinct emails — User is @@unique([organizationId, email]).
        expect(a!.emailLocal).not.toBe(b!.emailLocal);
      }
    });

    // ── Structural invariants ───────────────────────────────────────────────

    it('makes the admin the root unit head, which createTenant() forces', () => {
      const admin = fixture.people.find((p) => p.key === fixture.adminKey)!;
      // createTenant() invites the admin as 'Director' (head-conferring) in
      // the root unit, and hasAnyHeadConferringHolder() counts ACTIVE AND
      // INVITED — so nobody else can be root's head.
      expect(admin.unit).toBe(fixture.tree.key);
      expect(headPositionsOf(fixture).has(admin.position)).toBe(true);
      expect(admin.reportsTo).toBeNull();
    });

    it('pairs isSingleAssignee with every isUnitHeadPosition', () => {
      // Schema-enforced, but seedDefaultPositions()-style direct writes bypass
      // validateHeadFlagPairing(), so the data must satisfy it itself.
      for (const position of fixture.positions) {
        if (position.isUnitHeadPosition) expect(position.isSingleAssignee).toBe(true);
      }
    });

    it('orders people so every invite() guard is already satisfied', () => {
      const heads = headPositionsOf(fixture);
      const ordered = orderPeopleForInvite(fixture);
      expect(ordered).toHaveLength(fixture.people.length);

      const placed = new Set<string>();
      const unitHasActiveHead = new Set<string>();

      for (const person of ordered) {
        const isHead = heads.has(person.position);
        // validateUnitHeadUniqueness: one head per unit (ACTIVE or INVITED).
        if (isHead) expect(unitHasActiveHead.has(person.unit)).toBe(false);
        // ACC-46 staffing block: a non-head needs an ACTIVE head in that unit.
        if (!isHead) expect(unitHasActiveHead.has(person.unit)).toBe(true);
        // managerId must already exist; only the root unit's head is exempt.
        if (person.reportsTo) expect(placed.has(person.reportsTo)).toBe(true);
        else expect(isHead && person.unit === fixture.tree.key).toBe(true);

        placed.add(person.key);
        if (isHead) unitHasActiveHead.add(person.unit);
      }
    });

    it('references only committee lookup keys the SYSTEM seed ships', () => {
      const types = ['quality_committee', 'safety_committee', 'executive_board', 'clinical_committee', 'advisory_committee'];
      const roles = ['chairman', 'vice_chairman', 'secretary', 'member', 'observer', 'advisor'];
      for (const committee of fixture.committees) {
        expect(types).toContain(committee.type);
        for (const member of committee.members) expect(roles).toContain(member.role);
      }
    });
  });

  it('gives the two tenants distinct slugs and email domains', () => {
    expect(HOSPITAL_FIXTURE.slug).not.toBe(UNIVERSITY_FIXTURE.slug);
    expect(HOSPITAL_FIXTURE.emailDomain).not.toBe(UNIVERSITY_FIXTURE.emailDomain);
  });

  it('expires the two tenants\' handovers on different days', () => {
    // Same expiry date would make a stale seed look like a code bug in both
    // tenants at once.
    expect(HOSPITAL_FIXTURE.edgeCases.handover.effectiveInDays).not.toBe(
      UNIVERSITY_FIXTURE.edgeCases.handover.effectiveInDays,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateFixture() itself — proving it still has teeth.
//
// Every check above trusts validateFixture() to reject bad data. These prove
// it actually does, by mutating a known-good fixture. Without them, a
// validator that silently stopped checking would make every test above pass
// vacuously.
// ─────────────────────────────────────────────────────────────────────────────
describe('validateFixture rejects', () => {
  // structuredClone keeps each case independent — mutating a shared object
  // would leak failures between tests.
  const clone = (): TenantFixture => structuredClone(HOSPITAL_FIXTURE);

  it('a unit code longer than the DTO allows', () => {
    const fixture = clone();
    fixture.tree.children![0]!.key = 'WAY-TOO-LONG';
    expect(() => validateFixture(fixture)).toThrow(/allows 10/);
  });

  it('a head position without isSingleAssignee', () => {
    const fixture = clone();
    fixture.positions[0]!.isSingleAssignee = false;
    expect(() => validateFixture(fixture)).toThrow(/isSingleAssignee/);
  });

  it('a manager in an unrelated branch', () => {
    const fixture = clone();
    fixture.people.find((p) => p.key === 'fatima')!.reportsTo = 'haya';
    expect(() => validateFixture(fixture)).toThrow(/neither the same unit nor an ancestor/);
  });

  it('a handover dated in the past', () => {
    const fixture = clone();
    fixture.edgeCases.handover.effectiveInDays = -1;
    expect(() => validateFixture(fixture)).toThrow(/must be positive/);
  });

  it('a handover successor who already heads something', () => {
    const fixture = clone();
    fixture.edgeCases.handover.to = 'nawaf'; // Unit Head of Cardiology
    expect(() => validateFixture(fixture)).toThrow(/already holds the head-conferring position/);
  });

  it('a duplicate-name pair renamed apart', () => {
    const fixture = clone();
    fixture.people.find((p) => p.key === 'mohammed-lab')!.name = 'Someone Else';
    expect(() => validateFixture(fixture)).toThrow(/no longer share a name/);
  });

  it('a duplicate-name pair moved into the same unit', () => {
    const fixture = clone();
    const other = fixture.people.find((p) => p.key === 'mohammed-lab')!;
    other.unit = 'MED-IM-CAR';
    other.reportsTo = 'nawaf';
    expect(() => validateFixture(fixture)).toThrow(/same org unit|both in/);
  });

  it('a staffer reporting to the head who departs', () => {
    const fixture = clone();
    fixture.people.find((p) => p.key === 'fatima')!.reportsTo = 'ziad';
    expect(() => validateFixture(fixture)).toThrow(/reports to the departing head/);
  });

  it('an admin who is not the root unit head', () => {
    const fixture = clone();
    fixture.adminKey = 'yasser';
    expect(() => validateFixture(fixture)).toThrow(/ROOT unit|root of the reporting tree/);
  });
});
