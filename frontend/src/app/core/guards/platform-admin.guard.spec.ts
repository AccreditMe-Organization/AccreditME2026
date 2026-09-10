import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { platformAdminGuard } from './platform-admin.guard';
import { NavigationAccessService } from '../services/navigation-access.service';
import { LANDING_ROUTE } from '../navigation/landing-route';

// ACC-70 — wired to the REAL service over mocked HTTP, because the behaviour
// under test is how the guard reacts to each combination of /roles/my-permissions
// and /tenant outcomes. A stubbed service would only restate the guard's own
// if-statements.
describe('platformAdminGuard', () => {
  let router: Router;
  let httpMock: HttpTestingController;
  let service: NavigationAccessService;

  const PERMISSIONS_URL = `${environment.apiUrl}/roles/my-permissions`;
  const TENANT_URL = `${environment.apiUrl}/tenant`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), NavigationAccessService],
    });
    router = TestBed.inject(Router);
    httpMock = TestBed.inject(HttpTestingController);
    service = TestBed.inject(NavigationAccessService);
  });

  afterEach(() => httpMock.verify());

  function guard(): boolean | UrlTree {
    return TestBed.runInInjectionContext(() =>
      platformAdminGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as boolean | UrlTree;
  }

  function load(permissions: string[], tenant: { ok: true; isPlatformOrg: boolean } | { ok: false; status: number }): void {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(permissions);
    const req = httpMock.expectOne(TENANT_URL);
    if (tenant.ok) req.flush({ isPlatformOrg: tenant.isPlatformOrg, modules: {} });
    else req.flush('err', { status: tenant.status, statusText: 'Error' });
  }

  it('allows a genuine platform admin', () => {
    load(['platform:admin'], { ok: true, isPlatformOrg: true });

    expect(guard()).toBe(true);
  });

  // The ACC-70 live-pass regression: a zero-permission user gets 403 on
  // /tenant, which is a REAL answer, so this must deny rather than fall open.
  it('DENIES a zero-permission user, whose /tenant call 403s', () => {
    load([], { ok: false, status: 403 });

    expect(guard()).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  it('denies a tenant admin who is not a platform admin', () => {
    load(['org:view', 'users:view'], { ok: true, isPlatformOrg: false });

    expect(guard()).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  // Mirrors PlatformGuard server-side: platform:admin alone is never enough.
  it('denies platform:admin held inside a non-platform org', () => {
    load(['platform:admin'], { ok: true, isPlatformOrg: false });

    expect(guard()).toEqual(router.parseUrl(LANDING_ROUTE));
  });

  // The live bug ACC-70 found and fixed: a transient fault is not an answer,
  // so a real platform admin must not be ejected mid-session.
  it('falls open when /tenant fails with a 5xx — the answer is unknown', () => {
    load(['platform:admin'], { ok: false, status: 503 });

    expect(guard()).toBe(true);
  });

  it('falls open when the permissions call itself fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush('err', { status: 500, statusText: 'Error' });
    httpMock.expectOne(TENANT_URL).flush({ isPlatformOrg: true, modules: {} });

    expect(guard()).toBe(true);
  });
});
