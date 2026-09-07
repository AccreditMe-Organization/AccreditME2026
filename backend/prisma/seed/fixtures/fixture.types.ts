// ACC-62 — the declarative shapes a tenant fixture is written in.
//
// The governing rule: a fixture references everything by a STABLE STRING KEY
// ('MED-IM', 'layla'), never by a database id. The appliers resolve keys to
// ids at seed time. Two reasons, both load-bearing:
//
//   1. A fixture stays readable as an org chart. `reportsTo: 'faisal'` says
//      something; `managerId: 'cmt3x...'` says nothing, and ids do not exist
//      until the seed runs anyway.
//   2. It makes the whole fixture checkable BEFORE any write — see
//      validateFixture() below. A typo becomes an error naming the bad key,
//      instead of a foreign-key violation halfway through seeding, or worse,
//      a silently wrong org chart.

// ── Org units ────────────────────────────────────────────────────────────────

// The unit tree is expressed as real nesting rather than a flat list with
// parentKey pointers: the nesting IS the parent relationship, so a fixture
// cannot express a cycle or a dangling parent by construction.
export interface UnitFixture {
  // Doubles as OrgUnit.code, so it inherits that column's real constraints —
  // CreateOrgUnitDto enforces @MaxLength(10) and /^[A-Z0-9-]+$/. Validated
  // here too (validateFixture) so a bad code fails before the seed touches
  // the database rather than on the DTO at write time.
  key: string;
  nameEn: string;
  nameAr: string;
  // Free text — OrgUnit.type is String? with NO validation anywhere, and the
  // org_unit_type SYSTEM lookup category has zero consumers in backend or
  // frontend (confirmed by grep, ACC-62 investigation). Values outside that
  // category ('ward', 'faculty') are therefore legal; ACC-62 PD #4 adds them
  // as tenant lookup values anyway so the data is internally consistent for
  // whenever that lookup does get wired up.
  type: string;
  children?: UnitFixture[];
}

// ── Positions ────────────────────────────────────────────────────────────────

// Additional positions beyond the 10 industry-agnostic DEFAULT_POSITIONS that
// seedDefaultPositions() already creates. Needed because only 'Director'
// ships with isUnitHeadPosition, so a 4-level tree would otherwise have every
// level's head holding the same title (ACC-62 PD #2).
export interface PositionFixture {
  nameEn: string;
  nameAr: string;
  grade: number;
  // OrgPosition has a schema-enforced pairing: isUnitHeadPosition requires
  // isSingleAssignee. seedDefaultPositions() writes via direct prisma.create()
  // and so bypasses validateHeadFlagPairing() — its own comment says the seed
  // data must satisfy the invariant itself. validateFixture() enforces it
  // here rather than trusting each fixture author to remember.
  isUnitHeadPosition?: boolean;
  isSingleAssignee?: boolean;
}

// ── People ───────────────────────────────────────────────────────────────────

export interface PersonFixture {
  key: string;
  name: string;
  // Local part only; the applier appends the tenant's own domain, so a
  // fixture never has to repeat it and two tenants cannot collide.
  emailLocal: string;
  // Must match a PositionFixture.nameEn or one of DEFAULT_POSITIONS.
  position: string;
  // UnitFixture.key.
  unit: string;
  // PersonFixture.key of this person's manager, or null for the top of the
  // tree. validateFixture() proves the resulting graph is acyclic AND that a
  // manager sits in the same unit or an ancestor — an arbitrary cross-link is
  // a fixture bug, not a valid org.
  reportsTo: string | null;
}

// ── Committees ───────────────────────────────────────────────────────────────

export interface CommitteeMemberFixture {
  // PersonFixture.key.
  person: string;
  // A committee_member_role SYSTEM lookup key: chairman | vice_chairman |
  // secretary | member | observer | advisor.
  role: string;
}

export interface CommitteeFixture {
  key: string;
  nameEn: string;
  nameAr: string;
  // A committee_type SYSTEM lookup key: quality_committee | safety_committee |
  // executive_board | clinical_committee | advisory_committee.
  type: string;
  purpose: string;
  quorumCount: number;
  meetingFrequency: string;
  // CommitteeFixture.key of the committee this one reports to.
  //
  // NOT an org unit: Committee has no orgUnitId field at all (ACC-62 PD #3,
  // raised as ACC-63). Committee-to-committee reporting is the only real
  // hierarchy the schema can express today, so that is what fixtures use —
  // deliberately, rather than faking unit ownership by encoding a unit name
  // into the committee's title.
  reportsToCommittee?: string;
  members: CommitteeMemberFixture[];
}

