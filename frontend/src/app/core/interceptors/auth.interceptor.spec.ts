// ACC-24 — regression coverage for both sides of the fix: the interceptor
// must NOT redirect on the one call site (GET .../auth/me) where a 401 is
// the expected "not logged in" outcome already handled by
// AuthService.restoreSession() itself, but MUST still redirect on a 401
// from any other (protected) endpoint — proving the exclusion is narrow,
// not a general loosening of the interceptor's real purpose.
import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { authInterceptor } from './auth.interceptor';

describe('authInterceptor (ACC-24)', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let router: { navigate: jasmine.Spy };

  beforeEach(() => {
    router = { navigate: jasmine.createSpy('navigate') };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: router },
      ],
    });

    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('does NOT redirect to /login on a 401 from GET .../auth/me', (done) => {
    http.get(`${environment.apiUrl}/auth/me`).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/auth/me`)
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  });

  it('still redirects to /login on a 401 from a different (protected) endpoint', (done) => {
    http.get(`${environment.apiUrl}/users`).subscribe({
      error: () => {
        expect(router.navigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/users`)
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  });

  it('does not redirect on a non-401 error from GET .../auth/me (unrelated failure mode)', (done) => {
    http.get(`${environment.apiUrl}/auth/me`).subscribe({
      error: () => {
        expect(router.navigate).not.toHaveBeenCalled();
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/auth/me`)
      .flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });
  });

  it('does not redirect on a 401 from a URL that merely contains "me" but is not the session-restore endpoint', (done) => {
    http.get(`${environment.apiUrl}/committees/me-fake-id`).subscribe({
      error: () => {
        // Guards against a naive substring match (e.g. .includes('me'))
        // that would over-exclude — only the exact /auth/me suffix should
        // be treated as the session-restore check.
        expect(router.navigate).toHaveBeenCalledWith(['/login']);
        done();
      },
    });

    httpMock
      .expectOne(`${environment.apiUrl}/committees/me-fake-id`)
      .flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  });
});
