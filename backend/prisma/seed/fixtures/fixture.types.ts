import { COMMITTEE_MEETING_FREQUENCIES } from '../../../src/foundation/committees/dto/create-committee.dto';
import { ALL_PERMISSIONS } from '../../../src/foundation/roles/permission.seed';
import { SYSTEM_ROLE_SEED } from '../../../src/foundation/roles/role.seed';

// ACC-107 — seeded into every tenant but inert there, and filtered out of the
// assignable-roles list (ACC-13). Named once so the persona rules below and a
// future reader agree on why it is excluded.
const PLATFORM_ROLE_KEY = 'PLATFORM_ADMIN';

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

// ── Custom roles ─────────────────────────────────────────────────────────────

// ACC-101 — a TENANT-CUSTOM role and who holds it.
//
// Why this exists at all. Before it, the seed granted no permission role to
// anyone: apply-people.ts creates each person with a position, a unit and a
// reporting line, and stops there. The only "role" in a fixture was a committee
// seat (chairman, secretary), which is a lookup value describing a seat at a
// table, not a permission. So 45 of the 47 seeded people held nothing, and the
// two who held anything were tenant admins created by bootstrap().
//
// The consequence was not cosmetic: three separate checks on ACC-101 could not
// be run against the seed, because no persona existed between "holds
// everything" and "holds nothing" — and almost every authorization question is
// about someone in between.
//
// CUSTOM rather than a system role, deliberately: it exercises the
// tenant-created-role path the whole permission model rests on
// (RoleService.createRole with key: null, isSystem: false), which nothing in
// the seed touched before.
//
// ACC-107 IS that piece of work, and it is below (SystemRolePersonaFixture).
// The paragraph above described the state until then: one custom role, one
// holder, added because one ticket needed a subject. Every seeded system role
// now has a credentialed holder too, so the sentence "BASE_USER, VIEWER and
// the rest remain unheld" is no longer true of this seed.
export interface CustomRoleFixture {
  nameEn: string;
  nameAr: string;
  description: string;
  // Real permission strings, e.g. 'roles:view'. Checked against the product's
  // own catalogue by validateFixture(), so a typo fails before any write
  // rather than seeding a role that silently grants nothing.
  permissions: string[];
  // PersonFixture keys.
  holders: string[];
}

// ── System-role personas ─────────────────────────────────────────────────────

