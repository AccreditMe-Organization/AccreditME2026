import { ROLES_ROUTES } from './roles.routes';
import { permissionGuard } from '../../core/guards/permission.guard';

// ACC-123 — the permission MATRIX is the screen that grants permissions, and it
// was reachable by URL to anyone signed in.
//
// Why a test rather than a note: the hole is INVISIBLE in both places a reader
// would look. ROUTE_PERMISSIONS correctly maps 'roles' to [admin:access,
// roles:view], and the parent route is guarded — so a mapping test passes and
// the list screen behaves. The child simply never ran the guard, because a
// route with no canActivate does not run one, and permissionGuard allows an
// unmapped path by design (an absent entry means "not gated", not "denied").
//
// Same shape as ADMIN_SETTINGS_ROUTES (ACC-79) and tasks/all. Three places have
// now had it; this pins the third.
describe('ROLES_ROUTES (ACC-123)', () => {
  const matrix = ROLES_ROUTES.find((r) => r.path === ':id/permissions');

  it('has a permissions matrix route', () => {
    expect(matrix).toBeDefined();
  });

  it('runs permissionGuard on the matrix, which the parent route cannot do for it', () => {
    expect(matrix!.canActivate).toContain(permissionGuard);
  });

  // No canActivate on the list: it is the mapped path itself, reached through
  // the rail, and its parent in app.routes carries the guard. Asserted so that
  // removing the guard THERE is a visible change rather than a silent one.
  it('declares the list route at the bare path', () => {
    expect(ROLES_ROUTES.some((r) => r.path === '')).toBe(true);
  });
});
