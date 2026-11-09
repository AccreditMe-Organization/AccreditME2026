import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { environment } from '../../../environments/environment';
import { platformHomeRedirectGuard } from './platform-home-redirect.guard';
import { NavigationAccessService } from '../services/navigation-access.service';
import { PLATFORM_LANDING } from '../navigation/landing-route';

// ACC-120 — /home sends a platform admin to the platform's landing, and lets
// everyone else through. Wired to the REAL service over mocked HTTP, as
// platformAdminGuard's spec is: what is under test is the guard's reading of
// each combination of /roles/my-permissions and /tenant/entitlements answers.
describe('platformHomeRedirectGuard', () => {
  let router: Router;
  let httpMock: HttpTestingController;
  let service: NavigationAccessService;

  const PERMISSIONS_URL = `${environment.apiUrl}/roles/my-permissions`;
  const TENANT_URL = `${environment.apiUrl}/tenant/entitlements`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        NavigationAccessService,
      ],
    });
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NavigationAccessService);
  });

  afterEach(() => httpMock.verify());

  function guard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      platformHomeRedirectGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  function load(permissions: string[], tenant: { ok: true; isPlatformOrg: boolean } | { ok: false; status: number }): void {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(permissions);
    const req = httpMock.expectOne(TENANT_URL);
    if (tenant.ok) req.flush({ name: 'Org Alpha', slug: 'alpha', isPlatformOrg: tenant.isPlatformOrg, modules: {} });
    else req.flush('err', { status: tenant.status, statusText: 'Error' });
  }

  it('sends a platform admin to the platform landing', () => {
    load(['platform:admin'], { ok: true, isPlatformOrg: true });

    expect(guard()).toEqual(router.parseUrl(PLATFORM_LANDING));
  });

  // ACC-70: /home is where a user with no permissions at all is sent.
  it('lets a tenant user holding no permissions through', () => {
    load([], { ok: true, isPlatformOrg: false });

    expect(guard()).toBe(true);
  });

  // An impersonation session is the tenant's session: its entitlements are
  // the tenant's (isPlatformOrg false), so isPlatformAdmin() is false and the
  // platform admin lands on the tenant's Home, as the user they act as would.
  it('lets an impersonation session through to /home', () => {
    load(['tenant:manage_config', 'org:view', 'users:view'], { ok: true, isPlatformOrg: false });

    expect(service.isPlatformAdmin()).toBe(false);
    expect(guard()).toBe(true);
  });

  // platform:admin held inside a tenant is not a platform admin.
  it('lets platform:admin held inside a tenant through', () => {
    load(['platform:admin'], { ok: true, isPlatformOrg: false });

    expect(guard()).toBe(true);
  });

  it('falls open when the tenant call fails with a 5xx — the answer is unknown', () => {
    load(['platform:admin'], { ok: false, status: 503 });

    expect(guard()).toBe(true);
  });

  it('falls open when the permissions call fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush('err', { status: 500, statusText: 'Error' });
    httpMock.expectOne(TENANT_URL).flush({ name: 'Platform', slug: 'platform', isPlatformOrg: true, modules: {} });

    expect(guard()).toBe(true);
  });

  it('falls open before access has loaded at all', () => {
    expect(guard()).toBe(true);
  });
});
