// ACC-21 — proves the ORDERING guarantee initializeSession() exists to
// provide: platformAdminGuard reads NavigationAccessService.isPlatformAdmin()
// synchronously, so the app initializer must not resolve (and the router
// must not evaluate any guard) until BOTH restoreSession() and, when
// authenticated, loadAccess() have completed. A steady-state test (call it,
// flush everything, assert the end state) would not catch the original bug
// — the guard was only ever wrong for a narrow window *before* loadAccess()
// resolved. This test holds each request open deliberately and asserts on
// that window directly.
import { fakeAsync, tick, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { environment } from '../environments/environment';
import { initializeSession } from './app.config';
import { NavigationAccessService } from './core/services/navigation-access.service';

describe('initializeSession (ACC-21 — ordering guarantee)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        // NoOpLoader -- eliminates the translation-file HTTP request from
        // the picture entirely, so this test only has to reason about the
        // /auth/me -> /roles/my-permissions + /tenant ordering it exists to
        // prove, not LanguageService's own (already separately tested) chain.
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('does not request permissions, and does not resolve, until restoreSession() completes', fakeAsync(() => {
    let resolved = false;
    const promise = TestBed.runInInjectionContext(() => initializeSession());
    promise.then(() => {
      resolved = true;
    });

    // Only /auth/me should have gone out so far -- proves loadAccess() is
    // not attempted in parallel, closing the exact race ACC-21 fixes.
    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    httpMock.expectNone(`${environment.apiUrl}/roles/my-permissions`);
    httpMock.expectNone(`${environment.apiUrl}/tenant`);

    tick();
    expect(resolved).toBeFalse();

    meReq.flush({
      id: 'u1',
      email: 'admin@platform.accreditme.com',
      name: 'Platform Admin',
      language: 'en',
      impersonatedBy: null,
    });
    tick();

    // NOW the permission calls should have gone out -- but the initializer's
    // promise must still not have resolved while they're outstanding.
    const permsReq = httpMock.expectOne(`${environment.apiUrl}/roles/my-permissions`);
    const tenantReq = httpMock.expectOne(`${environment.apiUrl}/tenant`);
    expect(resolved).toBeFalse();

    permsReq.flush(['platform:admin']);
    tenantReq.flush({ isPlatformOrg: true, modules: {} });
    tick();

    expect(resolved).toBeTrue();

    const navigationAccessService = TestBed.inject(NavigationAccessService);
    expect(navigationAccessService.isPlatformAdmin()).toBeTrue();
  }));

  it('skips loadAccess() entirely when restoreSession() fails (anonymous / login-page case)', fakeAsync(() => {
    let resolved = false;
    const promise = TestBed.runInInjectionContext(() => initializeSession());
    promise.then(() => {
      resolved = true;
    });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    tick();

    expect(resolved).toBeTrue();
    httpMock.expectNone(`${environment.apiUrl}/roles/my-permissions`);
    httpMock.expectNone(`${environment.apiUrl}/tenant`);
  }));
});
