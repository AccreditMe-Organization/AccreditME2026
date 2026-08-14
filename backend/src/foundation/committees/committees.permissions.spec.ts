import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { CommitteesController } from './committees.controller';
import { COMMITTEES_PERMISSIONS } from '../../common/constants/permissions';

// ACC-28 correction (Retrospective Note 2, step-28-resource-scoped-roles.md
// Section 2.3): assertCommitteeAuthority() — a Chairman-specific
// resource-instance check — was removed entirely and replaced with a plain
// @Permissions() decorator per method, the same mechanism every other
// controller in this codebase already uses.
//
// committees.controller.spec.ts (like every other *.controller.spec.ts in
// this codebase) overrides PermissionGuard with a stub and only tests
// delegation to the service — it cannot prove enforcement. This file uses
// the REAL PermissionGuard against CommitteesController's REAL
// @Permissions() metadata (SetMetadata attaches metadata directly to the
// method function referenced by the property descriptor, so
// CommitteesController.prototype.createCommittee genuinely carries what the
// decorator set) to prove each of the 5 corrected methods is actually
// gated by its own specific permission string, not just that the
// controller *looks* wired correctly by inspection.
//
// No DB, no HTTP layer, no tenant concept at this layer on purpose —
// PermissionGuard only ever checks request.userPermissions membership; it
// has no notion of tenant at all. Tenant-scoped resolution of
// userPermissions itself is RoleService.getUserPermissions()'s concern,
// already covered by that service's own tenant-isolation test. There is no
// new tenant-crossing surface here to test — the old Chairman check's
// tenant-isolation test existed specifically because that check ran its
// own cross-tenant CommitteeMember query; the replacement runs no query at
// all.

type HandlerName = 'createCommittee' | 'updateCommittee' | 'addMember' | 'changeMemberRole' | 'removeMember';

const CASES: Array<[HandlerName, string]> = [
  ['createCommittee', COMMITTEES_PERMISSIONS.CREATE],
  ['updateCommittee', COMMITTEES_PERMISSIONS.EDIT_DETAILS],
  ['addMember', COMMITTEES_PERMISSIONS.ADD_MEMBER],
  ['changeMemberRole', COMMITTEES_PERMISSIONS.CHANGE_MEMBER_ROLE],
  ['removeMember', COMMITTEES_PERMISSIONS.REMOVE_MEMBER],
];

function buildContext(handlerName: HandlerName, userPermissions: string[]): ExecutionContext {
  const handler = (CommitteesController.prototype as unknown as Record<HandlerName, () => unknown>)[handlerName];
  const request = { userPermissions };
  return {
    getHandler: () => handler,
    getClass: () => CommitteesController,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CommitteesController permission wiring (ACC-28 correction — Retrospective Note 2)', () => {
  const guard = new PermissionGuard(new Reflector());

  it.each(CASES)('%s rejects a caller lacking %s', (handlerName, permission) => {
    const ctx = buildContext(handlerName, []);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it.each(CASES)('%s rejects a caller holding only an unrelated committees permission', (handlerName, permission) => {
    const unrelated = Object.values(COMMITTEES_PERMISSIONS).filter((p) => p !== permission);
    const ctx = buildContext(handlerName, unrelated);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it.each(CASES)('%s accepts a caller holding exactly %s', (handlerName, permission) => {
    const ctx = buildContext(handlerName, [permission]);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('a role holding the full committees:* bundle (as role.seed.ts grants PLATFORM_ADMIN/TENANT_ADMIN/QUALITY_MANAGER) performs all 5 actions', () => {
    // Simulates the real seeded shape: literal RolePermission rows for
    // every committees:* string via role.seed.ts's
    // Object.values(COMMITTEES_PERMISSIONS) spread — not the old design's
    // "does MANAGE cover this" runtime fallback, which no longer exists.
    const fullBundle = Object.values(COMMITTEES_PERMISSIONS);
    for (const [handlerName] of CASES) {
      const ctx = buildContext(handlerName, fullBundle);
      expect(guard.canActivate(ctx)).toBe(true);
    }
  });
});