// ── Edge cases ───────────────────────────────────────────────────────────────

// The four deliberate states from ACC-62 Section 3. Each is expressed as data
// so the reason for each choice lives next to the choice, and so the seed
// cannot half-apply one.
export interface EdgeCaseFixture {
  // A unit with staff but no head-position holder, whose PARENT does have
  // one — producing a PARTIAL vacancy that exercises
  // resolveActingHeadForOrgUnit()'s walk-up (flagged, silent, no
  // notification). An empty unit would not exercise the walk-up at all.
  vacantHeadUnit: string;

  // Out-of-office with real coverage. Dates are computed relative to seed
  // time by the applier — never stored here as absolute values, or the case
  // silently expires and the seed stops demonstrating anything.
  outOfOffice: {
    person: string;
    covering: string;
    startsDaysAgo: number;
    endsInDays: number;
  };

  // A head handover in progress. effectiveInDays MUST be positive:
  // SlaMonitorProcessor.sweepDueHandovers() completes any handover whose
  // headHandoverEffectiveDate <= now, so a past or present date would be
  // swept within 15 minutes and the edge case would evaporate. Enforced in
  // validateFixture().
  handover: {
    unit: string;
    from: string;
    to: string;
    effectiveInDays: number;
  };

  // Two people who share a name in different units. Not applied — these are
  // ordinary PersonFixture entries — but named here so the intent is
  // explicit and validateFixture() can prove the names really do collide and
  // the units really do differ. Without that check a later rename would
  // silently dissolve the case.
  duplicateNames: Array<{ people: [string, string] }>;
}

// ── Tenant ───────────────────────────────────────────────────────────────────

export interface TenantFixture {
  slug: string;
  name: string;
  country: string;
  // Appended to each PersonFixture.emailLocal.
  emailDomain: string;
  adminKey: string;
  // Tenant-scoped org_unit_type LookupValues to add beyond the 6 SYSTEM ones
  // (ACC-62 PD #4). Keyed by the same strings UnitFixture.type uses.
  orgUnitTypes: Array<{ key: string; labelEn: string; labelAr: string }>;
  positions: PositionFixture[];
  // Exactly one root. bootstrap() already creates a root unit derived from
  // the tenant name; the applier reconciles this fixture's root with it
  // rather than creating a second one.
  tree: UnitFixture;
  people: PersonFixture[];
  committees: CommitteeFixture[];
  edgeCases: EdgeCaseFixture;
}

// ─────────────────────────────────────────────────────────────────────────────
// Key resolution
// ─────────────────────────────────────────────────────────────────────────────

// Populated as the appliers create rows, then read by later appliers. Kept as
// a plain object rather than module state so a run seeding two tenants cannot
// leak one tenant's ids into the other's lookups.
export interface SeedContext {
  organizationId: string;
  unitIdByKey: Map<string, string>;
  personIdByKey: Map<string, string>;
  positionIdByName: Map<string, string>;
  committeeIdByKey: Map<string, string>;
  lookupValueIdByKey: Map<string, string>;
}

export function createSeedContext(organizationId: string): SeedContext {
  return {
    organizationId,
    unitIdByKey: new Map(),
    personIdByKey: new Map(),
    positionIdByName: new Map(),
    committeeIdByKey: new Map(),
    lookupValueIdByKey: new Map(),
  };
}

