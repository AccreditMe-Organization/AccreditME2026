import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import { NavigationAccessService } from './navigation-access.service';

// ACC-70 — these cover the distinction the service could not previously
// express: a FAILED load and a genuinely empty permission set both leave the
// signals empty, and before this every consumer read them identically. Route
// guards make that difference load-bearing, so it is asserted directly rather
// than inferred from downstream guard behaviour.
describe('NavigationAccessService', () => {
  let service: NavigationAccessService;
  let httpMock: HttpTestingController;

  const PERMISSIONS_URL = `${environment.apiUrl}/roles/my-permissions`;
  const TENANT_URL = `${environment.apiUrl}/tenant`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), NavigationAccessService],
    });
    service = TestBed.inject(NavigationAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  // ignoreCancelled — loadAccess() uses forkJoin, which errors on the FIRST
  // failure and cancels its sibling request. So when the permissions call
  // fails, the tenant call is left cancelled and un-flushed by design; that
  // is the production behaviour, not a gap in these tests.
  afterEach(() => httpMock.verify({ ignoreCancelled: true }));

  function flush(permissions: string[], modules: Record<string, boolean> = {}, isPlatformOrg = false): void {
    httpMock.expectOne(PERMISSIONS_URL).flush(permissions);
    httpMock.expectOne(TENANT_URL).flush({ isPlatformOrg, modules });
  }

  // Fails the permissions call. Since ACC-70's split the two requests recover
  // independently, so the tenant request is NOT cancelled — it still needs
  // answering, or it stays queued and a later loadAccess() in the same test
  // sees two matching tenant requests.
  function failPermissions(): void {
    httpMock.expectOne(PERMISSIONS_URL).flush('boom', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(TENANT_URL).flush({ isPlatformOrg: false, modules: {} });
  }

  it('starts PENDING, before anything has been loaded', () => {
    expect(service.loadState()).toBe('PENDING');
    expect(service.hasTrustworthyPermissions()).toBe(false);
  });

  it('records LOADED and the permissions on success', () => {
    service.loadAccess().subscribe();
    flush(['org:view', 'tasks:view']);

    expect(service.loadState()).toBe('LOADED');
    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(true);
    expect(service.hasPermission('users:view')).toBe(false);
  });

  // The case the whole change exists for: an empty array is a real answer.
  it('treats a genuinely empty permission set as LOADED, not as a failure', () => {
    service.loadAccess().subscribe();
    flush([]);

    expect(service.loadState()).toBe('LOADED');
    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(false);
  });

  it('records FAILED when the permissions request errors', () => {
    service.loadAccess().subscribe();
    failPermissions();

    expect(service.loadState()).toBe('FAILED');
    expect(service.hasTrustworthyPermissions()).toBe(false);
  });

  // ACC-70 live pass, check 2 — the regression this split exists for.
  //
  // GET /tenant requires tenant:view, so a user holding NO permissions gets a
  // correct `[]` from the ungated permissions call and a 403 from /tenant.
  // While both shared one outer catchError, forkJoin collapsed and threw the
  // good answer away, leaving loadState FAILED — which made permissionGuard
  // take its fail-open branch and let that user into every guarded route.
  it('keeps permissions trustworthy when /tenant 403s — the zero-permission case', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush([]);
    httpMock.expectOne(TENANT_URL).flush('forbidden', { status: 403, statusText: 'Forbidden' });

    // The permissions answer is known and empty. That is a real answer, and
    // the guards must be able to act on it.
    expect(service.loadState()).toBe('LOADED');
    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(false);
  });

  it('keeps a NON-empty permissions answer when /tenant fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(['org:view', 'users:view']);
    httpMock.expectOne(TENANT_URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(true);
  });

  // The two calls no longer cancel each other, so a permissions failure leaves
  // the tenant answer intact too.
  it('keeps the tenant answer when the permissions request fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush('boom', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(TENANT_URL).flush({ isPlatformOrg: true, modules: { documents: true } });

    expect(service.loadState()).toBe('FAILED');
    expect(service.isModuleEnabled('documents')).toBe(true);
  });

  it('clears tenant-derived state when /tenant fails, without touching loadState', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(['platform:admin']);
    httpMock.expectOne(TENANT_URL).flush('forbidden', { status: 403, statusText: 'Forbidden' });

    expect(service.loadState()).toBe('LOADED');
    expect(service.isModuleEnabled('documents')).toBe(false);
    expect(service.isPlatformAdmin()).toBe(false);
  });

  // Every existing caller — provideAppInitializer and AppShellComponent —
  // depends on this completing rather than erroring. A rejected initializer
  // would stop the app bootstrapping at all.
  it('still completes successfully on failure, rather than propagating the error', () => {
    let completed = false;
    let errored = false;
    service.loadAccess().subscribe({ complete: () => (completed = true), error: () => (errored = true) });
    failPermissions();

    expect(completed).toBe(true);
    expect(errored).toBe(false);
  });

  it('recovers to LOADED when a later load succeeds after a failure', () => {
    service.loadAccess().subscribe();
    failPermissions();
    expect(service.loadState()).toBe('FAILED');

    service.loadAccess().subscribe();
    flush(['org:view']);

    expect(service.loadState()).toBe('LOADED');
    expect(service.hasPermission('org:view')).toBe(true);
  });

  it('does not report platform-admin on a failed load, but reports the load as untrustworthy', () => {
    service.loadAccess().subscribe();
    failPermissions();

    // isPlatformAdmin() is still false — the fix is not to make it lie, it is
    // to let the guard know the answer is unknown rather than negative.
    expect(service.isPlatformAdmin()).toBe(false);
    expect(service.hasTrustworthyPermissions()).toBe(false);
  });
});
