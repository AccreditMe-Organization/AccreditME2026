// ACC-120 slice 9e — the Accept invitation screen.
//
// The real AuthService (a thin HttpClient wrapper) with HttpClientTesting, so
// the requests and refusal bodies are the shapes the backend really sends:
// the lookup's and accept's INVITATION_INVALID, accept's password codes (from
// password-refusal.ts) and its 409.
import { ComponentFixture, TestBed, fakeAsync, tick, discardPeriodicTasks } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { of } from 'rxjs';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { REQUEST_TIMEOUT_MS, SKELETON_DELAY_MS } from '../../../../core/request-outcome/request-outcome';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import {
  AcceptInvitationComponent,
  INVITATION_ACCEPTED_NOTICE,
} from './accept-invitation.component';

const TOKEN = 'f'.repeat(48);
const LOOKUP_URL = `${environment.apiUrl}/auth/invitations/lookup`;
const ACCEPT_URL = `${environment.apiUrl}/auth/accept-invitation`;

const INVITATION_INVALID = {
  statusCode: 400,
  message: 'Invalid or expired invitation',
  error: 'Bad Request',
  code: 'INVITATION_INVALID',
};
const passwordRefusal = (code: string, statusCode = 400) => ({
  statusCode,
  message: 'refused',
  error: statusCode === 400 ? 'Bad Request' : 'Service Unavailable',
  code,
});

