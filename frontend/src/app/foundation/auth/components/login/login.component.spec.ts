import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { Location } from '@angular/common';
import { SpyLocation } from '@angular/common/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import {
  provideTranslateLoader,
  provideTranslateService,
  TranslateNoOpLoader,
  TranslateService,
} from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { AuthService } from '../../../../core/services/auth.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { INVITATION_ACCEPTED_NOTICE } from '../accept-invitation/accept-invitation.component';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { LoginComponent } from './login.component';

/** The auth layout's language plumbing and the formatting layer, held still. */
const LAYOUT_PROVIDERS = [
  provideFormatTesting(),
  { provide: LanguageService, useValue: { isArabic: () => false, use: () => of(null) } },
  { provide: SignInLanguageService, useValue: { initial: () => 'en', remember: () => {} } },
];

// ACC-120 slice 9e — arriving from Accept invitation says the password is set,
// ONCE. The browser keeps history.state across a reload and Angular hands it
// back to the reloaded page's navigation as extras.state, which is how the
// notice came back on every refresh. The router stub below does the same: the
// navigation's state is whatever the current history entry holds.
describe('LoginComponent — after accepting an invitation (ACC-120 slice 9e)', () => {
  const NOTICE_TEXT = 'auth.invitation.acceptedNotice';
  let location: SpyLocation;

  beforeEach(() => {
    location = new SpyLocation();
  });

  /** One page load of /login: the navigation carries the history entry's state. */
  function load(): HTMLElement {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        { provide: Location, useValue: location },
        {
          provide: Router,
          useValue: {
            currentNavigation: () => {
              const state = location.getState() as Record<string, unknown> | null;
              return state ? { extras: { state } } : null;
            },
            navigate: jasmine.createSpy('navigate'),
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: { isAuthenticated: () => false } },
        { provide: NavigationAccessService, useValue: {} },
        { provide: TenantHostService, useValue: { slug: 'al-nakheel' } },
        ...LAYOUT_PROVIDERS,
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  }

  /** The entry Accept invitation's navigate() leaves: our state plus the router's own. */
  function arriveFromAcceptInvitation(): void {
    location.replaceState('/login', '', {
      notice: INVITATION_ACCEPTED_NOTICE,
      navigationId: 4,
      ɵrouterPageId: 3,
    });
  }

  it('shows the notice on arrival', () => {
    arriveFromAcceptInvitation();
    expect(load().textContent).toContain(NOTICE_TEXT);
  });

  it('announces it politely, as a status rather than an alert', () => {
    arriveFromAcceptInvitation();
    const notice = load().querySelector('p-message')!;
    // Non-vacuity guard: it is the notice being judged, not some other message.
    expect(notice.textContent).toContain(NOTICE_TEXT);
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.getAttribute('aria-live')).toBe('polite');
  });

  it('removes it from the history entry, keeping the router\'s own keys and the URL', () => {
    arriveFromAcceptInvitation();
    load();
    expect(location.getState()).toEqual({ navigationId: 4, ɵrouterPageId: 3 });
    expect(location.path()).toBe('/login');
  });

  it('does not show it again when the page is reloaded', () => {
    arriveFromAcceptInvitation();
    expect(load().textContent).toContain(NOTICE_TEXT);

    // Reload: same history entry, same (now cleared) state.
    expect(load().textContent).not.toContain(NOTICE_TEXT);
  });

  it('does not show it on a plain visit, which carries no state', () => {
    location.replaceState('/login', '', null);
    expect(load().textContent).not.toContain(NOTICE_TEXT);
  });

  it('does not show it for some other navigation state, and leaves that state alone', () => {
    location.replaceState('/login', '', { notice: 'somethingElse', navigationId: 1 });
    expect(load().textContent).not.toContain(NOTICE_TEXT);
    expect(location.getState()).toEqual({ notice: 'somethingElse', navigationId: 1 });
  });
});

