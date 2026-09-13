import { ADMIN_SETTINGS_ROUTES } from './admin-settings.routes';
import { permissionGuard } from '../../core/guards/permission.guard';

// ACC-79 — the parent 'admin-settings' path lost its nav item with the hub, so
// it has no ROUTE_PERMISSIONS entry and the guard allows it. A child with no
// canActivate never runs the guard. ROUTE_PERMISSIONS being correct is
// therefore not enough on its own: this pins that the guard is actually wired
// to every screen, which a mapping test cannot see.
describe('ADMIN_SETTINGS_ROUTES (ACC-79)', () => {
  const screens = ADMIN_SETTINGS_ROUTES.filter((r) => !r.redirectTo);

  it('lists the four screens', () => {
    expect(screens.map((r) => r.path)).toEqual([
      'organization-profile',
      'email-provider',
      'ai-settings',
      'task-sla',
    ]);
  });

  it('runs permissionGuard on every screen', () => {
    for (const route of screens) {
      expect(route.canActivate)
        .withContext(route.path ?? '')
        .toContain(permissionGuard);
    }
  });

  it('redirects the removed hub URL instead of leaving it unmatched', () => {
    expect(ADMIN_SETTINGS_ROUTES[0]).toEqual(
      jasmine.objectContaining({
        path: '',
        pathMatch: 'full',
        redirectTo: 'organization-profile',
      }),
    );
  });
});