// Throws naming the missing key and what kind of thing it was, rather than
// returning undefined and letting a null id reach Prisma as a confusing FK
// error several calls later.
export function resolve(map: Map<string, string>, key: string, kind: string): string {
  const id = map.get(key);
  if (!id) {
    throw new Error(
      `Seed fixture references unknown ${kind} '${key}'. ` +
        `Known ${kind}s: ${[...map.keys()].sort().join(', ') || '(none resolved yet)'}`,
    );
  }
  return id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation — runs BEFORE any database write
// ─────────────────────────────────────────────────────────────────────────────

const ORG_UNIT_CODE_PATTERN = /^[A-Z0-9-]+$/;
const ORG_UNIT_CODE_MAX_LENGTH = 10;

export function flattenUnits(
  node: UnitFixture,
  parentKey: string | null = null,
  depth = 0,
): Array<{ unit: UnitFixture; parentKey: string | null; depth: number }> {
  return [
    { unit: node, parentKey, depth },
    ...(node.children ?? []).flatMap((child) => flattenUnits(child, node.key, depth + 1)),
  ];
}

// Collects EVERY problem rather than throwing on the first, so a fixture with
// several typos is fixed in one pass instead of one error at a time.
export function validateFixture(fixture: TenantFixture): void {
  const errors: string[] = [];
  const units = flattenUnits(fixture.tree);
  const unitKeys = new Set(units.map((u) => u.unit.key));
  const parentByUnit = new Map(units.map((u) => [u.unit.key, u.parentKey]));

  // -- Unit codes must satisfy the real column constraints -------------------
  for (const { unit } of units) {
    if (unit.key.length > ORG_UNIT_CODE_MAX_LENGTH) {
      errors.push(
        `Unit code '${unit.key}' is ${unit.key.length} chars; CreateOrgUnitDto allows ${ORG_UNIT_CODE_MAX_LENGTH}.`,
      );
    }
    if (!ORG_UNIT_CODE_PATTERN.test(unit.key)) {
      errors.push(`Unit code '${unit.key}' must match ${String(ORG_UNIT_CODE_PATTERN)}.`);
    }
  }
  if (unitKeys.size !== units.length) {
    errors.push('Duplicate unit keys in tree — codes are unique per organization.');
  }

  // -- Positions: the schema-enforced head/single-assignee pairing -----------
  for (const p of fixture.positions) {
    if (p.isUnitHeadPosition && !p.isSingleAssignee) {
      errors.push(
        `Position '${p.nameEn}' sets isUnitHeadPosition without isSingleAssignee. ` +
          'The schema requires the pairing, and direct-create seeding bypasses validateHeadFlagPairing().',
      );
    }
  }
  const headPositions = new Set(
    fixture.positions.filter((p) => p.isUnitHeadPosition).map((p) => p.nameEn),
  );

  // -- People ----------------------------------------------------------------
  const peopleByKey = new Map(fixture.people.map((p) => [p.key, p]));
  if (peopleByKey.size !== fixture.people.length) {
    errors.push('Duplicate person keys.');
  }
  const emails = fixture.people.map((p) => p.emailLocal);
  if (new Set(emails).size !== emails.length) {
    errors.push('Duplicate emailLocal — User is @@unique([organizationId, email]).');
  }
  for (const person of fixture.people) {
    if (!unitKeys.has(person.unit)) {
      errors.push(`Person '${person.key}' is in unknown unit '${person.unit}'.`);
    }
    if (person.reportsTo !== null && !peopleByKey.has(person.reportsTo)) {
      errors.push(`Person '${person.key}' reports to unknown person '${person.reportsTo}'.`);
    }
  }

  // -- The manager graph must be acyclic ------------------------------------
  for (const person of fixture.people) {
    const seen = new Set<string>([person.key]);
    let cursor = person.reportsTo;
    while (cursor) {
      if (seen.has(cursor)) {
        errors.push(`Manager cycle involving '${person.key}'.`);
        break;
      }
      seen.add(cursor);
      cursor = peopleByKey.get(cursor)?.reportsTo ?? null;
    }
  }

  // -- A manager must sit in the same unit or an ancestor --------------------
  // This is what makes the reporting tree a real subtree of the org tree
  // rather than a set of arbitrary links that merely happen to resolve.
  const isSameOrAncestor = (ancestorKey: string, unitKey: string): boolean => {
    let cursor: string | null = unitKey;
    while (cursor) {
      if (cursor === ancestorKey) return true;
      cursor = parentByUnit.get(cursor) ?? null;
    }
    return false;
  };
  for (const person of fixture.people) {
    if (!person.reportsTo) continue;
    const manager = peopleByKey.get(person.reportsTo);
    if (!manager) continue;
    if (!isSameOrAncestor(manager.unit, person.unit)) {
      errors.push(
        `Person '${person.key}' (${person.unit}) reports to '${manager.key}' (${manager.unit}), ` +
          'which is neither the same unit nor an ancestor.',
      );
    }
  }

  // -- Exactly one person with no manager ------------------------------------
  const roots = fixture.people.filter((p) => p.reportsTo === null);
  if (roots.length !== 1) {
    errors.push(
      `Expected exactly one person with reportsTo: null, found ${roots.length} (${roots.map((r) => r.key).join(', ')}).`,
    );
  }

  // -- Admin ------------------------------------------------------------------
  if (!peopleByKey.has(fixture.adminKey)) {
    errors.push(`adminKey '${fixture.adminKey}' is not a person in this fixture.`);
  }

  // -- Committees -------------------------------------------------------------
  const committeeKeys = new Set(fixture.committees.map((c) => c.key));
  for (const committee of fixture.committees) {
    for (const member of committee.members) {
      if (!peopleByKey.has(member.person)) {
        errors.push(`Committee '${committee.key}' has unknown member '${member.person}'.`);
      }
    }
    const memberKeys = committee.members.map((m) => m.person);
    if (new Set(memberKeys).size !== memberKeys.length) {
      errors.push(
        `Committee '${committee.key}' lists someone twice — CommitteeMember is @@unique([committeeId, userId]).`,
      );
    }
    if (committee.reportsToCommittee && !committeeKeys.has(committee.reportsToCommittee)) {
      errors.push(
        `Committee '${committee.key}' reports to unknown committee '${committee.reportsToCommittee}'.`,
      );
    }
  }

  // -- Edge cases: prove each one is actually the state it claims to be ------
  const edge = fixture.edgeCases;

  // Vacancy must be PARTIAL: the unit itself has no head-position holder, but
  // an ancestor does. Both halves are checked — a unit whose ancestors are
  // also headless would be a different (fully-unresolved) case that ACC-62
  // deliberately does not seed.
  if (!unitKeys.has(edge.vacantHeadUnit)) {
    errors.push(`edgeCases.vacantHeadUnit '${edge.vacantHeadUnit}' is not a known unit.`);
  } else {
    const holdsHeadPositionIn = (unitKey: string): boolean =>
      fixture.people.some((p) => p.unit === unitKey && headPositions.has(p.position));

    if (holdsHeadPositionIn(edge.vacantHeadUnit)) {
      errors.push(
        `edgeCases.vacantHeadUnit '${edge.vacantHeadUnit}' has a head-position holder, so it is not vacant.`,
      );
    }
    let ancestor = parentByUnit.get(edge.vacantHeadUnit) ?? null;
    let covered = false;
    while (ancestor) {
      if (holdsHeadPositionIn(ancestor)) {
        covered = true;
        break;
      }
      ancestor = parentByUnit.get(ancestor) ?? null;
    }
    if (!covered) {
      errors.push(
        `edgeCases.vacantHeadUnit '${edge.vacantHeadUnit}' has no head anywhere up its chain. ` +
          'That is the FULLY-unresolved case, which ACC-62 deliberately does not seed ' +
          '(it requires a headless organization and notifies tenant admins on every sweep).',
      );
    }
  }

  for (const key of [edge.outOfOffice.person, edge.outOfOffice.covering]) {
    if (!peopleByKey.has(key)) errors.push(`edgeCases.outOfOffice references unknown person '${key}'.`);
  }
  if (edge.outOfOffice.person === edge.outOfOffice.covering) {
    errors.push('edgeCases.outOfOffice: a person cannot cover for themselves.');
  }
  if (edge.outOfOffice.startsDaysAgo < 0 || edge.outOfOffice.endsInDays <= 0) {
    errors.push(
      'edgeCases.outOfOffice must span today — startsDaysAgo >= 0 and endsInDays > 0 — or the case is already over.',
    );
  }

  if (!unitKeys.has(edge.handover.unit)) {
    errors.push(`edgeCases.handover.unit '${edge.handover.unit}' is not a known unit.`);
  }
  for (const key of [edge.handover.from, edge.handover.to]) {
    if (!peopleByKey.has(key)) errors.push(`edgeCases.handover references unknown person '${key}'.`);
  }
  if (edge.handover.effectiveInDays <= 0) {
    errors.push(
      'edgeCases.handover.effectiveInDays must be positive. sweepDueHandovers() completes any ' +
        'handover dated <= now, so a past date would be swept within 15 minutes and the case would vanish.',
    );
  }

  for (const pair of edge.duplicateNames) {
    const [a, b] = pair.people;
    const personA = peopleByKey.get(a);
    const personB = peopleByKey.get(b);
    if (!personA || !personB) {
      errors.push(`edgeCases.duplicateNames references unknown person(s): ${a}, ${b}.`);
      continue;
    }
    if (personA.name !== personB.name) {
      errors.push(
        `edgeCases.duplicateNames pair (${a}, ${b}) no longer share a name ` +
          `('${personA.name}' vs '${personB.name}') — a rename dissolved the case.`,
      );
    }
    if (personA.unit === personB.unit) {
      errors.push(
        `edgeCases.duplicateNames pair (${a}, ${b}) are both in '${personA.unit}'. ` +
          'The point is that a name-only picker cannot tell them apart across different units.',
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Fixture '${fixture.slug}' is invalid (${errors.length} problem(s)):\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
}
