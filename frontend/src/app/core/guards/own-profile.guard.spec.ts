import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { signal } from '@angular/core';
import { ownProfileGuard } from './own-profile.guard';
import { AuthService } from '../services/auth.service';
import { NavigationAccessService } from '../services/navigation-access.service';
import { LANDING_ROUTE } from '../navigation/landing-route';

// ACC-79 — the regression this fixes: a user without users:view clicked
// "My Profile" and landed on Home, because `users/:id` inherited the list's
// users:view requirement.
describe('ownProfileGuard (ACC-79)', () => {
  const ME = 'cmtra1n1i00nuocp1hnoxvttd';
  const SOMEONE_ELSE = 'cmtr9y0z3006socp1bdkkzon4';
  let router: Router;

  function setup(opts: { permissions: string[]; currentUserId: string | null }): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal(
              opts.currentUserId ? { id: opts.currentUserId, email: '', name: '' } : null,
            ).asReadonly(),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => opts.permissions.includes(p),
            hasTrustworthyPermissions: () => true,
          },
        },
      ],
    });
    router = TestBed.inject(Router);
  }

  // The real configured hierarchy: shell '' → users → :id.
  function run(profileId: string): boolean | UrlTree {
    const chain = ['', 'users', ':id'].map((path) => ({ routeConfig: { path } }));
    const route = {
      routeConfig: chain[2]!.routeConfig,
      pathFromRoot: chain,
      paramMap: convertToParamMap({ id: profileId }),
    } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      ownProfileGuard(route, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  it('lets a user with NO permissions open their own profile', () => {
    setup({ permissions: [], currentUserId: ME });
    expect(run(ME)).toBe(true);
  });

  it('still denies someone else\'s profile without users:view', () => {
    setup({ permissions: [], currentUserId: ME });
    expect(run(SOMEONE_ELSE)).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('allows someone else\'s profile with users:view', () => {
    setup({ permissions: ['users:view'], currentUserId: ME });
    expect(run(SOMEONE_ELSE)).toBe(true);
  });

  // No session means no "own" profile to match — never treat a missing id as a
  // match for a missing param.
  it('falls back to the permission rule when no user is signed in', () => {
    setup({ permissions: [], currentUserId: null });
    expect(run(ME)).toEqual(router.parseUrl(LANDING_ROUTE));
  });
});
