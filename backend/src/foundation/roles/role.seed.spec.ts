import { SYSTEM_ROLE_SEED } from './role.seed';
import { ALL_PERMISSIONS } from './permission.seed';
import { SETUP_PERMISSIONS } from '../../common/constants/permissions';

// ACC-82 — who sees Setup health. Pinned here because the answer lives in two
// hand-maintained places (TENANT_ADMIN's ALL spread, and each other role's
// explicit list) and a new permission reaching the wrong role is silent: no
// test fails, a role just quietly gains a surface.
describe('SYSTEM_ROLE_SEED — setup:view (ACC-82)', () => {
  const permissionsOf = (key: string): string[] =>
    SYSTEM_ROLE_SEED.find((r) => r.key === key)?.permissions ?? [];

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
