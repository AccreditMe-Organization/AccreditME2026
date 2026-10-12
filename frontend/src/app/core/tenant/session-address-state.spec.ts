import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import { LanguageService } from '../services/language.service';
import { authInterceptor } from '../interceptors/auth.interceptor';
import { TenantHostService } from './tenant-host';
import { SESSION_OTHER_ORGANIZATION, SessionAddressState, isOtherOrganizationRefusal } from './session-address-state';

// ACC-204 — a session that belongs to another organisation's address means
// "not signed in at this address".
const OTHER_ORG_BODY = {
  statusCode: 401,
  message: "This session belongs to another organization's address",
  error: 'Unauthorized',
  code: SESSION_OTHER_ORGANIZATION,
};
const UNAUTHORIZED = { status: 401, statusText: 'Unauthorized' };
const ME_URL = `${environment.apiUrl}/auth/me`;
const REFRESH_URL = `${environment.apiUrl}/auth/refresh`;

describe('SessionAddressState (ACC-204)', () => {
  it('recognises only the 401 with the SESSION_OTHER_ORGANIZATION code', () => {
    expect(isOtherOrganizationRefusal(new HttpErrorResponse({ ...UNAUTHORIZED, error: OTHER_ORG_BODY }))).toBe(true);
    expect(
      isOtherOrganizationRefusal(new HttpErrorResponse({ ...UNAUTHORIZED, error: { code: 'ORGANIZATION_UNAVAILABLE' } })),
    ).toBe(false);
    expect(isOtherOrganizationRefusal(new HttpErrorResponse({ ...UNAUTHORIZED, error: 'unauthorized' }))).toBe(false);
    expect(
      isOtherOrganizationRefusal(new HttpErrorResponse({ status: 403, statusText: 'Forbidden', error: OTHER_ORG_BODY })),
    ).toBe(false);
    expect(isOtherOrganizationRefusal(new Error('offline'))).toBe(false);
  });

  it('records the refusal, and forgets it on clear()', () => {
    const state = new SessionAddressState();
    expect(state.signedInElsewhere()).toBe(false);
    expect(state.note(new Error('offline'))).toBe(false);
    expect(state.signedInElsewhere()).toBe(false);
    expect(state.note(new HttpErrorResponse({ ...UNAUTHORIZED, error: OTHER_ORG_BODY }))).toBe(true);
    expect(state.signedInElsewhere()).toBe(true);
    state.clear();
    expect(state.signedInElsewhere()).toBe(false);
  });
});

describe('restoreSession() meeting another organisation’s session (ACC-204)', () => {
  let auth: AuthService;
  let httpMock: HttpTestingController;
  let state: SessionAddressState;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LanguageService, useValue: { use: () => of(null) } },
        { provide: TenantHostService, useValue: { slug: 'platform' } },
      ],
    });
    auth = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    state = TestBed.inject(SessionAddressState);
  });

  afterEach(() => httpMock.verify());

  it('stays on the page as signed out, without renewing, and records why', () => {
    let done = false;
    auth.restoreSession().subscribe({ complete: () => (done = true) });

    httpMock.expectOne(ME_URL).flush(OTHER_ORG_BODY, UNAUTHORIZED);
    // No renewal: it would be refused the same way. httpMock.verify() in
    // afterEach also fails on any request this did not expect.
    httpMock.expectNone(REFRESH_URL);

    expect(done).toBe(true); // restoreSession() never errors — ACC-24
    expect(auth.isAuthenticated()).toBe(false);
    expect(state.signedInElsewhere()).toBe(true);
  });

  it('records it too when it is the renewal that is refused with the code', () => {
    auth.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush('expired', UNAUTHORIZED);
    httpMock.expectOne(REFRESH_URL).flush(OTHER_ORG_BODY, UNAUTHORIZED);

    expect(auth.isAuthenticated()).toBe(false);
    expect(state.signedInElsewhere()).toBe(true);
  });

  it('a session at this address clears it', () => {
    auth.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush(OTHER_ORG_BODY, UNAUTHORIZED);
    expect(state.signedInElsewhere()).toBe(true);

    auth.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush({
      id: 'u-1',
      email: 'admin@example.test',
      name: 'Admin',
      language: 'en',
      timeZone: 'Asia/Riyadh',
      hijriDisplay: false,
      impersonatedBy: null,
    });
    expect(state.signedInElsewhere()).toBe(false);
  });
});

describe('the interceptor meeting another organisation’s session (ACC-204)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: { navigate: jasmine.Spy; url: string };
  let clearSession: jasmine.Spy;
  let state: SessionAddressState;

  beforeEach(() => {
    router = { navigate: jasmine.createSpy('navigate'), url: '/committees' };
    clearSession = jasmine.createSpy('clearSession');
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
        { provide: AuthService, useValue: { clearSession } },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    state = TestBed.inject(SessionAddressState);
  });

  afterEach(() => httpMock.verify());

  it('does not renew: it ends the session here, locally, and records why', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        httpMock.expectNone(REFRESH_URL);
        // Never /auth/logout: that would end the session the other address uses.
        httpMock.expectNone(`${environment.apiUrl}/auth/logout`);
        expect(clearSession).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledTimes(1);
        expect(router.navigate.calls.mostRecent().args[0]).toEqual(['/login']);
        expect(state.signedInElsewhere()).toBe(true);
        done();
      },
    });

    httpMock.expectOne(`${environment.apiUrl}/users`).flush(OTHER_ORG_BODY, UNAUTHORIZED);
  });

  it('leaves /auth/me to restoreSession(): no renewal and no redirect from here (ACC-24)', (done) => {
    http.get(ME_URL).subscribe({
      error: () => {
        httpMock.expectNone(REFRESH_URL);
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock.expectOne(ME_URL).flush(OTHER_ORG_BODY, UNAUTHORIZED);
  });
});