// ACC-107 — who demonstrates which SEEDED SYSTEM role.
//
// ## Roles on the existing people, not extra people (Ahmad's decision)
//
// A persona is a role attached to one of the tenant's own 24 people, never a
// synthetic extra person. Two reasons, and the second is the one that decides
// it:
//
//   1. The headcount and the org tree stay honest. A "QM Persona" reporting to
//      nobody, holding no position, sitting in no unit, is a row that exists
//      only to be logged in as — and it would appear in every user picker,
//      every org chart and every count, misrepresenting the tenant.
//   2. It states something TRUE about the organisation. The Head of Quality
//      actually holds Quality Manager. That is what the role is for, so a
//      reader learns the permission model and the org chart at the same time,
//      instead of learning that demo data has demo people in it.
//
// The cost, stated rather than discovered: personas are less obvious than
// extra people would be, since nothing in a person's name marks them. That is
// what `why` and the printed credentials table are for.
//
// ## Why this is validated rather than written in prose
//
// The fixture comment claimed Yasser was "the tenant admin and the Quality
// Manager persona" while he held no role at all and hessa was the admin. Prose
// drifted from the data because nothing could contradict it. Every field here
// is checked by validateFixture() against the real role seed, the real
// permission catalogue and the fixture's own people — so the same claim, made
// again, now fails before any write.
export interface SystemRolePersonaFixture {
  // A key from SYSTEM_ROLE_SEED, e.g. 'QUALITY_MANAGER'. Validated against it,
  // so a renamed or removed role fails here rather than seeding nothing.
  roleKey: string;
  // PersonFixture.key. Must be someone the seed leaves ACTIVE — the departing
  // head cannot demonstrate anything, because they cannot sign in.
  holder: string;
  // Why THIS person for THIS role, in one line. Not decoration: it is what a
  // reader has instead of a name that says "persona", and it is printed in the
  // credentials table at the end of a seed run.
  why: string;
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
  // The DTO's own union, not `string`: a typo'd frequency then fails at
  // compile time rather than being caught by @IsIn() at write time — or, if
  // the applier had cast it away, not at all.
  meetingFrequency: (typeof COMMITTEE_MEETING_FREQUENCIES)[number];
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
  // A vacancy is created the way it happens in reality: a head DEPARTS.
  //
  // It cannot be seeded directly. invite() carries an ACC-46 hard block —
  // "cannot invite anyone into a unit with no direct Head and no Acting
  // Head", and hasDirectOrActingHead() looks only at the target unit, never
  // at escalation coverage from a parent. So a unit cannot be born headless
  // with staff in it; the product forbids exactly that state as a starting
  // point.
  //
  // Instead: the departing head is invited and activated, the staffer is
  // invited beneath them, and the head is then deactivated. That is strictly
  // better than seeding the end state by hand — deactivate() itself calls
  // refreshOrgUnitHeadVacancy(), so isHeadVacant/headVacantSince are set by
  // the real mechanism rather than written directly by the seed.
  //
  // Confirmed before relying on it: deactivate() never touches its reports'
  // managerId (reassignAllForUser moves TaskAssignee rows, not people), and
  // its only throw is last-admin lockout. The staffer is therefore left
  // exactly in place.
  vacantHeadUnit: {
    unit: string;
    // Must hold a head-conferring position IN that unit, and must be its ONLY
    // head — validateUnitHeadUniqueness() permits just one per unit.
    departingHead: string;
  };

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
  // ACC-107 — REQUIRED, and required to be complete: validateFixture() proves
  // every assignable seeded system role has a holder here. Optional would mean
  // a fixture could silently go back to demonstrating nothing, which is the
  // state this ticket exists to end.
  systemRolePersonas: SystemRolePersonaFixture[];
  // ACC-107 — no longer optional. Custom roles are the product's central claim
  // about permissions, and until ACC-101 nothing exercised createRole's custom
  // path at all. A tenant fixture with none leaves that path unseeded again.
  customRoles: CustomRoleFixture[];
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
  // The admin MUST be the root unit's head, and this is forced by the code,
  // not a preference. PlatformTenantService.createTenant() invites the admin
  // as 'Director' in the root unit — a head-conferring position — before this
  // seed runs. hasAnyHeadConferringHolder() counts ACTIVE *and* INVITED, so
  // that invited admin already blocks anyone else from becoming root's head
  // via validateUnitHeadUniqueness(). Any other adminKey makes the seed
  // unrunnable.
  const admin = peopleByKey.get(fixture.adminKey);
  if (!admin) {
    errors.push(`adminKey '${fixture.adminKey}' is not a person in this fixture.`);
  } else {
    if (admin.unit !== fixture.tree.key) {
      errors.push(
        `adminKey '${fixture.adminKey}' is in '${admin.unit}', but createTenant() places the tenant admin ` +
          `in the ROOT unit ('${fixture.tree.key}'), where they immediately hold a head-conferring position.`,
      );
    }
    if (!headPositions.has(admin.position)) {
      errors.push(
        `adminKey '${fixture.adminKey}' holds '${admin.position}', which is not head-conferring. ` +
          "createTenant() invites the admin as 'Director' (a head position) in the root unit, so the " +
          'fixture must reconcile to another head position, not a non-head one.',
      );
    }
    if (admin.reportsTo !== null) {
      errors.push(`adminKey '${fixture.adminKey}' must be the root of the reporting tree (reportsTo: null).`);
    }
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

  // The vacancy is produced by deactivating a real head, so the fixture must
  // describe the state BEFORE the departure and every part of the story must
  // hold: the unit has exactly one head (who leaves), at least one non-head
  // staffer (who stays, and is the point), and an ancestor with its own head
  // (so the result is a PARTIAL vacancy that exercises the walk-up rather
  // than the fully-unresolved case ACC-62 deliberately does not seed).
  const vacancy = edge.vacantHeadUnit;
  const holdersOfHeadPositionIn = (unitKey: string): PersonFixture[] =>
    fixture.people.filter((p) => p.unit === unitKey && headPositions.has(p.position));

  if (!unitKeys.has(vacancy.unit)) {
    errors.push(`edgeCases.vacantHeadUnit.unit '${vacancy.unit}' is not a known unit.`);
  } else {
    const departing = peopleByKey.get(vacancy.departingHead);
    if (!departing) {
      errors.push(`edgeCases.vacantHeadUnit.departingHead '${vacancy.departingHead}' is not a known person.`);
    } else {
      if (departing.unit !== vacancy.unit) {
        errors.push(
          `Departing head '${departing.key}' is in '${departing.unit}', not the vacating unit '${vacancy.unit}'.`,
        );
      }
      if (!headPositions.has(departing.position)) {
        errors.push(
          `Departing head '${departing.key}' holds '${departing.position}', which is not head-conferring — ` +
            'deactivating them would not vacate anything.',
        );
      }
    }

    const heads = holdersOfHeadPositionIn(vacancy.unit);
    if (heads.length > 1) {
      errors.push(
        `Unit '${vacancy.unit}' has ${heads.length} head-position holders (${heads.map((h) => h.key).join(', ')}). ` +
          'validateUnitHeadUniqueness() permits only one per unit, so the invite would be rejected.',
      );
    }

    const remainingStaff = fixture.people.filter(
      (p) => p.unit === vacancy.unit && p.key !== vacancy.departingHead,
    );
    if (remainingStaff.length === 0) {
      errors.push(
        `Unit '${vacancy.unit}' would be empty after the head departs. The case exists to show a unit ` +
          'with real staff and no head — an empty unit demonstrates nothing.',
      );
    }
    // A staffer must NOT report to the departing head: deactivate() does not
    // touch its reports' managerId, so that would leave a dangling manager
    // pointing at an INACTIVE user.
    for (const staff of remainingStaff) {
      if (staff.reportsTo === vacancy.departingHead) {
        errors.push(
          `'${staff.key}' reports to the departing head '${vacancy.departingHead}'. deactivate() leaves ` +
            'reports\' managerId untouched, so this would dangle at an INACTIVE user — report to the parent unit instead.',
        );
      }
    }

    let ancestor = parentByUnit.get(vacancy.unit) ?? null;
    let covered = false;
    while (ancestor) {
      if (holdersOfHeadPositionIn(ancestor).length > 0) {
        covered = true;
        break;
      }
      ancestor = parentByUnit.get(ancestor) ?? null;
    }
    if (!covered) {
      errors.push(
        `Unit '${vacancy.unit}' has no head anywhere up its chain once its own departs. ` +
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

  // declareHandover()'s own guards, checked here so a fixture fails at
  // validation rather than mid-seed:
  //   - the outgoing person must be the unit's current ACTIVE head, or it
  //     throws "no current Head to hand over from";
  //   - the incoming person must NOT already hold a head-conferring position
  //     anywhere, or it throws "already holds a different Head-conferring
  //     position" — silently reassigning them would orphan the unit they
  //     currently head, with no VACATED event recorded for it.
  const outgoing = peopleByKey.get(edge.handover.from);
  const incoming = peopleByKey.get(edge.handover.to);
  if (outgoing) {
    if (outgoing.unit !== edge.handover.unit) {
      errors.push(
        `Handover's outgoing head '${outgoing.key}' is in '${outgoing.unit}', not '${edge.handover.unit}'.`,
      );
    }
    if (!headPositions.has(outgoing.position)) {
      errors.push(
        `Handover's outgoing head '${outgoing.key}' holds '${outgoing.position}', which is not ` +
          'head-conferring — declareHandover() would reject the unit as having no current Head.',
      );
    }
  }
  if (incoming && headPositions.has(incoming.position)) {
    errors.push(
      `Handover's incoming successor '${incoming.key}' already holds the head-conferring position ` +
        `'${incoming.position}'. declareHandover() rejects that outright, to avoid orphaning the unit ` +
        'they currently head.',
    );
  }
  if (outgoing && incoming && outgoing.key === incoming.key) {
    errors.push('Handover outgoing and incoming must be different people.');
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

  // -- Custom roles (ACC-101) ------------------------------------------------
  // Both halves checked against reality rather than trusted: a permission
  // string that no longer exists would seed a role granting nothing, and a
  // holder key typo would fail deep inside the applier.
  const knownPermissions = new Set(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`));

  // -- System-role personas (ACC-107) ----------------------------------------
  // The claim "this person demonstrates this role" is checked against the real
  // role seed and the fixture's own data, so it cannot drift into prose the way
  // the old Yasser comment did.
  const seededRoleKeys = new Set(SYSTEM_ROLE_SEED.map((r) => r.key));
  const personaByRole = new Map<string, string>();

  for (const persona of fixture.systemRolePersonas) {
    if (!seededRoleKeys.has(persona.roleKey)) {
      errors.push(
        `Persona references unknown system role '${persona.roleKey}'. ` +
          `It must be a key in SYSTEM_ROLE_SEED (${[...seededRoleKeys].join(', ')}).`,
      );
    }
    // PLATFORM_ADMIN is seeded into every tenant but is inert there and is
    // filtered out of the assignable-roles list (ACC-13). Granting it to a
    // tenant person would seed the exact cross-tenant escalation PlatformGuard
    // exists to refuse.
    if (persona.roleKey === PLATFORM_ROLE_KEY) {
      errors.push(
        `Persona grants '${PLATFORM_ROLE_KEY}' to a tenant person. That role is inert in a ` +
          'tenant and is deliberately unassignable — PlatformGuard requires isPlatformOrg too.',
      );
    }
    if (!peopleByKey.has(persona.holder)) {
      errors.push(`Persona for '${persona.roleKey}' is held by unknown person '${persona.holder}'.`);
    }
    // A departed person cannot sign in, so they cannot demonstrate anything.
    // Caught here rather than in a browser, where it looks like a broken login.
    if (persona.holder === fixture.edgeCases.vacantHeadUnit.departingHead) {
      errors.push(
        `Persona for '${persona.roleKey}' is held by '${persona.holder}', whom the vacancy edge ` +
          'case deactivates. A deactivated holder cannot sign in, so the persona proves nothing.',
      );
    }
    if (!persona.why.trim()) {
      errors.push(`Persona for '${persona.roleKey}' has no 'why' — a reader needs the reason.`);
    }
    const existing = personaByRole.get(persona.roleKey);
    if (existing) {
      errors.push(
        `System role '${persona.roleKey}' has two personas ('${existing}', '${persona.holder}'). ` +
          'One holder per role keeps the credentials table unambiguous.',
      );
    }
    personaByRole.set(persona.roleKey, persona.holder);
  }

  // THE COMPLETENESS CHECK — the acceptance criterion this ticket turns on.
  // Without it a fixture could drop a persona and quietly stop demonstrating
  // that role, which is exactly how the seed reached this state.
  for (const key of seededRoleKeys) {
    if (key === PLATFORM_ROLE_KEY) continue;
    if (!personaByRole.has(key)) {
      errors.push(
        `Seeded system role '${key}' has no persona. Every assignable role needs one active, ` +
          'credentialed holder, or permission behaviour cannot be demonstrated in a browser.',
      );
    }
  }

  // TENANT_ADMIN is granted by bootstrap() to the tenant's own admin, not by
  // the persona applier. Declaring anyone else would be a statement the seed
  // does not carry out.
  const adminPersona = personaByRole.get('TENANT_ADMIN');
  if (adminPersona && adminPersona !== fixture.adminKey) {
    errors.push(
      `TENANT_ADMIN's persona is '${adminPersona}' but the fixture's adminKey is ` +
        `'${fixture.adminKey}'. bootstrap() grants TENANT_ADMIN to adminKey, so any other ` +
        'holder would be a claim the seed never carries out.',
    );
  }

  if (fixture.customRoles.length === 0) {
    errors.push(
      'Fixture declares no custom roles. Custom roles are the product\'s central claim about ' +
        "permissions, and nothing else exercises RoleService.createRole's custom path.",
    );
  }

  for (const role of fixture.customRoles) {
    for (const permission of role.permissions) {
      if (!knownPermissions.has(permission)) {
        errors.push(
          `Custom role '${role.nameEn}' references unknown permission '${permission}'. ` +
            `It must be one of the strings in common/constants/permissions.ts.`,
        );
      }
    }
    if (role.permissions.length === 0) {
      errors.push(`Custom role '${role.nameEn}' grants no permissions, which seeds nothing useful.`);
    }
    for (const holder of role.holders) {
      if (!peopleByKey.has(holder)) {
        errors.push(`Custom role '${role.nameEn}' is held by unknown person '${holder}'.`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Fixture '${fixture.slug}' is invalid (${errors.length} problem(s)):\n` +
        errors.map((e) => `  - ${e}`).join('\n'),
    );
  }
}
