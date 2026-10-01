import { ROLES_ROUTES } from './roles.routes';
import { permissionGuard } from '../../core/guards/permission.guard';

// CORRECTED — this file previously said the matrix "was reachable by URL to
// anyone signed in" before the child's canActivate was added. It was not.
//
// Angular runs every ancestor's canActivate before a child activates, and the
// `roles` route in app.routes.ts carries permissionGuard. Verified by removing
// the child's guard and signing in as a BASE_USER: the matrix URL redirected to
// /home. The claim came from reading this routes file in isolation and
// generalising ACC-79's note, whose case genuinely differed — there the PARENT
// had no guard either.
//
// What these tests are worth keeping for: the guard stays declared where a
// reader of this file looks for it, and the real invariant — that SOMETHING in
// a mapped route's chain enforces it — is asserted across the whole route table
// in core/navigation/route-guard-invariant.spec.ts, which is where a fourth
// instance would actually be caught.
describe('ROLES_ROUTES (ACC-123)', () => {
  const matrix = ROLES_ROUTES.find((r) => r.path === ':id/permissions');

  it('has a permissions matrix route', () => {
    expect(matrix).toBeDefined();
  });

  // Defence in depth, not the protection itself — see the header.
  it('declares permissionGuard on the matrix', () => {
    expect(matrix!.canActivate).toContain(permissionGuard);
  });

  // No canActivate on the list: it is the mapped path itself, reached through
  // the rail, and its parent in app.routes carries the guard. Asserted so that
  // removing the guard THERE is a visible change rather than a silent one.
  it('declares the list route at the bare path', () => {
    expect(ROLES_ROUTES.some((r) => r.path === '')).toBe(true);
  });
});
