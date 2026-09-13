import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { environment } from '../../../environments/environment';
import {
  ModuleAccessLevel,
  NavigationAccessService,
} from './navigation-access.service';

// ACC-70 — these cover the distinction the service could not previously
// express: a FAILED load and a genuinely empty permission set both leave the
// signals empty, and before this every consumer read them identically. Route
// guards make that difference load-bearing, so it is asserted directly rather
// than inferred from downstream guard behaviour.
describe('NavigationAccessService', () => {
  let service: NavigationAccessService;
  let httpMock: HttpTestingController;

  const PERMISSIONS_URL = `${environment.apiUrl}/roles/my-permissions`;
  // ACC-79 — the tenant half reads the ungated entitlements endpoint, not
  // GET /tenant. A test flushing GET /tenant here would pass against the old
  // wiring and prove nothing about the new one.
  const TENANT_URL = `${environment.apiUrl}/tenant/entitlements`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        NavigationAccessService,
      ],
    });
    service = TestBed.inject(NavigationAccessService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  // ignoreCancelled — loadAccess() uses forkJoin, which errors on the FIRST
  // failure and cancels its sibling request. So when the permissions call
  // fails, the tenant call is left cancelled and un-flushed by design; that
  // is the production behaviour, not a gap in these tests.
  afterEach(() => httpMock.verify({ ignoreCancelled: true }));

  function flush(
    permissions: string[],
    modules: Record<string, ModuleAccessLevel> = {},
    isPlatformOrg = false,
  ): void {
    httpMock.expectOne(PERMISSIONS_URL).flush(permissions);
    httpMock
      .expectOne(TENANT_URL)
      .flush({ name: 'Org Alpha', slug: 'alpha', isPlatformOrg, modules });
  }

  // Fails the permissions call. Since ACC-70's split the two requests recover
  // independently, so the tenant request is NOT cancelled — it still needs
  // answering, or it stays queued and a later loadAccess() in the same test
  // sees two matching tenant requests.
  function failPermissions(): void {
    httpMock
      .expectOne(PERMISSIONS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(TENANT_URL).flush({
      name: 'Org Alpha',
      slug: 'alpha',
      isPlatformOrg: false,
      modules: {},
    });
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

  // ── ACC-79: the bug this commit exists for ──────────────────────────────
  //
  // Before ACC-79 the tenant half was GET /tenant, gated on tenant:view, which
  // only TENANT_ADMIN holds. Every other role got a 403, `modules` was left
  // empty, and isModuleEnabled() answered false for every module. A Quality
  // Officer would have seen none of their quality modules in the restructured
  // rail. This asserts the fixed behaviour for precisely that user.
  it('gives a user holding NO tenant permissions their modules', () => {
    service.loadAccess().subscribe();
    flush([], { documents: 'FULL', standards: 'READ_ONLY' });

    expect(service.isModuleEnabled('documents')).toBe(true);
    expect(service.isModuleEnabled('standards')).toBe(true);
    expect(service.hasTrustworthyTenantAccess()).toBe(true);
  });

  // The zero-permission user used to be denied /platform because /tenant
  // 403'd. That inference is gone — the endpoint no longer 403s — so the
  // denial must now come from a real isPlatformOrg: false. If this regressed,
  // a zero-permission user would pass platformAdminGuard.
  it('still denies platform admin to a zero-permission user, from a real answer rather than a 403', () => {
    service.loadAccess().subscribe();
    flush([], {}, false);

    expect(service.hasTrustworthyTenantAccess()).toBe(true);
    expect(service.isPlatformAdmin()).toBe(false);
  });

  it('distinguishes read-only from full access', () => {
    service.loadAccess().subscribe();
    flush([], { documents: 'FULL', standards: 'READ_ONLY' });

    expect(service.moduleAccess('documents')).toBe('FULL');
    expect(service.moduleAccess('standards')).toBe('READ_ONLY');
    expect(service.canWriteModule('documents')).toBe(true);
    // Readable, present in the rail — and no write affordances.
    expect(service.canWriteModule('standards')).toBe(false);
  });

  // Not built, not licensed and switched off all arrive as an absent key, and
  // the service must not invent a distinction the backend deliberately hides.
  it('answers null for a module the tenant cannot use, for whatever reason', () => {
    service.loadAccess().subscribe();
    flush([], { documents: 'FULL' });

    expect(service.moduleAccess('audits')).toBeNull();
    expect(service.isModuleEnabled('audits')).toBe(false);
    expect(service.canWriteModule('audits')).toBe(false);
  });

  it('exposes the tenant name for tab titles', () => {
    service.loadAccess().subscribe();
    flush([]);

    expect(service.tenantName()).toBe('Org Alpha');
  });

  // ACC-70 live pass, check 2. Both calls are ungated since ACC-79, so this
  // exact zero-permission 403 no longer happens in normal use. The split is
  // still what stops a fault on the tenant call discarding a good permissions
  // answer — which would make permissionGuard fail open — so the case is kept.
  it('keeps permissions trustworthy when the tenant call 403s', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush([]);
    httpMock
      .expectOne(TENANT_URL)
      .flush('forbidden', { status: 403, statusText: 'Forbidden' });

    // The permissions answer is known and empty. That is a real answer, and
    // the guards must be able to act on it.
    expect(service.loadState()).toBe('LOADED');
    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(false);
  });

  it('keeps a NON-empty permissions answer when /tenant fails', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(['org:view', 'users:view']);
    httpMock
      .expectOne(TENANT_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });

    expect(service.hasTrustworthyPermissions()).toBe(true);
    expect(service.hasPermission('org:view')).toBe(true);
  });

  // The two calls no longer cancel each other, so a permissions failure leaves
  // the tenant answer intact too.
  it('keeps the tenant answer when the permissions request fails', () => {
    service.loadAccess().subscribe();
    httpMock
      .expectOne(PERMISSIONS_URL)
      .flush('boom', { status: 500, statusText: 'Server Error' });
    httpMock.expectOne(TENANT_URL).flush({
      name: 'Org Alpha',
      slug: 'alpha',
      isPlatformOrg: true,
      modules: { documents: 'FULL' },
    });

    expect(service.loadState()).toBe('FAILED');
    expect(service.isModuleEnabled('documents')).toBe(true);
  });

  // A 403 from an endpoint requiring no permission is anomalous — something is
  // wrong with this user's tenant context. It is still treated as a real
  // "not a platform admin", because for a guard protecting /platform, denying
  // on an anomaly is the safe direction.
  it('clears tenant-derived state on a tenant-call 403 and treats it as a denial', () => {
    service.loadAccess().subscribe();
    httpMock.expectOne(PERMISSIONS_URL).flush(['platform:admin']);
    httpMock
      .expectOne(TENANT_URL)
      .flush('forbidden', { status: 403, statusText: 'Forbidden' });

    expect(service.loadState()).toBe('LOADED');
    expect(service.isModuleEnabled('documents')).toBe(false);
    expect(service.isPlatformAdmin()).toBe(false);
    expect(service.tenantName()).toBe('');
    expect(service.hasTrustworthyTenantAccess()).toBe(true);
  });

  // Every existing caller — provideAppInitializer and AppShellComponent —
  // depends on this completing rather than erroring. A rejected initializer
  // would stop the app bootstrapping at all.
  it('still completes successfully on failure, rather than propagating the error', () => {
    let completed = false;
    let errored = false;
    service
      .loadAccess()
      .subscribe({
        complete: () => (completed = true),
        error: () => (errored = true),
      });
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