// ACC-139 — the organisation is the address the page was opened at.
describe('LoginComponent — the organisation comes from the address (ACC-139)', () => {
  function render(slug: string | null, login = jasmine.createSpy('login').and.returnValue(of({ mfaRequired: true }))) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: Router,
          useValue: {
            currentNavigation: () => null,
            navigate: jasmine.createSpy('navigate'),
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: { login, isAuthenticated: () => false } },
        { provide: NavigationAccessService, useValue: {} },
        { provide: TenantHostService, useValue: { slug } },
        ...LAYOUT_PROVIDERS,
      ],
    });
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, login };
  }

  it('asks for no organisation: the form has only email and password', () => {
    const { el } = render('al-nakheel');
    // Non-vacuity guard: it is the sign-in form being judged.
    expect(el.querySelector('form #email')).not.toBeNull();
    expect(el.querySelector('#organizationSlug')).toBeNull();
    expect(el.textContent).not.toContain('auth.organization');
    expect(el.querySelector('[data-test="no-organisation-note"]')).toBeNull();
  });

  it('signs in with the email and password only — the organisation is the address', () => {
    const { fixture, login } = render('al-nakheel');
    fixture.componentInstance.loginForm.setValue({ email: 'nurse@example.test', password: 'pw' });
    fixture.componentInstance.onSubmitLogin();
    expect(login).toHaveBeenCalledOnceWith('nurse@example.test', 'pw');
  });

  it('shows the note and no form at an address that names no organisation', () => {
    const { el } = render(null);
    expect(el.querySelector('[data-test="no-organisation-note"]')?.textContent).toContain(
      'auth.openOrganisationAddress',
    );
    expect(el.querySelector('form')).toBeNull();
    expect(el.querySelector('input')).toBeNull();
  });
});

