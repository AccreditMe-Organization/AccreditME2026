// ACC-24 — full integration proof, not just the interceptor in isolation:
// an unauthenticated visitor navigating straight to /accept-invitation must
// actually see that route's component, not get silently bounced to /login
// by the APP_INITIALIZER's own GET .../auth/me 401 (see auth.interceptor.ts
// and app.config.ts's initializeSession() for the full mechanism this
// reproduces end-to-end).
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { initializeSession } from './app.config';
import { AcceptInvitationComponent } from './foundation/auth/components/accept-invitation/accept-invitation.component';

describe('unauthenticated navigation to a pre-auth route (ACC-24)', () => {
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('renders AcceptInvitationComponent instead of redirecting to /login when the session-restore check 401s', async () => {
    // Mirrors what a real unauthenticated app boot does: initializeSession()
    // fires GET /auth/me before the router's initial navigation settles.
    // Not awaited yet — the request must be flushed while it's in flight.
    const initPromise = TestBed.runInInjectionContext(() => initializeSession());
    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await initPromise;

    const harness = await RouterTestingHarness.create('/accept-invitation?token=abc123');

    expect(TestBed.inject(Router).url).toContain('/accept-invitation');
    expect(harness.routeDebugElement?.componentInstance).toBeInstanceOf(AcceptInvitationComponent);
  });
});
