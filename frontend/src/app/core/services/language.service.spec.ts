import { TestBed } from '@angular/core/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { LanguageService } from './language.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';

describe('LanguageService', () => {
  let service: LanguageService;

  // ACC-184 — two specs here end in Arabic, right to left. The beforeEach below
  // clears <html> so each spec starts from a known state; this puts back what
  // was there before it, so neither leaks into the rest of the suite.
  preserveDocumentLanguage();

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

  // ACC-160 — bilingual() reads the language at CALL time. The same call,
  // unchanged, must give a different answer after a switch; a value computed
  // once and stored would not. Ends back in English so <html dir> does not leak
  // RTL into other specs (the CC-8 DataList alignment leak).
  it('bilingual() follows a language switch rather than freezing', () => {
    const name = (): string => service.bilingual('Quality Committee', 'لجنة الجودة');
    expect(name()).toBe('Quality Committee');

    service.use('ar').subscribe();
    TestBed.tick();
    expect(name()).toBe('لجنة الجودة');

    service.use('en').subscribe();
    TestBed.tick();
    expect(name()).toBe('Quality Committee');
  });

  it('bilingual() shows the English name in Arabic when there is no Arabic one', () => {
    service.use('ar').subscribe();
    TestBed.tick();
    expect(service.bilingual('Quality Committee', null)).toBe('Quality Committee');

    service.use('en').subscribe();
    TestBed.tick();
  });
});
