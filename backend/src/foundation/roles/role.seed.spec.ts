import { SYSTEM_ROLE_SEED } from './role.seed';
import { ALL_PERMISSIONS } from './permission.seed';
import {
  AUDITS_PERMISSIONS,
  BILLING_PERMISSIONS,
  COMMITTEES_PERMISSIONS,
  DOCUMENTS_PERMISSIONS,
  INCIDENTS_PERMISSIONS,
  KPI_PERMISSIONS,
  LOOKUPS_PERMISSIONS,
  MEETINGS_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS,
  ORG_PERMISSIONS,
  POSITIONS_PERMISSIONS,
  REPORTS_PERMISSIONS,
  ROLES_PERMISSIONS,
  SETUP_PERMISSIONS,
  STANDARDS_PERMISSIONS,
  TASKS_PERMISSIONS,
  TENANT_PERMISSIONS,
  USERS_PERMISSIONS,
  WORKFLOWS_PERMISSIONS,
  ADMIN_PERMISSIONS,
} from '../../common/constants/permissions';

// ACC-82 — who sees Setup health. Pinned here because the answer lives in two
// hand-maintained places (TENANT_ADMIN's ALL spread, and each other role's
// explicit list) and a new permission reaching the wrong role is silent: no
// test fails, a role just quietly gains a surface.
const permissionsOf = (key: string): string[] =>
  SYSTEM_ROLE_SEED.find((r) => r.key === key)?.permissions ?? [];

// ACC-101 — BASE_USER's EXACT permission set, not merely the absence of
// tasks:view.
//
// An absence test would pass again the moment someone adds a different
// tenant-wide read to the role every staff member holds, which is the mistake
// this ticket exists to undo rather than a hypothetical. This role is the
// baseline: whatever is in this list, everyone in the tenant can do. Changing
// it should require editing a test that says so out loud.
describe('SYSTEM_ROLE_SEED — BASE_USER holds exactly its baseline set (ACC-101)', () => {
  it('holds these permissions and no others', () => {
    expect([...permissionsOf('BASE_USER')].sort()).toEqual(
      [
        DOCUMENTS_PERMISSIONS.VIEW,
        MEETINGS_PERMISSIONS.VIEW,
        KPI_PERMISSIONS.VIEW_OWN,
        KPI_PERMISSIONS.ENTER_DATA,
        NOTIFICATIONS_PERMISSIONS.VIEW,
      ].sort(),
    );
  });

  // Named separately from the set above, because the REASON matters more than
  // the fact: tasks:view gates the tenant-wide task reads, not a user's own
  // work. my-tasks is ungated and self-scoped, so this costs a staff member
  // nothing they actually use.
  it('does NOT hold tasks:view, which gates tenant-wide task reads rather than a user\'s own', () => {
    expect(permissionsOf('BASE_USER')).not.toContain(TASKS_PERMISSIONS.VIEW);
  });

  // The roles that keep it, so a removal here is deliberate rather than
  // collateral: an administrative or cross-cutting reader, never the baseline.
  it.each([
    'TENANT_ADMIN',
    'QUALITY_MANAGER',
    'QUALITY_OFFICER',
    'AUDITOR',
    'VIEWER',
    'READ_ONLY_ADMIN',
  ])(
    'keeps tasks:view on %s',
    (key) => {
      expect(permissionsOf(key)).toContain(TASKS_PERMISSIONS.VIEW);
    },
  );
});