describe('AcceptInvitationComponent (ACC-120 slice 9e)', () => {
  let fixture: ComponentFixture<AcceptInvitationComponent>;
  let httpMock: HttpTestingController;
  let navigate: jasmine.Spy;
  let replaceState: jasmine.Spy;
  let arabic: boolean;

  function setup(opts: { token?: string | null; arabic?: boolean } = {}): void {
    const token = opts.token === undefined ? TOKEN : opts.token;
    arabic = opts.arabic ?? false;
    navigate = jasmine.createSpy('navigate').and.resolveTo(true);
    replaceState = jasmine.createSpy('replaceState');

    TestBed.configureTestingModule({
      imports: [AcceptInvitationComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: Router, useValue: { navigate } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
        {
          provide: Location,
          useValue: {
            path: () => (token ? `/accept-invitation?token=${token}` : '/accept-invitation'),
            replaceState,
          },
        },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            bilingual: (en: string, ar: string | null) => pickBilingualName(en, ar, arabic),
            use: () => of(null),
          },
        },
        // The layout opens in the current language, so it never switches here.
        { provide: SignInLanguageService, useValue: { initial: () => (arabic ? 'ar' : 'en'), remember: () => {} } },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AcceptInvitationComponent);
    // In the document, so focus can be asserted.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  const el = (): HTMLElement => fixture.nativeElement;
  const h1 = (): string => el().querySelector('h1')?.textContent?.trim() ?? '';
  const form = (): HTMLFormElement | null => el().querySelector('form');
  const fieldMessage = (): string => el().querySelector('.am-field__message')?.textContent?.trim() ?? '';
  const pageMessage = (): string => el().querySelector('p-message')?.textContent?.trim() ?? '';
  const password = () => fixture.componentInstance.form.controls.password;

  function answerLookup(org = { name: 'Al Nakheel Hospital', nameAr: 'مستشفى النخيل' }): void {
    httpMock.expectOne(LOOKUP_URL).flush(org);
    fixture.detectChanges();
  }

  function submit(value: string): void {
    password().setValue(value);
    form()!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function refuseAccept(body: object | null, status: number, statusText = 'Error'): TestRequest {
    const req = httpMock.expectOne(ACCEPT_URL);
    req.flush(body, { status, statusText });
    fixture.detectChanges();
    return req;
  }

  afterEach(() => {
    httpMock.verify();
    fixture.nativeElement.remove();
  });

  describe('the token', () => {
    it('is taken out of the address bar, and sent from memory to the lookup and to accept', () => {
      setup();

      expect(replaceState).toHaveBeenCalledOnceWith('/accept-invitation');
      const lookup = httpMock.expectOne(LOOKUP_URL);
      expect(lookup.request.body).toEqual({ token: TOKEN });
      lookup.flush({ name: 'Al Nakheel Hospital', nameAr: null });
      fixture.detectChanges();

      submit('a long enough password');
      const accept = httpMock.expectOne(ACCEPT_URL);
      expect(accept.request.body).toEqual({ token: TOKEN, password: 'a long enough password' });
      accept.flush(null);
    });

    it('when missing, shows the invalid state at once — no request, no form', () => {
      setup({ token: null });

      httpMock.expectNone(LOOKUP_URL);
      expect(replaceState).not.toHaveBeenCalled();
      expect(form()).toBeNull();
      expect(h1()).toBe('auth.invitation.invalidTitle');
    });
  });

  describe('while the lookup runs', () => {
    it('shows no form, and a skeleton only after 200ms', fakeAsync(() => {
      setup();
      expect(form()).toBeNull();

      // Just short of the delay: still nothing, so a fast answer never flashes one.
      tick(SKELETON_DELAY_MS - 1);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="lookup-skeleton"]')).toBeNull();

      tick(1);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="lookup-skeleton"]')).not.toBeNull();
      expect(form()).toBeNull();

      answerLookup();
      expect(el().querySelector('[data-testid="lookup-skeleton"]')).toBeNull();
      expect(form()).not.toBeNull();
      discardPeriodicTasks();
    }));

    it('says so after 8 seconds, and Retry asks again', fakeAsync(() => {
      setup();
      const first = httpMock.expectOne(LOOKUP_URL);

      tick(REQUEST_TIMEOUT_MS - 1);
      fixture.detectChanges();
      expect(el().textContent).not.toContain('auth.invitation.slow');

      tick(1);
      fixture.detectChanges();
      expect(el().textContent).toContain('auth.invitation.slow');

      (el().querySelector('p-button button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(first.cancelled).toBeTrue();
      answerLookup();
      expect(form()).not.toBeNull();
      discardPeriodicTasks();
    }));

    it('a rate-limited lookup says so and offers Retry, not the invalid state (ACC-129)', () => {
      setup();
      httpMock.expectOne(LOOKUP_URL).flush(
        { statusCode: 429, message: 'Too many requests. Try again later.', error: 'Too Many Requests', code: 'RATE_LIMITED', retryAfterSeconds: 42 },
        { status: 429, statusText: 'Too Many Requests' },
      );
      fixture.detectChanges();

      expect(form()).toBeNull();
      expect(h1()).not.toBe('auth.invitation.invalidTitle');
      expect(pageMessage()).toBe('auth.invitation.errorRateLimited');

      (el().querySelector('p-button button') as HTMLButtonElement).click();
      fixture.detectChanges();
      answerLookup();
      expect(form()).not.toBeNull();
    });

    it('a lookup that fails for another reason offers Retry, not the invalid state', () => {
      setup();
      httpMock.expectOne(LOOKUP_URL).flush(null, { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();

      expect(form()).toBeNull();
      expect(pageMessage()).toBe('auth.invitation.lookupFailed');

      (el().querySelector('p-button button') as HTMLButtonElement).click();
      fixture.detectChanges();
      answerLookup();
      expect(form()).not.toBeNull();
    });
  });

  describe('INVITATION_INVALID', () => {
    it('from the lookup: one state, no form', () => {
      setup();
      httpMock.expectOne(LOOKUP_URL).flush(INVITATION_INVALID, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(form()).toBeNull();
      expect(h1()).toBe('auth.invitation.invalidTitle');
      expect(el().textContent).toContain('auth.invitation.invalidBody');
    });

    it('from accept: the same state, and the form is gone', () => {
      setup();
      answerLookup();
      submit('a long enough password');
      refuseAccept(INVITATION_INVALID, 400);

      expect(form()).toBeNull();
      expect(h1()).toBe('auth.invitation.invalidTitle');
    });
  });

  describe('the organisation', () => {
    it('is named in the heading, in English', () => {
      setup();
      answerLookup();
      expect(h1()).toBe('auth.invitation.join');
      expect(fixture.componentInstance['organizationName']()).toBe('\u2068Al Nakheel Hospital\u2069');
    });

    it('is named in Arabic in an Arabic session', () => {
      setup({ arabic: true });
      answerLookup();
      expect(fixture.componentInstance['organizationName']()).toBe('\u2068مستشفى النخيل\u2069');
    });

    it('falls back to the English name in Arabic when there is no Arabic name', () => {
      setup({ arabic: true });
      answerLookup({ name: 'Al Nakheel Hospital', nameAr: null as unknown as string });
      expect(fixture.componentInstance['organizationName']()).toBe('\u2068Al Nakheel Hospital\u2069');
    });
  });

  describe('accepting', () => {
    beforeEach(() => {
      setup();
      answerLookup();
    });

    it('on success goes to sign-in, with the one-time notice', () => {
      submit('a long enough password');
      httpMock.expectOne(ACCEPT_URL).flush(null);

      expect(navigate).toHaveBeenCalledOnceWith(['/login'], {
        state: { notice: INVITATION_ACCEPTED_NOTICE },
      });
    });

    it('refuses a password under 8 or over 128 characters without asking the server', () => {
      submit('seven77');
      expect(fieldMessage()).toBe('auth.invitation.passwordTooShort');

      submit('x'.repeat(129));
      expect(fieldMessage()).toBe('auth.invitation.passwordTooLong');

      httpMock.expectNone(ACCEPT_URL);
    });

    it('an invalid submit moves focus to the password field', () => {
      const input = el().querySelector<HTMLInputElement>('#password')!;
      // Non-vacuity guard: the field is in the page and not already focused.
      expect(input).not.toBeNull();
      expect(document.activeElement).not.toBe(input);

      submit('');
      expect(document.activeElement).toBe(input);
      httpMock.expectNone(ACCEPT_URL);
    });

    it('a password the server refuses moves focus to the field too', () => {
      submit('password123');
      (el().querySelector('.am-password__toggle') as HTMLElement).focus();
      refuseAccept(passwordRefusal('PASSWORD_COMPROMISED'), 400);
      expect(document.activeElement).toBe(el().querySelector('#password'));
    });

    it('the password field has a show/hide button', () => {
      const toggle = el().querySelector('.am-password__toggle')!;
      expect(toggle.tagName).toBe('BUTTON');
      expect(toggle.getAttribute('aria-label')).toBe('common.showPassword');
    });

    it('accepts exactly 8 and exactly 128 characters', () => {
      submit('x'.repeat(8));
      httpMock.expectOne(ACCEPT_URL).flush(null, { status: 0, statusText: 'Unknown Error' });
      fixture.detectChanges();
      submit('x'.repeat(128));
      httpMock.expectOne(ACCEPT_URL).flush(null);
    });

    it('PASSWORD_COMPROMISED goes on the field, and the password stays', () => {
      submit('password123');
      refuseAccept(passwordRefusal('PASSWORD_COMPROMISED'), 400);

      expect(fieldMessage()).toBe('auth.invitation.passwordCompromised');
      expect(password().value).toBe('password123');
      expect(pageMessage()).toBe('');
    });

    it('a new keystroke clears the breach error, so the next password can be tried', () => {
      submit('password123');
      refuseAccept(passwordRefusal('PASSWORD_COMPROMISED'), 400);
      password().setValue('a different long password');
      fixture.detectChanges();
      expect(password().errors).toBeNull();
    });

    it('PASSWORD_TOO_SHORT and PASSWORD_TOO_LONG go on the field', () => {
      submit('a long enough password');
      refuseAccept(passwordRefusal('PASSWORD_TOO_SHORT'), 400);
      expect(fieldMessage()).toBe('auth.invitation.passwordTooShort');

      submit('a long enough password');
      refuseAccept(passwordRefusal('PASSWORD_TOO_LONG'), 400);
      expect(fieldMessage()).toBe('auth.invitation.passwordTooLong');
    });

    it('PASSWORD_CHECK_UNAVAILABLE is a message to try again, with the form kept', () => {
      submit('a long enough password');
      refuseAccept(passwordRefusal('PASSWORD_CHECK_UNAVAILABLE', 503), 503);

      expect(pageMessage()).toBe('auth.invitation.errorCheckUnavailable');
      expect(form()).not.toBeNull();
      expect(password().value).toBe('a long enough password');
      expect(password().errors).toBeNull();
    });

    it('RATE_LIMITED is a wait-and-retry message, with the form kept (ACC-129)', () => {
      submit('a long enough password');
      refuseAccept(
        { statusCode: 429, message: 'Too many requests. Try again later.', error: 'Too Many Requests', code: 'RATE_LIMITED', retryAfterSeconds: 42 },
        429,
      );
      expect(pageMessage()).toBe('auth.invitation.errorRateLimited');
      expect(form()).not.toBeNull();
      expect(password().value).toBe('a long enough password');
      expect(password().errors).toBeNull();
    });

    it('a 409 position conflict gets its own plain message', () => {
      submit('a long enough password');
      refuseAccept(
        {
          statusCode: 409,
          message: 'This position is no longer available in this org unit — contact your administrator',
          error: 'Conflict',
        },
        409,
      );
      expect(pageMessage()).toBe('auth.invitation.errorConflict');
      expect(password().value).toBe('a long enough password');
    });

    it('a 500, an uncoded 400 or no connection: the generic message, form kept', () => {
      for (const [body, status] of [
        [{ statusCode: 500, message: 'Internal server error' }, 500],
        [{ statusCode: 400, message: 'User already exists. Use another email.' }, 400],
        [null, 0],
      ] as const) {
        submit('a long enough password');
        refuseAccept(body, status);
        expect(pageMessage()).toBe('auth.invitation.errorGeneric');
        expect(form()).not.toBeNull();
        expect(password().value).toBe('a long enough password');
      }
    });

    it('never shows the backend\'s own wording', () => {
      submit('a long enough password');
      refuseAccept({ statusCode: 500, message: 'Unique constraint failed on users_email' }, 500);
      expect(el().textContent).not.toContain('Unique constraint');
    });
  });
});
