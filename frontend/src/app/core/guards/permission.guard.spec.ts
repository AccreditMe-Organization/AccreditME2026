import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { permissionGuard } from './permission.guard';
import { NavigationAccessService } from '../services/navigation-access.service';
import { LANDING_ROUTE } from '../navigation/landing-route';

// ACC-70 — the deny path is the reason this guard exists, so it is tested
// first and hardest. An allow-only suite would pass just as happily against
// a guard that returned true unconditionally.
describe('permissionGuard', () => {
  let router: Router;

  function setup(opts: { permissions: string[]; trustworthy?: boolean }): void {
    const stub: Partial<NavigationAccessService> = {
      hasPermission: (p: string) => opts.permissions.includes(p),
      hasTrustworthyPermissions: () => opts.trustworthy ?? true,
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: NavigationAccessService, useValue: stub }],
    });
    router = TestBed.inject(Router);
  }

  function run(path: string): boolean | UrlTree {
    const route = { routeConfig: { path } } as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      permissionGuard(route, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  it('DENIES a mapped route when the permission is absent, redirecting to the landing page', () => {
    setup({ permissions: [] });

    const result = run('organization');

    expect(result).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('denies each mapped route independently — holding one permission does not grant another', () => {
    setup({ permissions: ['org:view'] });

    expect(run('organization')).toBe(true);
    expect(run('roles')).toEqual(router.parseUrl(LANDING_ROUTE));
    expect(run('users')).toEqual(router.parseUrl(LANDING_ROUTE));
    expect(run('lookups')).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('allows a mapped route when the permission is held', () => {
    setup({ permissions: ['committees:view'] });

    expect(run('committees')).toBe(true);
  });

  // The mapping is derived from the sidebar's own list, so these assert the
  // wiring rather than restating it: if nav-items.ts changed, these break.
  it('reads the permission from the shared nav mapping', () => {
    setup({ permissions: ['workflows:view', 'positions:view'] });

    expect(run('workflows')).toBe(true);
    expect(run('org-positions')).toBe(true);
    expect(run('committees')).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  // /working-calendar is mapped to org:view, not a calendar-specific
  // permission. Asserted deliberately — the guard uses whatever the shared
  // list declares, and this documents that as intended rather than a bug.
  it('honours the shared list even where the mapping looks unusual (working-calendar under org:view)', () => {
    setup({ permissions: ['org:view'] });

    expect(run('working-calendar')).toBe(true);
  });

  it('allows an UNMAPPED route — absence of an entry is not a denial', () => {
    setup({ permissions: [] });

    expect(run('home')).toBe(true);
    expect(run('admin-settings')).toBe(true);
    expect(run('')).toBe(true);
  });

  // ACC-70's failure-mode decision, asserted so it cannot be quietly reverted
  // into a lockout.
  it('allows through when the permission load FAILED, deferring to the backend', () => {
    setup({ permissions: [], trustworthy: false });

    expect(run('organization')).toBe(true);
    expect(run('roles')).toBe(true);
  });

  it('still denies when permissions loaded successfully and are genuinely empty', () => {
    setup({ permissions: [], trustworthy: true });

    expect(run('organization')).toEqual(router.parseUrl(LANDING_ROUTE));
  });
});