describe('SYSTEM_ROLE_SEED — setup:view (ACC-82)', () => {

  it('is in the global permission catalog', () => {
    expect(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`)).toContain(
      SETUP_PERMISSIONS.VIEW,
    );
  });

  // READ_ONLY_ADMIN holds it too (ACC-123's read-only administrator). Setup health
  // is a list of configuration gaps, which is exactly what an inspector is there
  // to see — and every Fix on it is suppressed for someone who cannot save,
  // because a row's Fix needs both the destination's permission and the one its
  // save needs (ACC-82).
  it.each(['TENANT_ADMIN', 'READ_ONLY_ADMIN'])('is granted to %s', (key) => {
    expect(permissionsOf(key)).toContain(SETUP_PERMISSIONS.VIEW);
  });

  // The conditions a tenant admin fixes are configuration gaps; no other seeded
  // role administers configuration. VIEWER's readOnly() list is explicit, so a
  // new group does not reach it by accident — this keeps it that way.
  it.each(['QUALITY_MANAGER', 'QUALITY_OFFICER', 'AUDITOR', 'BASE_USER', 'VIEWER'])(
    'is not granted to %s',
    (key) => {
      expect(SYSTEM_ROLE_SEED.some((r) => r.key === key)).toBe(true);
      expect(permissionsOf(key)).not.toContain(SETUP_PERMISSIONS.VIEW);
    },
  );
});

// ACC-123 — who may administer the tenant.
//
// The negative half is the reason this ticket exists, so it is tested per role
// by name rather than as one "nobody else" assertion: QUALITY_MANAGER holding
// users:view, org:view, lookups:view and workflows:view for its PICKERS is
// correct and unchanged, and must not amount to administering. If a future
// change hands admin:access to one of these roles, that is a decision someone
// has to make by editing a test that says so.
describe('SYSTEM_ROLE_SEED — admin:access (ACC-123)', () => {
  it('is in the global permission catalog', () => {
    expect(ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`)).toContain(
      ADMIN_PERMISSIONS.ACCESS,
    );
  });

  // The two roles that may administer, and they differ in what they may then DO:
  // TENANT_ADMIN holds all 72 permissions, READ_ONLY_ADMIN holds 21 reads. Listed
  // together because "who may reach Administration" is one question and the answer
  // must be enumerable.
  it.each(['TENANT_ADMIN', 'READ_ONLY_ADMIN'])('is granted to %s', (key) => {
    expect(permissionsOf(key)).toContain(ADMIN_PERMISSIONS.ACCESS);
  });

  it.each(['QUALITY_MANAGER', 'QUALITY_OFFICER', 'AUDITOR', 'BASE_USER', 'VIEWER'])(
    'is not granted to %s',
    (key) => {
      expect(SYSTEM_ROLE_SEED.some((r) => r.key === key)).toBe(true);
      expect(permissionsOf(key)).not.toContain(ADMIN_PERMISSIONS.ACCESS);
    },
  );

  // The seeded roles that hold a page permission WITHOUT holding admin:access.
  // This is the state the frontend gating now depends on: if these lists ever
  // came apart — a role gaining admin:access, or losing the view permission —
  // the rail would change for that role with no test naming the change.
  it.each([
    ['QUALITY_MANAGER', 'users:view'],
    ['QUALITY_MANAGER', 'org:view'],
    ['QUALITY_MANAGER', 'lookups:view'],
    ['QUALITY_MANAGER', 'workflows:view'],
    ['QUALITY_OFFICER', 'tasks:manage'],
  ])('%s keeps %s but still cannot administer', (key, permission) => {
    expect(permissionsOf(key)).toContain(permission);
    expect(permissionsOf(key)).not.toContain(ADMIN_PERMISSIONS.ACCESS);
  });
});


