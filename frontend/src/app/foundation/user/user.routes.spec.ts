import { USER_ROUTES } from './user.routes';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ownProfileGuard } from '../../core/guards/own-profile.guard';

// ACC-79 — the guard moved off the parent `users` route. A child with no
// canActivate never runs a guard, so the list would be open to anyone if its
// own guard were dropped. This pins that each child is wired.
describe('USER_ROUTES (ACC-79)', () => {
  it('guards the user list on its permission', () => {
    const list = USER_ROUTES.find((r) => r.path === '');
    expect(list?.canActivate).toContain(permissionGuard);
  });

  it('guards a profile with the own-profile rule, not the list rule', () => {
    const profile = USER_ROUTES.find((r) => r.path === ':id');
    expect(profile?.canActivate).toEqual([ownProfileGuard]);
  });
});
