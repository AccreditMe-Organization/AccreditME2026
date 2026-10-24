import {
  ROOT_ROLE_ONLY_PERMISSIONS,
  assertKnownAndGrantable,
  assertNotRootRoleOnly,
  isRootRoleOnly,
} from './permission-grantability';
import { PermissionRootRoleOnlyException } from './role-permission-refusal';

// ACC-258 — workflows:manage is a key only the tenant's root role
// (Organization Administrator) may hold. The rule is kept apart from the
// transition check on purpose: a transition may still require the key.

describe('permission grantability — root-role-only keys (ACC-258)', () => {
  it('lists exactly workflows:manage', () => {
    expect([...ROOT_ROLE_ONLY_PERMISSIONS]).toEqual(['workflows:manage']);
    expect(isRootRoleOnly('workflows:manage')).toBe(true);
    expect(isRootRoleOnly('workflows:view')).toBe(false);
  });

  it('refuses a root-only key for a role a tenant created, and for any system role but the root role', () => {
    for (const roleKey of [null, 'QUALITY_MANAGER', 'READ_ONLY_ADMIN']) {
      const refusal = (() => {
        try {
          assertNotRootRoleOnly(['committees:view', 'workflows:manage'], roleKey);
          return null;
        } catch (e) {
          return e;
        }
      })();
      expect(refusal).toBeInstanceOf(PermissionRootRoleOnlyException);
      expect((refusal as PermissionRootRoleOnlyException).getStatus()).toBe(400);
      expect((refusal as PermissionRootRoleOnlyException).getResponse()).toMatchObject({
        code: 'PERMISSION_ROOT_ROLE_ONLY',
        keys: ['workflows:manage'],
        message: "Only the Organization Administrator role can edit workflows. This permission can't be given to another role.",
      });
    }
  });

  it('passes the root role, and any set without a root-only key', () => {
    expect(() => assertNotRootRoleOnly(['workflows:manage'], 'TENANT_ADMIN')).not.toThrow();
    expect(() => assertNotRootRoleOnly(['workflows:view', 'committees:manage'], null)).not.toThrow();
    expect(() => assertNotRootRoleOnly([], null)).not.toThrow();
  });

  it('leaves the transition check alone: a transition may still require workflows:manage', () => {
    expect(() => assertKnownAndGrantable(['workflows:manage'], false)).not.toThrow();
  });
});
