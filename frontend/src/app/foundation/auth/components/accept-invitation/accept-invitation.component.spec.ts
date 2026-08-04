// ACC-25 — proves the error handler surfaces the backend's real message
// when one is provided, and falls back to the generic translated key only
// when it isn't. Uses the real AuthService (a thin HttpClient wrapper) with
// HttpClientTesting rather than mocking it, so this exercises the same
// request/response shape the real backend sends.
import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { AcceptInvitationComponent } from './accept-invitation.component';

describe('AcceptInvitationComponent (ACC-25)', () => {
  let fixture: ComponentFixture<AcceptInvitationComponent>;
  let component: AcceptInvitationComponent;
  let httpMock: HttpTestingController;

  function setup(token: string | null): void {
    TestBed.configureTestingModule({
      imports: [AcceptInvitationComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AcceptInvitationComponent);
    component = fixture.componentInstance;
  }

  afterEach(() => {
    httpMock.verify();
  });

  it("displays the backend's real error message when one is provided", () => {
    setup('real-token');
    component.form.setValue({ password: 'password123' });

    component.onSubmit();

    httpMock
      .expectOne(`${environment.apiUrl}/auth/accept-invitation`)
      .flush(
        { statusCode: 400, message: 'The password you entered has been compromised. Please choose a different password.' },
        { status: 400, statusText: 'Bad Request' },
      );

    expect(component.error()).toBe(
      'The password you entered has been compromised. Please choose a different password.',
    );
  });

  it('falls back to the generic translated key when the backend sends no message', () => {
    setup('real-token');
    component.form.setValue({ password: 'password123' });

    component.onSubmit();

    httpMock
      .expectOne(`${environment.apiUrl}/auth/accept-invitation`)
      .flush(null, { status: 0, statusText: 'Unknown Error' });

    expect(component.error()).toBe('auth.errorInvalidInvitation');
  });
});
