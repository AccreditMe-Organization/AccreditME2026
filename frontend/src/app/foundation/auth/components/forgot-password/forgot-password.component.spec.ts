import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { ForgotPasswordComponent } from './forgot-password.component';

const FORGOT_URL = `${environment.apiUrl}/auth/forgot-password`;

// ACC-188 — the Forgot password form, restored ("AccreditMe Sign-in Pages" §3).
describe('ForgotPasswordComponent (ACC-188)', () => {
  let httpMock: HttpTestingController;
  let host: HTMLElement;

  async function render(slug: string | null, language: 'en' | 'ar' = 'en') {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: TenantHostService, useValue: { slug } },
        { provide: LanguageService, useValue: { isArabic: () => language === 'ar', use: () => of(null) } },
        { provide: SignInLanguageService, useValue: { initial: () => language, remember: () => {} } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.tick();
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    host = fixture.nativeElement as HTMLElement;
    document.body.appendChild(host);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  afterEach(() => {
    httpMock.verify();
    host?.remove();
  });

  const text = (): string => host.textContent ?? '';
  const fieldMessage = (): string => host.querySelector('.am-field__message')?.textContent?.trim() ?? '';
  const failure = (): string => host.querySelector('[data-testid="forgot-failure"]')?.textContent?.trim() ?? '';

  function submit(fixture: Awaited<ReturnType<typeof render>>, email: string): void {
    fixture.componentInstance.form.controls.email.setValue(email);
    host.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  it('shows the title, the intro, an empty Email field, the button and the way back', async () => {
    await render('al-nakheel');
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Forgot password');
    expect(text()).toContain('Enter the email address you sign in with.');
    const email = host.querySelector<HTMLInputElement>('input#email');
    expect(email?.value).toBe(''); // never prefilled
    expect(host.querySelector('button[type="submit"]')?.textContent).toContain('Send reset link');
    expect(host.querySelector('a[href="/login"]')?.textContent?.trim()).toBe('Back to sign in');
  });

  it("an empty submit shows Sign in's line under the field, focuses it, and sends nothing", async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, '');
    expect(fieldMessage()).toBe('Enter your email.');
    expect(document.activeElement?.id).toBe('email');
    httpMock.expectNone(FORGOT_URL);
  });

  it("a malformed address shows Sign in's line, and sends nothing", async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, 'hessa.aldosari.example.test');
    expect(fieldMessage()).toBe('Enter a valid email address.');
    httpMock.expectNone(FORGOT_URL);
  });

  it('sends the address with the organisation from the host, read-only while sending', async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, 'hessa@example.test');
    const req = httpMock.expectOne(FORGOT_URL);
    expect(req.request.body).toEqual({ organizationSlug: 'al-nakheel', email: 'hessa@example.test' });
    expect(fixture.componentInstance.submitting()).toBeTrue();
    expect(fixture.componentInstance.form.disabled).toBeTrue();
    // A second press while sending does nothing.
    host.querySelector('form')!.dispatchEvent(new Event('submit'));
    httpMock.expectNone(FORGOT_URL);
    req.flush(null);
  });

  it('the confirmation names the address as typed, says what asking again does, and offers only the way back', async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, 'hessa@example.test');
    httpMock.expectOne(FORGOT_URL).flush(null);
    fixture.detectChanges();
    expect(host.querySelector('h1')?.textContent?.trim()).toBe('Check your email');
    const sent = host.querySelector('[data-testid="forgot-sent"]')!;
    expect(sent.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'If hessa@example.test has an account at this organisation, a link to reset the password is on its way. The link works once, for 1 hour. If nothing arrives in a few minutes, check your spam folder.',
    );
    expect(sent.querySelector('bdi[dir="ltr"]')?.textContent).toBe('hessa@example.test');
    expect(text()).toContain('Asking again sends a new link, and the earlier one stops working.');
    expect(host.querySelector('form')).toBeNull();
    expect(host.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('the Arabic confirmation keeps the address a left-to-right isolate inside the sentence', async () => {
    const fixture = await render('al-nakheel', 'ar');
    submit(fixture, 'hessa@example.test');
    httpMock.expectOne(FORGOT_URL).flush(null);
    fixture.detectChanges();
    const sent = host.querySelector('[data-testid="forgot-sent"]')!;
    expect(sent.textContent).toContain('إذا كان للبريد');
    expect(sent.querySelector('bdi[dir="ltr"]')?.textContent).toBe('hessa@example.test');
  });

  it('429: says to wait, keeps the address, and pressing again is the retry', async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, 'hessa@example.test');
    httpMock
      .expectOne(FORGOT_URL)
      .flush({ statusCode: 429, code: 'RATE_LIMITED', retryAfterSeconds: 60 }, { status: 429, statusText: 'Too Many Requests' });
    fixture.detectChanges();
    expect(failure()).toBe('Too many attempts. Wait a few minutes, then try again.');
    expect(fixture.componentInstance.form.controls.email.value).toBe('hessa@example.test');
    expect(host.textContent).not.toContain('Retry');
    host.querySelector('form')!.dispatchEvent(new Event('submit'));
    httpMock.expectOne(FORGOT_URL).flush(null);
  });

  it('unreachable: says so, keeps the address, and has no separate Retry', async () => {
    const fixture = await render('al-nakheel');
    submit(fixture, 'hessa@example.test');
    httpMock.expectOne(FORGOT_URL).error(new ProgressEvent('error'), { status: 0 });
    fixture.detectChanges();
    expect(failure()).toBe("We couldn't reach AccreditMe. Check your connection and try again.");
    expect(fixture.componentInstance.form.enabled).toBeTrue();
    expect(host.textContent).not.toContain('Retry');
  });

  it('"Back to sign in" goes to /login', async () => {
    await render('al-nakheel');
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    host.querySelector<HTMLAnchorElement>('a[href="/login"]')!.click();
    expect(String((router.navigateByUrl as jasmine.Spy).calls.mostRecent().args[0])).toBe('/login');
  });

  it('keeps the no-organisation note at an address that names none (ACC-139)', async () => {
    await render(null);
    expect(host.querySelector('[data-test="no-organisation-note"]')).not.toBeNull();
    expect(host.querySelector('form')).toBeNull();
  });
});
