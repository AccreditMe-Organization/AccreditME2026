import { SYSTEM_ROLE_SEED } from './role.seed';
import { ALL_PERMISSIONS } from './permission.seed';
import {
  DOCUMENTS_PERMISSIONS,
  KPI_PERMISSIONS,
  MEETINGS_PERMISSIONS,
  NOTIFICATIONS_PERMISSIONS,
  SETUP_PERMISSIONS,
  TASKS_PERMISSIONS,
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
  it.each(['TENANT_ADMIN', 'QUALITY_MANAGER', 'QUALITY_OFFICER', 'AUDITOR', 'VIEWER'])(
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

  it('is granted to TENANT_ADMIN', () => {
    expect(permissionsOf('TENANT_ADMIN')).toContain(SETUP_PERMISSIONS.VIEW);
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

  it('is granted to TENANT_ADMIN', () => {
    expect(permissionsOf('TENANT_ADMIN')).toContain(ADMIN_PERMISSIONS.ACCESS);
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
