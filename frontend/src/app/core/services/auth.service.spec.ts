import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService, MeResponse } from './auth.service';
import { LanguageService } from './language.service';

// ACC-94 (D2) — the display context (tenant time zone, Hijri preference) that
// the formatting layer reads. The case that matters most is a FRESH LOGIN: its
// response carries no display context, so without the follow-up /auth/me a
// user would see dates in the default zone until their first reload.
describe('AuthService — display preferences (ACC-94)', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const ME_URL = `${environment.apiUrl}/auth/me`;
  const LOGIN_URL = `${environment.apiUrl}/auth/login`;

  const me = (overrides: Partial<MeResponse> = {}): MeResponse => ({
    id: 'user-1',
    email: 'a@example.com',
    name: 'A User',
    language: 'ar',
    timeZone: 'Asia/Dubai',
    hijriDisplay: true,
    impersonatedBy: null,
    ...overrides,
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: LanguageService, useValue: { use: () => of(null) } },
      ],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('is null before any session is known', () => {
    expect(service.displayPreferences()).toBeNull();
  });

  it('restoreSession() applies the time zone and calendar preference from /auth/me', () => {
    service.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush(me());

    expect(service.displayPreferences()).toEqual({ timeZone: 'Asia/Dubai', hijriDisplay: true });
  });

  it('a fresh login asks /auth/me once and applies its display context', () => {
    let finished = false;
    service.login('acme', 'a@example.com', 'pw').subscribe(() => (finished = true));

    httpMock.expectOne(LOGIN_URL).flush({ success: true, user: { id: 'user-1', email: 'a@example.com', name: 'A User' }, language: 'ar' });
    expect(finished).toBe(false);
    httpMock.expectOne(ME_URL).flush(me({ timeZone: 'America/New_York', hijriDisplay: false }));

    expect(finished).toBe(true);
    expect(service.currentUser()?.id).toBe('user-1');
    expect(service.displayPreferences()).toEqual({ timeZone: 'America/New_York', hijriDisplay: false });
  });

  it('a failed /auth/me after a successful login does not fail the login', () => {
    let result: unknown;
    service.login('acme', 'a@example.com', 'pw').subscribe((r) => (result = r));

    httpMock.expectOne(LOGIN_URL).flush({ success: true, user: { id: 'user-1', email: 'a@example.com', name: 'A User' }, language: 'en' });
    httpMock.expectOne(ME_URL).flush('boom', { status: 500, statusText: 'Server Error' });

    expect(result).toEqual(jasmine.objectContaining({ success: true }));
    expect(service.isAuthenticated()).toBe(true);
    expect(service.displayPreferences()).toBeNull();
  });

  it('an MFA challenge does not ask /auth/me (there is no session yet)', () => {
    service.login('acme', 'a@example.com', 'pw').subscribe();
    httpMock.expectOne(LOGIN_URL).flush({ mfaRequired: true });
    httpMock.expectNone(ME_URL);
    expect(service.displayPreferences()).toBeNull();
  });

  it('clearSession() and a failed restore both drop the preferences', () => {
    service.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush(me());
    service.clearSession();
    expect(service.displayPreferences()).toBeNull();

    service.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush(me());
    service.restoreSession().subscribe();
    httpMock.expectOne(ME_URL).flush('unauthorized', { status: 401, statusText: 'Unauthorized' });
    expect(service.displayPreferences()).toBeNull();
  });
});
