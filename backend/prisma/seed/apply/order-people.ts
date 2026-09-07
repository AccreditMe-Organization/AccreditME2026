// ACC-62 — the invite-ordering algorithm, deliberately in its OWN module.
//
// Extracted from apply-people.ts because that file imports `better-auth`,
// which is ESM-only and cannot be loaded by this project's Jest setup — the
// recurring failure CLAUDE.md documents for better-auth/api and
// better-auth/config, here hitting the package root. A spec importing the
// ordering logic would transitively pull in the auth instance and fail before
// running a single test.
//
// Mocking better-auth would have worked, but this is the better fix on its
// own merits: the ordering is pure logic over fixture data, with no business
// sitting next to an auth client. It is now unit-testable with no mocks at
// all.
import { PersonFixture, TenantFixture } from '../fixtures/fixture.types';

// Orders people so that, at each step, everything invite() requires already
// exists. Computed up front and asserted complete, rather than discovered by
// try/catch at write time — a wrong order otherwise surfaces as a confusing
// ConflictException 30 users in.
export function orderPeopleForInvite(fixture: TenantFixture): PersonFixture[] {
  const headPositions = new Set(
    fixture.positions.filter((p) => p.isUnitHeadPosition).map((p) => p.nameEn),
  );
  // 'Director' ships with isUnitHeadPosition among DEFAULT_POSITIONS and is
  // used by several fixtures, so it counts even though no fixture declares it.
  headPositions.add('Director');

  const remaining = [...fixture.people];
  const ordered: PersonFixture[] = [];
  const placed = new Set<string>();
  const unitsWithActiveHead = new Set<string>();

  while (remaining.length > 0) {
    const index = remaining.findIndex((person) => {
      const managerReady = person.reportsTo === null || placed.has(person.reportsTo);
      const isOwnUnitHead = headPositions.has(person.position);
      const unitReady = isOwnUnitHead || unitsWithActiveHead.has(person.unit);
      return managerReady && unitReady;
    });

    if (index === -1) {
      throw new Error(
        'Cannot order people for invite: no remaining person has both their manager and their ' +
          `unit's head already placed. Stuck on: ${remaining.map((p) => p.key).join(', ')}. ` +
          'Every unit needs a head-conferring holder, and the manager graph must be acyclic.',
      );
    }

    const [person] = remaining.splice(index, 1);
    ordered.push(person!);
    placed.add(person!.key);
    if (headPositions.has(person!.position)) unitsWithActiveHead.add(person!.unit);
  }

  return ordered;
}