// ACC-120 slice 9d — Sign in on the shared auth layout, with one sentence per
// refusal. Real translation files, so the assertions read what users read.
describe('LoginComponent — Sign in on the auth layout (ACC-120 slice 9d)', () => {
  let login: jasmine.Spy;
  let verifyMfa: jasmine.Spy;

  const refusal = (body: Record<string, unknown>, status = 401) =>
    new HttpErrorResponse({ status, error: { statusCode: status, ...body } });

  async function render(language: 'en' | 'ar' = 'en') {
    login = jasmine.createSpy('login').and.returnValue(of({ mfaRequired: true }));
    verifyMfa = jasmine.createSpy('verifyMfa').and.returnValue(of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        {
          provide: Router,
          useValue: {
            currentNavigation: () => null,
            navigate: jasmine.createSpy('navigate'),
            navigateByUrl: jasmine.createSpy('navigateByUrl'),
            createUrlTree: () => ({}),
            serializeUrl: () => '',
            events: { subscribe: () => ({ unsubscribe: () => {} }) },
          },
        },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
        { provide: AuthService, useValue: { login, verifyMfa, isAuthenticated: () => false } },
        { provide: NavigationAccessService, useValue: { loadAccess: () => of(undefined), isPlatformAdmin: () => false } },
        { provide: TenantHostService, useValue: { slug: 'al-nakheel' } },
        ...LAYOUT_PROVIDERS,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.tick();
    const fixture = TestBed.createComponent(LoginComponent);
    // In the document, so focus can be asserted.
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const submit = async () => {
      el.querySelector('form')!.dispatchEvent(new Event('submit'));
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const fill = (email: string, password: string) => fixture.componentInstance.loginForm.setValue({ email, password });
    const slot = () => el.querySelector('[data-testid="sign-in-message"]')?.textContent?.trim() ?? null;
    return { fixture, el, submit, fill, slot };
  }

  afterEach(() => document.querySelectorAll('app-login').forEach((n) => n.remove()));

  it('sits on the auth layout, with the fields in am-field', async () => {
    const { el } = await render();
    expect(el.querySelector('app-auth-layout')).not.toBeNull();
    expect(el.querySelectorAll('am-field').length).toBe(2);
  });

  it('says "Sign in" for the title and the button', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Sign in');
    expect(el.querySelector('p-button')?.textContent?.trim()).toBe('Sign in');
    expect(el.textContent).not.toContain('Log In');
  });

  it('gives the browser the right autocomplete hints', async () => {
    const { el } = await render();
    expect(el.querySelector('#email')?.getAttribute('autocomplete')).toBe('username');
    // The password is am-password-input, with its show/hide button inside the field.
    const password = el.querySelector('am-password-input');
    expect(password?.querySelector('input')?.getAttribute('autocomplete')).toBe('current-password');
    expect(password?.querySelector('button')).not.toBeNull();
  });

  it('an empty submit reveals the errors and focuses Email, without a request', async () => {
    const { el, submit } = await render();
    await submit();
    expect(login).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Enter your email.');
    expect(el.textContent).toContain('Enter your password.');
    expect(document.activeElement?.id).toBe('email');
  });

  // One spec per refusal: each code has its own sentence, in the one slot.
  const CASES: [string, Record<string, unknown>, number, string][] = [
    ['INVALID_CREDENTIALS', {}, 401, 'Email or password is incorrect. Check both and try again.'],
    ['ACCOUNT_INACTIVE', {}, 401, "This account isn't active."],
    ['ORGANIZATION_UNAVAILABLE', {}, 401, "Your organisation's access to AccreditMe isn't available right now."],
    ['RATE_LIMITED', { retryAfterSeconds: 60 }, 429, 'Too many sign-in attempts from this network. Try again in 1 minute.'],
  ];
  for (const [code, details, status, text] of CASES) {
    it(`shows ${code} as its own sentence`, async () => {
      const { submit, fill, slot } = await render();
      login.and.returnValue(throwError(() => refusal({ code, ...details }, status)));
      fill('nurse@example.test', 'pw');
      await submit();
      expect(slot()).toContain(text);
    });
  }

  it('shows ACCOUNT_LOCKED with when it lifts, and that attempts extend it', async () => {
    const { submit, fill, slot } = await render();
    const lockedUntil = new Date(Date.now() + 14 * 60_000 - 5_000).toISOString();
    login.and.returnValue(throwError(() => refusal({ code: 'ACCOUNT_LOCKED', lockedUntil })));
    fill('nurse@example.test', 'pw');
    await submit();
    expect(slot()).toContain('You can try again in 14 minutes.');
    expect(slot()).toContain('Each attempt before then extends the lock.');
  });

  it('a network failure says the API did not respond, not that the password was wrong', async () => {
    const { submit, fill, slot } = await render();
    login.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0, error: null })));
    fill('nurse@example.test', 'pw');
    await submit();
    expect(slot()).toContain("AccreditMe didn't respond");
    expect(slot()).not.toContain('incorrect');
  });

  it('a new refusal replaces the last one', async () => {
    const { el, submit, fill, slot } = await render();
    fill('nurse@example.test', 'pw');
    login.and.returnValue(throwError(() => refusal({ code: 'INVALID_CREDENTIALS' })));
    await submit();
    login.and.returnValue(throwError(() => refusal({ code: 'ACCOUNT_INACTIVE' })));
    await submit();
    expect(el.querySelectorAll('[data-testid="sign-in-message"]').length).toBe(1);
    expect(slot()).toContain("This account isn't active.");
  });

  it('shows the message in Arabic, the time included, in an Arabic session', async () => {
    const { submit, fill, slot } = await render('ar');
    login.and.returnValue(throwError(() => refusal({ code: 'RATE_LIMITED', retryAfterSeconds: 60 }, 429)));
    fill('nurse@example.test', 'pw');
    await submit();
    expect(slot()).toBe('محاولات تسجيل دخول كثيرة جدًا من هذه الشبكة. أعد المحاولة خلال دقيقة واحدة.');
  });

  describe('the MFA step', () => {
    async function atCodeStep() {
      const r = await render();
      r.fill('nurse@example.test', 'pw');
      await r.submit();
      return r;
    }
    const enterCode = async (r: Awaited<ReturnType<typeof render>>, code: string) => {
      r.fixture.componentInstance.mfaForm.setValue({ code });
      await r.submit();
    };

    it('is restyled on the same card, and posts the same code as before', async () => {
      const r = await atCodeStep();
      expect(r.el.querySelector('app-auth-layout #code')).not.toBeNull();
      expect(r.el.querySelector('#code')?.getAttribute('autocomplete')).toBe('one-time-code');
      await enterCode(r, '123456');
      expect(verifyMfa).toHaveBeenCalledOnceWith('123456');
    });

    it('puts a wrong code on the field, and names the attempts left at 2', async () => {
      const r = await atCodeStep();
      verifyMfa.and.returnValue(throwError(() => refusal({ code: 'MFA_INVALID', attemptsRemaining: 2 })));
      await enterCode(r, '123456');
      expect(r.el.querySelector('am-field')?.textContent).toContain("That code didn't work.");
      expect(r.slot()).toBe('2 attempts left for this sign-in.');
    });

    it('does not name the attempts left at 3', async () => {
      const r = await atCodeStep();
      verifyMfa.and.returnValue(throwError(() => refusal({ code: 'MFA_INVALID', attemptsRemaining: 3 })));
      await enterCode(r, '123456');
      expect(r.el.querySelector('am-field')?.textContent).toContain("That code didn't work.");
      expect(r.slot()).toBeNull();
    });

    it('says MFA_EXPIRED as "reload the page and sign in again"', async () => {
      const r = await atCodeStep();
      verifyMfa.and.returnValue(throwError(() => refusal({ code: 'MFA_EXPIRED' })));
      await enterCode(r, '123456');
      expect(r.slot()).toBe('This sign-in timed out. Reload the page and sign in again.');
    });

    it('a lock on the code step does not claim each attempt extends it', async () => {
      const r = await atCodeStep();
      const lockedUntil = new Date(Date.now() + 10 * 60_000 - 5_000).toISOString();
      verifyMfa.and.returnValue(throwError(() => refusal({ code: 'ACCOUNT_LOCKED', lockedUntil })));
      await enterCode(r, '123456');
      expect(r.slot()).toContain('You can try again in 10 minutes.');
      expect(r.slot()).not.toContain('extend');
    });
  });
});
