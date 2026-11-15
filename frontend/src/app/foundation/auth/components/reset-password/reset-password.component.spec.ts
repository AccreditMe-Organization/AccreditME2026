// ACC-188 — the Reset password page ("AccreditMe Sign-in Pages" §4).
//
// The real AuthService (a thin HttpClient wrapper) with HttpClientTesting, so
// the requests and refusal bodies are the shapes the backend really sends:
// RESET_LINK_* (400), the password codes (400 / 503) and the throttler's 429.
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Location } from '@angular/common';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { REQUEST_TIMEOUT_MS, SKELETON_DELAY_MS } from '../../../../core/request-outcome/request-outcome';
import { PASSWORD_RESET_NOTICE, ResetPasswordComponent } from './reset-password.component';

const TOKEN = 'A'.repeat(43);
const LOOKUP_URL = `${environment.apiUrl}/auth/reset-password/lookup`;
const RESET_URL = `${environment.apiUrl}/auth/reset-password`;
const refusal = (code: string, statusCode = 400) => ({ statusCode, message: 'refused', error: 'x', code });

describe('ResetPasswordComponent (ACC-188)', () => {
  let fixture: ComponentFixture<ResetPasswordComponent>;
  let httpMock: HttpTestingController;
  let navigate: jasmine.Spy;
  let replaceState: jasmine.Spy;

  function setup(opts: { token?: string | null; language?: 'en' | 'ar'; slug?: string | null } = {}): void {
    const token = opts.token === undefined ? TOKEN : opts.token;
    const language = opts.language ?? 'en';
    replaceState = jasmine.createSpy('replaceState');
    TestBed.configureTestingModule({
      imports: [ResetPasswordComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(token ? { token } : {}) } },
        },
        {
          provide: Location,
          useValue: {
            path: () => (token ? `/reset-password?token=${token}` : '/reset-password'),
            replaceState,
          },
        },
        { provide: TenantHostService, useValue: { slug: opts.slug === undefined ? 'al-nakheel' : opts.slug } },
        { provide: LanguageService, useValue: { isArabic: () => language === 'ar', use: () => of(null) } },
        { provide: SignInLanguageService, useValue: { initial: () => language, remember: () => {} } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ResetPasswordComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  }

  afterEach(() => {
    httpMock.verify();
    fixture?.nativeElement.remove();
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const h1 = (): string => el().querySelector('h1')?.textContent?.trim() ?? '';
  const messages = (): string[] =>
    Array.from(el().querySelectorAll('.am-field__message')).map((m) => m.textContent?.trim() ?? '');
  const failure = (): string => el().querySelector('[data-testid="reset-failure"]')?.textContent?.trim() ?? '';
  const form = () => fixture.componentInstance.form;

  function openLink(): void {
    httpMock.expectOne(LOOKUP_URL).flush({ state: 'open', expiresAt: '2026-11-14T10:00:00.000Z' });
    fixture.detectChanges();
  }

  function submit(password: string, confirm: string): void {
    form().controls.password.setValue(password);
    form().controls.confirm.setValue(confirm);
    el().querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  function refuseReset(body: object, status: number): void {
    httpMock.expectOne(RESET_URL).flush(body, { status, statusText: 'Error' });
    fixture.detectChanges();
  }

  describe('the token', () => {
    it('leaves the address bar at once, and is sent from memory to the lookup and the reset', () => {
      setup();
      expect(replaceState).toHaveBeenCalledWith('/reset-password');
      const lookup = httpMock.expectOne(LOOKUP_URL);
      expect(lookup.request.body).toEqual({ token: TOKEN });
      lookup.flush({ state: 'open', expiresAt: '2026-11-14T10:00:00.000Z' });
      fixture.detectChanges();
      submit('a-long-new-password', 'a-long-new-password');
      const reset = httpMock.expectOne(RESET_URL);
      expect(reset.request.body).toEqual({ token: TOKEN, password: 'a-long-new-password' });
      reset.flush(null);
    });

    it('when missing (a refresh), shows the invalid state at once: no request, no form', () => {
      setup({ token: null });
      httpMock.expectNone(LOOKUP_URL);
      expect(h1()).toBe("This link can't be used");
      expect(el().querySelector('form')).toBeNull();
    });
  });

  describe('while the link is checked', () => {
    it('shows no form, and the skeleton only after 200ms', fakeAsync(() => {
      setup();
      expect(el().querySelector('form')).toBeNull();
      expect(el().querySelector('[data-testid="reset-skeleton"]')).toBeNull();
      tick(SKELETON_DELAY_MS);
      fixture.detectChanges();
      expect(el().querySelector('[data-testid="reset-skeleton"]')).not.toBeNull();
      openLink();
      expect(el().querySelector('form')).not.toBeNull();
    }));

    it('after 8 seconds says so, and Retry asks again', fakeAsync(() => {
      setup();
      tick(REQUEST_TIMEOUT_MS);
      fixture.detectChanges();
      expect(el().textContent).toContain('This is taking longer than usual.');
      const retry = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.includes('Retry'))!;
      retry.click();
      fixture.detectChanges();
      const requests = httpMock.match(LOOKUP_URL);
      expect(requests.length).toBe(2);
      expect(requests[0]!.cancelled).toBeTrue();
      requests[1]!.flush({ state: 'open', expiresAt: '2026-11-14T10:00:00.000Z' });
      tick(REQUEST_TIMEOUT_MS);
    }));

    it('a check that cannot reach the server offers Retry, not a dead-link page', () => {
      setup();
      httpMock.expectOne(LOOKUP_URL).error(new ProgressEvent('error'), { status: 0 });
      fixture.detectChanges();
      expect(el().textContent).toContain("We couldn't reach AccreditMe.");
      expect(el().textContent).toContain('Retry');
      expect(el().querySelector('form')).toBeNull();
    });

    it('a rate-limited check says to wait, and keeps Retry', () => {
      setup();
      httpMock.expectOne(LOOKUP_URL).flush(refusal('RATE_LIMITED', 429), { status: 429, statusText: 'x' });
      fixture.detectChanges();
      expect(el().textContent).toContain('Too many attempts. Wait a few minutes, then try again.');
      expect(el().textContent).toContain('Retry');
    });
  });

  describe('dead links have no form, and one main action', () => {
    const cases: [string, string, string, string, string | null][] = [
      ['RESET_LINK_EXPIRED', 'This link has expired', 'Send a new link', '/forgot-password', 'Back to sign in'],
      ['RESET_LINK_USED', 'This link has already been used', 'Sign in', '/login', 'Forgot password?'],
      ['RESET_LINK_REPLACED', 'A newer link was sent', 'Back to sign in', '/login', null],
      ['RESET_LINK_INVALID', "This link can't be used", 'Send a new link', '/forgot-password', 'Back to sign in'],
    ];
    for (const [code, title, button, path, link] of cases) {
      it(`${code}: "${title}", with ${button}${link ? ` and ${link} under it` : ''}`, () => {
        setup();
        httpMock.expectOne(LOOKUP_URL).flush(refusal(code), { status: 400, statusText: 'Bad Request' });
        fixture.detectChanges();
        expect(h1()).toBe(title);
        expect(el().querySelector('form')).toBeNull();
        expect(el().textContent).not.toContain('Retry');
        const main = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === button)!;
        main.click();
        expect(navigate).toHaveBeenCalledWith([path]);
        const links = Array.from(el().querySelectorAll('a')).map((a) => a.textContent?.trim());
        expect(links).toEqual(link ? [link] : []);
      });
    }

    it('a link lost to another tab while submitting turns into "already been used"', () => {
      setup();
      openLink();
      submit('a-long-new-password', 'a-long-new-password');
      refuseReset(refusal('RESET_LINK_USED'), 400);
      expect(h1()).toBe('This link has already been used');
      expect(el().querySelector('form')).toBeNull();
    });
  });

  describe('the form', () => {
    it("shows the rules as New password's hint, and one show/hide per field", () => {
      setup();
      openLink();
      expect(h1()).toBe('Choose a new password');
      expect(messages()[0]).toBe('8 to 128 characters');
      expect(el().querySelectorAll('am-password-input').length).toBe(2);
      expect(el().querySelectorAll('am-password-input button').length).toBe(2);
    });

    it('submitted empty: both errors, focus on New password, nothing sent', () => {
      setup();
      openLink();
      submit('', '');
      expect(messages()).toEqual(['Enter a password.', 'Enter the new password again.']);
      expect(document.activeElement?.id).toBe('new-password');
      httpMock.expectNone(RESET_URL);
    });

    it('too short and too long use the hint\'s place, without asking the server', () => {
      setup();
      openLink();
      submit('short', 'short');
      expect(messages()[0]).toBe('Use at least 8 characters.');
      submit('x'.repeat(129), 'x'.repeat(129));
      expect(messages()[0]).toBe('Use no more than 128 characters.');
      httpMock.expectNone(RESET_URL);
    });

    it('a mismatch is caught on submit only, on Confirm, with focus there', () => {
      setup();
      openLink();
      form().controls.password.setValue('a-long-new-password');
      form().controls.confirm.setValue('a-long-new-passwor');
      fixture.detectChanges();
      expect(messages()[1]).toBe(''); // not while typing
      submit('a-long-new-password', 'a-long-new-passwor');
      expect(messages()[1]).toBe("The two passwords don't match.");
      expect(document.activeElement?.id).toBe('confirm-password');
      httpMock.expectNone(RESET_URL);
    });

    it('a breached password goes under New password, and the link still works', () => {
      setup();
      openLink();
      submit('password123', 'password123');
      refuseReset(refusal('PASSWORD_COMPROMISED'), 400);
      expect(messages()[0]).toBe('This password has appeared in a data breach. Choose a different one.');
      expect(el().querySelector('form')).not.toBeNull();
    });

    it('a breach check that is down sits above the button; pressing again is the retry', () => {
      setup();
      openLink();
      submit('a-long-new-password', 'a-long-new-password');
      refuseReset(refusal('PASSWORD_CHECK_UNAVAILABLE', 503), 503);
      expect(failure()).toBe("We couldn't check your password just now. Try again; your link still works.");
      expect(el().textContent).not.toContain('Retry');
      el().querySelector('form')!.dispatchEvent(new Event('submit'));
      httpMock.expectOne(RESET_URL).flush(null);
    });

    it('is read-only while sending, and a second press does nothing', () => {
      setup();
      openLink();
      submit('a-long-new-password', 'a-long-new-password');
      expect(form().disabled).toBeTrue();
      el().querySelector('form')!.dispatchEvent(new Event('submit'));
      const requests = httpMock.match(RESET_URL);
      expect(requests.length).toBe(1);
      requests[0]!.flush(null);
    });

    it('429 and unreachable keep both passwords, with one message above the button', () => {
      setup();
      openLink();
      submit('a-long-new-password', 'a-long-new-password');
      refuseReset(refusal('RATE_LIMITED', 429), 429);
      expect(failure()).toBe('Too many attempts. Wait a few minutes, then try again.');
      expect(form().getRawValue()).toEqual({ password: 'a-long-new-password', confirm: 'a-long-new-password' });
      el().querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      httpMock.expectOne(RESET_URL).error(new ProgressEvent('error'), { status: 0 });
      fixture.detectChanges();
      expect(failure()).toBe("We couldn't reach AccreditMe. Check your connection and try again.");
    });

    it('on success goes to Sign in with the one-time notice — never signed in here', () => {
      setup();
      openLink();
      submit('a-long-new-password', 'a-long-new-password');
      httpMock.expectOne(RESET_URL).flush(null);
      expect(navigate).toHaveBeenCalledWith(['/login'], { state: { notice: PASSWORD_RESET_NOTICE } });
    });
  });

  it('is drawn in Arabic, right to left, in an Arabic session', () => {
    setup({ language: 'ar' });
    openLink();
    expect(h1()).toBe('اختر كلمة مرور جديدة');
    expect(messages()[0]).toBe('من 8 إلى 128 حرفًا');
  });

  it('keeps the no-organisation note at an address that names none, and asks nothing', () => {
    setup({ slug: null });
    httpMock.expectNone(LOOKUP_URL);
    expect(el().querySelector('[data-test="no-organisation-note"]')).not.toBeNull();
  });
});