// ACC-123 — READ_ONLY_ADMIN, the role that makes "reaches the page, cannot write"
// a real position rather than a hypothetical one.
//
// Its permissions are DERIVED in role.seed.ts (admin:access + every view-shaped
// permission in the catalogue). The derivation is what keeps writes out; these
// tests are what keep the derivation honest, and they are three different claims
// rather than one:
//
//   1. the exact set, listed by hand, so ADDING a read to the catalogue fails
//      here and somebody decides whether an inspector should see it;
//   2. nothing in the set is a write, which is the role's entire promise and
//      would survive the list above being updated carelessly;
//   3. the set is COMPLETE against the catalogue, so a read added later does not
//      leave an administrator looking at a screen with a blank section.
//
// 1 and 3 fail together on a new read-shaped permission, deliberately: the first
// says "a human must look at this", the third says "and here is what is missing".
describe('SYSTEM_ROLE_SEED — READ_ONLY_ADMIN (ACC-123)', () => {
  const VIEW_SHAPED = /:(view|view_[a-z_]+)$/;

  const EXPECTED = [
    ADMIN_PERMISSIONS.ACCESS,
    AUDITS_PERMISSIONS.VIEW,
    BILLING_PERMISSIONS.VIEW,
    COMMITTEES_PERMISSIONS.VIEW,
    DOCUMENTS_PERMISSIONS.VIEW,
    INCIDENTS_PERMISSIONS.VIEW,
    KPI_PERMISSIONS.VIEW_ALL,
    KPI_PERMISSIONS.VIEW_DEPARTMENT,
    KPI_PERMISSIONS.VIEW_OWN,
    LOOKUPS_PERMISSIONS.VIEW,
    MEETINGS_PERMISSIONS.VIEW,
    NOTIFICATIONS_PERMISSIONS.VIEW,
    ORG_PERMISSIONS.VIEW,
    POSITIONS_PERMISSIONS.VIEW,
    REPORTS_PERMISSIONS.VIEW,
    ROLES_PERMISSIONS.VIEW,
    SETUP_PERMISSIONS.VIEW,
    STANDARDS_PERMISSIONS.VIEW,
    TASKS_PERMISSIONS.VIEW,
    TENANT_PERMISSIONS.VIEW,
    USERS_PERMISSIONS.VIEW,
    WORKFLOWS_PERMISSIONS.VIEW,
  ];

  it('is a seeded system role', () => {
    expect(SYSTEM_ROLE_SEED.some((r) => r.key === 'READ_ONLY_ADMIN')).toBe(true);
  });

  it('holds exactly admin:access plus the 21 view permissions, and nothing else', () => {
    expect(EXPECTED).toHaveLength(22);
    expect([...permissionsOf('READ_ONLY_ADMIN')].sort()).toEqual([...EXPECTED].sort());
  });

  // The promise the role is named for. Stated separately from the list above so it
  // cannot be lost by someone updating that list to make a failure go away.
  it('holds no permission that is not a read', () => {
    const writes = permissionsOf('READ_ONLY_ADMIN').filter(
      (p) => p !== ADMIN_PERMISSIONS.ACCESS && !VIEW_SHAPED.test(p),
    );
    expect(writes).toEqual([]);
  });

  // Completeness, against the real catalogue rather than against EXPECTED — so the
  // two cannot agree with each other while both being out of date.
  it('covers every view-shaped permission in the catalogue', () => {
    const catalogueReads = ALL_PERMISSIONS.map((p) => `${p.module}:${p.action}`)
      .filter((p) => VIEW_SHAPED.test(p))
      .sort();
    const held = permissionsOf('READ_ONLY_ADMIN');
    expect(catalogueReads.filter((p) => !held.includes(p))).toEqual([]);
  });

  // Not platform:admin or platform:impersonate, which are not view-shaped and so
  // cannot reach this role by the derivation. Asserted anyway: a tenant role
  // holding either would be the cross-tenant escalation PlatformGuard exists to
  // refuse, and a future platform:view_something WOULD match the filter.
  it('holds no platform permission', () => {
    expect(permissionsOf('READ_ONLY_ADMIN').filter((p) => p.startsWith('platform:'))).toEqual([]);
  });

  // Measured in this ticket and recorded as a test, because it is the reason the
  // role is new rather than an extension: VIEWER is 9 short, not 1.
  it('is not reachable by adding admin:access to VIEWER', () => {
    const viewer = permissionsOf('VIEWER');
    const missing = EXPECTED.filter((p) => !viewer.includes(p));
    expect(missing).toHaveLength(9);
    expect(missing).toContain(ADMIN_PERMISSIONS.ACCESS);
    expect(missing).toContain(SETUP_PERMISSIONS.VIEW);
  });
});
