import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { LanguageService } from '../../../../core/services/language.service';
import { SignInLanguageService } from '../../../../core/services/sign-in-language.service';
import { of } from 'rxjs';
import { ForgotPasswordComponent } from './forgot-password.component';

// ACC-120 slice 9d — password reset is not served, so the page says so and
// sends nothing (CC-62, answer 1).
describe('ForgotPasswordComponent (ACC-120 slice 9d)', () => {
  let httpMock: HttpTestingController;

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
        // The layout opens in the requested language, so it never switches here.
        { provide: LanguageService, useValue: { isArabic: () => language === 'ar', use: () => of(null) } },
        { provide: SignInLanguageService, useValue: { initial: () => language, remember: () => {} } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.tick();
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => httpMock.verify());

  it('shows the title, the honest note and the way back — and no field', async () => {
    const el = await render('al-manara');
    expect(el.querySelector('app-auth-layout')).not.toBeNull();
    expect(el.querySelector('h1')?.textContent?.trim()).toBe('Forgot password');
    expect(el.querySelector('[data-testid="forgot-password-note"]')?.textContent).toContain(
      "Password reset by email isn't available yet.",
    );
    expect(el.querySelector('input, form')).toBeNull();
    const back = el.querySelector<HTMLAnchorElement>('a[href="/login"]');
    expect(back?.textContent?.trim()).toBe('Back to sign in');
  });

  it('makes no HTTP request at all', async () => {
    await render('al-manara');
    // afterEach's verify() fails on any request; this states it outright too.
    httpMock.expectNone(() => true);
    expect(() => httpMock.verify()).not.toThrow();
  });

  it('never says "check your inbox", in either language', async () => {
    for (const language of ['en', 'ar'] as const) {
      const text = (await render('al-manara', language)).textContent ?? '';
      // Non-vacuity guard: the page rendered its note in this language.
      expect(text).toContain(language === 'en' ? 'Ask your organisation' : 'مسؤول النظام');
      expect(text.toLowerCase()).not.toContain('inbox');
      expect(text).not.toContain('بريدك الوارد');
    }
  });

  it('"Back to sign in" goes to /login', async () => {
    const el = await render('al-manara');
    const router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
    el.querySelector<HTMLAnchorElement>('a[href="/login"]')!.click();
    expect(router.navigateByUrl).toHaveBeenCalled();
    expect(String((router.navigateByUrl as jasmine.Spy).calls.mostRecent().args[0])).toBe('/login');
  });

  it('keeps the no-organisation note at an address that names none (ACC-139)', async () => {
    const el = await render(null);
    expect(el.querySelector('[data-test="no-organisation-note"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="forgot-password-note"]')).toBeNull();
  });
});
