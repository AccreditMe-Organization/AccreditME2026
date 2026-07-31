import { TestBed } from '@angular/core/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { LanguageService } from './language.service';

describe('LanguageService', () => {
  let service: LanguageService;

  beforeEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');

    TestBed.configureTestingModule({
      providers: [provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) })],
    });

    service = TestBed.inject(LanguageService);
    TestBed.tick();
  });

  it('sets dir="ltr" and lang="en" on <html> for the default language', () => {
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
    expect(service.isRtl()).toBeFalse();
    expect(service.isArabic()).toBeFalse();
  });

  it('sets dir="rtl" and lang="ar" on <html> after switching to Arabic', () => {
    service.use('ar').subscribe();
    TestBed.tick();

    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
    expect(document.documentElement.getAttribute('lang')).toBe('ar');
    expect(service.isRtl()).toBeTrue();
    expect(service.isArabic()).toBeTrue();
  });

  it('reverts to dir="ltr" when switching back to English', () => {
    service.use('ar').subscribe();
    TestBed.tick();

    service.use('en').subscribe();
    TestBed.tick();

    expect(document.documentElement.getAttribute('dir')).toBe('ltr');
    expect(service.isRtl()).toBeFalse();
  });
});
