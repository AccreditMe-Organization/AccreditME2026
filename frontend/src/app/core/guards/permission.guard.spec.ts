import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
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
    // reset first — several specs below call setup() twice to compare the
    // same route under two different permission sets, and TestBed cannot be
    // reconfigured once it has been injected from.
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: NavigationAccessService, useValue: stub }],
    });
    router = TestBed.inject(Router);
  }

  // Builds a snapshot whose pathFromRoot mirrors the real route hierarchy:
  // segments are the CONFIGURED paths, with the shell's empty '' parent
  // included, since that is what the guard walks.
  function run(...segments: string[]): boolean | UrlTree {
    const chain = ['', ...segments].map((path) => ({ routeConfig: { path } }));
    const route = {
      routeConfig: chain[chain.length - 1].routeConfig,
      pathFromRoot: chain,
    } as unknown as ActivatedRouteSnapshot;
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

  // The two cases the hierarchy-based path resolution exists for. Both are
  // silently wrong if the guard reads routeConfig.path alone, or the
  // resolved URL, instead of rebuilding the configured path.
  it('applies a nested route’s OWN stricter permission (/tasks/unassigned needs tasks:manage)', () => {
    setup({ permissions: ['tasks:view'] });

    expect(run('tasks')).toBe(true);
    // tasks:view is not enough for the unassigned view.
    expect(run('tasks', 'unassigned')).toEqual(router.parseUrl(LANDING_ROUTE));

    setup({ permissions: ['tasks:view', 'tasks:manage'] });
    expect(run('tasks', 'unassigned')).toBe(true);
  });

  it('falls back to the guarded parent for a deep child (/committees/:id)', () => {
    setup({ permissions: ['committees:view'] });

    expect(run('committees', ':id')).toBe(true);

    setup({ permissions: [] });
    expect(run('committees', ':id')).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('allows an UNMAPPED route — absence of an entry is not a denial', () => {
    setup({ permissions: [] });

    expect(run('home')).toBe(true);
    expect(run()).toBe(true);
  });

  // admin-settings is drawn separately in the sidebar rather than from the
  // nav list, so it is mapped via STANDALONE_ROUTE_PERMISSIONS. Without that
  // it would have been the one permission-gated screen the guard let through.
  it('guards admin-settings, which is gated outside the nav list', () => {
    setup({ permissions: [] });
    expect(run('admin-settings')).toEqual(router.parseUrl(LANDING_ROUTE));

    setup({ permissions: ['tenant:manage_config'] });
    expect(run('admin-settings')).toBe(true);
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

// ACC-70 live pass, check 2 — the reported failure, reproduced end to end.
//
// The specs above stub NavigationAccessService, so they could not have caught
// this: the bug was in how the REAL service reacted to a 403 on /tenant, not
// in the guard's own logic. Typing /organization as a zero-permission user
// landed on the broken screen because loadAccess()'s forkJoin discarded a
// correct empty-permissions answer, leaving the guard to fail open.
//
// This wires the real service to the real guard over mocked HTTP, so the two
// are exercised together against the exact response pair the live pass hit.
describe('permissionGuard — with the real NavigationAccessService', () => {
  let router: Router;
  let httpMock: HttpTestingController;
  let service: NavigationAccessService;

  const PERMISSIONS_URL = `${environment.apiUrl}/roles/my-permissions`;
  const TENANT_URL = `${environment.apiUrl}/tenant`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        NavigationAccessService,
      ],
    });
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NavigationAccessService);
  });

  afterEach(() => httpMock.verify());

  function guard(path: string): boolean | UrlTree {
    const chain = ['', path].map((p) => ({ routeConfig: { path: p } }));
    const route = {
      routeConfig: chain[chain.length - 1].routeConfig,
      pathFromRoot: chain,
    } as unknown as ActivatedRouteSnapshot;
    return TestBed.runInInjectionContext(() =>
      permissionGuard(route, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  // Exactly what the live pass produced for Dr. Yasser Al-Amri:
  //   GET /roles/my-permissions -> 200 []
  //   GET /tenant               -> 403 "Required permission: tenant:view"
  function loadAsZeroPermissionUser(): void {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush([]);
    httpMock.expectOne(TENANT_URL).flush(
      { message: 'Required permission: tenant:view', error: 'Forbidden', statusCode: 403 },
      { status: 403, statusText: 'Forbidden' },
    );
  }

  it('DENIES every guarded route to a zero-permission user, despite /tenant returning 403', () => {
    loadAsZeroPermissionUser();

    // Ahmad only tested /organization live; the others were unverified, and
    // the fail-open branch hit before any per-route logic, so all of them
    // were reachable. Asserted together so a future regression cannot be
    // mistaken for affecting one screen.
    for (const path of [
      'organization',
      'users',
      'roles',
      'workflows',
      'lookups',
      'org-positions',
      'committees',
      'tasks',
      'working-calendar',
      'admin-settings',
    ]) {
      expect(guard(path)).withContext(path).toEqual(router.parseUrl(LANDING_ROUTE));
    }
  });

  it('still allows the landing page itself to a zero-permission user', () => {
    loadAsZeroPermissionUser();

    expect(guard('home')).toBe(true);
  });

  it('allows a guarded route to a user who holds its permission, even when /tenant 403s', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(['org:view']);
    httpMock.expectOne(TENANT_URL).flush('forbidden', { status: 403, statusText: 'Forbidden' });

    expect(guard('organization')).toBe(true);
    expect(guard('users')).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  // The transient-fault case fail-open was actually written for: the
  // PERMISSIONS call itself failing means the answer is genuinely unknown.
  it('falls open only when the permissions call itself fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush('boom', { status: 503, statusText: 'Unavailable' });
    httpMock.expectOne(TENANT_URL).flush({ isPlatformOrg: false, modules: {} });

    expect(guard('organization')).toBe(true);
  });
});
