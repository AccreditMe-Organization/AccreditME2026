import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Route, Router, UrlTree, provideRouter } from '@angular/router';
import { ROLES_ROUTES } from './roles.routes';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ROUTE_PERMISSIONS, USER_PERMISSIONS_LOOKUP } from '../../core/navigation/nav-items';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

// ACC-272 — "A user's permissions" opens only with admin:access, roles:view
// AND users:view: one list (USER_PERMISSIONS_LOOKUP), read by the route map and
// by both ways in. The guard is run as the router runs it, on the configured
// path, so a typed address is refused, not only a link hidden.

const LOOKUP = ['admin:access', 'roles:view', 'users:view'];

describe("A user's permissions: the route (ACC-272)", () => {
  it('the list is the three permissions, and the route map reads it', () => {
    expect([...USER_PERMISSIONS_LOOKUP]).toEqual(LOOKUP);
    expect(ROUTE_PERMISSIONS.get('roles/user-permissions')).toEqual(USER_PERMISSIONS_LOOKUP);
  });

  for (const path of ['user-permissions', 'user-permissions/:userId']) {
    it(`${path} runs the guard itself`, () => {
      const route = ROLES_ROUTES.find((r) => r.path === path);
      expect(route).withContext(path).toBeDefined();
      expect(route!.canActivate).toContain(permissionGuard);
    });
  }

  /** The guard on roles/<path>, as the router calls it. */
  function guard(path: string, held: readonly string[]): boolean | UrlTree {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: NavigationAccessService, useValue: { hasTrustworthyPermissions: () => true, hasPermission: (p: string) => held.includes(p) } },
      ],
    });
    const config = (p: string): Route => ({ path: p });
    const snapshot = { pathFromRoot: [{ routeConfig: null }, { routeConfig: config('roles') }, { routeConfig: config(path) }] } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() => permissionGuard(snapshot, { url: '', root: snapshot } as never) as boolean | UrlTree);
  }

  for (const path of ['user-permissions', 'user-permissions/:userId']) {
    it(`${path}: allowed with all three`, () => {
      expect(guard(path, LOOKUP)).toBeTrue();
    });

    for (const missing of LOOKUP) {
      it(`${path}: refused without ${missing}`, () => {
        const result = guard(path, LOOKUP.filter((p) => p !== missing));
        expect(result instanceof UrlTree).withContext(`without ${missing}`).toBeTrue();
        expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/home');
      });
    }
  }
});
