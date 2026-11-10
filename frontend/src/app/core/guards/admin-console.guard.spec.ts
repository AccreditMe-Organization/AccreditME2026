import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { adminConsoleGuard } from './admin-console.guard';
import { NavigationAccessService } from '../services/navigation-access.service';
import { LANDING_ROUTE } from '../navigation/landing-route';
import { ADMIN_ACCESS } from '../navigation/admin-access';
import { MyWorkCountsService } from '../../foundation/home/my-work-counts.service';

// ACC-292 — /admin opens for exactly the people the rail shows Administration
// to: admin:access AND at least one Administration item. The refusals first:
// an allow-only suite would pass against a guard that always said yes.
describe('adminConsoleGuard (ACC-292)', () => {
  let router: Router;

  function run(opts: { permissions: string[]; trustworthy?: boolean; platformAdmin?: boolean }): boolean | UrlTree {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => opts.permissions.includes(p),
            hasTrustworthyPermissions: () => opts.trustworthy ?? true,
            isModuleEnabled: () => false,
            isPlatformAdmin: () => opts.platformAdmin ?? false,
          },
        },
        { provide: MyWorkCountsService, useValue: { isCommitteeMember: () => false } },
      ],
    });
    router = TestBed.inject(Router);
    return TestBed.runInInjectionContext(() =>
      adminConsoleGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  it('refuses a person without admin:access, even holding admin page permissions', () => {
    const result = run({ permissions: ['users:view', 'org:view', 'lookups:view', 'workflows:view'] });
    expect(result).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('refuses admin:access with no Administration page to open', () => {
    expect(run({ permissions: [ADMIN_ACCESS] })).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('refuses a platform admin, whose shell has no Administration', () => {
    expect(run({ permissions: [ADMIN_ACCESS, 'users:view', 'platform:admin'], platformAdmin: true })).toEqual(
      router.parseUrl(LANDING_ROUTE),
    );
  });

  it('admits admin:access with one Administration page', () => {
    expect(run({ permissions: [ADMIN_ACCESS, 'roles:view'] })).toBe(true);
  });

  it('admits admin:access with only Setup health (the strip, and no card)', () => {
    expect(run({ permissions: [ADMIN_ACCESS, 'setup:view'] })).toBe(true);
  });

  // ACC-70's rule: a failed loadAccess() is not a refusal.
  it('admits while permissions are not trustworthy, and lets the server answer', () => {
    expect(run({ permissions: [], trustworthy: false })).toBe(true);
  });
});
