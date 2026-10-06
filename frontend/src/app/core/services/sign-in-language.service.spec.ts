import { TestBed } from '@angular/core/testing';
import { SignInLanguageService } from './sign-in-language.service';

// ACC-120 slice 9e — the language a sign-in screen opens in.
describe('SignInLanguageService (ACC-120 slice 9e)', () => {
  const KEY = 'am.signInLanguage';
  let service: SignInLanguageService;

  function browserLanguages(langs: string[]): void {
    spyOnProperty(navigator, 'languages', 'get').and.returnValue(langs);
  }

  beforeEach(() => {
    localStorage.removeItem(KEY);
    service = TestBed.inject(SignInLanguageService);
  });

  afterEach(() => localStorage.removeItem(KEY));

  it('opens in the language last chosen on a sign-in screen', () => {
    browserLanguages(['en-GB']);
    localStorage.setItem(KEY, 'ar');
    expect(service.initial()).toBe('ar');
  });

  it('prefers the stored choice over an Arabic browser', () => {
    browserLanguages(['ar-SA']);
    localStorage.setItem(KEY, 'en');
    expect(service.initial()).toBe('en');
  });

  it('falls back to Arabic for an Arabic browser, and English otherwise', () => {
    browserLanguages(['ar-AE', 'en']);
    expect(service.initial()).toBe('ar');
  });

  it('defaults to English for any other browser language', () => {
    browserLanguages(['fr-FR', 'ar']);
    expect(service.initial()).toBe('en');
  });

  it('ignores a stored value that is not a language it offers', () => {
    browserLanguages(['en-US']);
    localStorage.setItem(KEY, 'de');
    expect(service.initial()).toBe('en');
  });

  it('remembers a choice for the next visit', () => {
    browserLanguages(['en-US']);
    service.remember('ar');
    expect(localStorage.getItem(KEY)).toBe('ar');
    expect(TestBed.inject(SignInLanguageService).initial()).toBe('ar');
  });

  it('still works when storage throws — a private window, blocked site data', () => {
    browserLanguages(['ar-SA']);
    spyOn(Storage.prototype, 'getItem').and.throwError('SecurityError');
    spyOn(Storage.prototype, 'setItem').and.throwError('QuotaExceededError');

    expect(() => service.remember('en')).not.toThrow();
    expect(service.initial()).toBe('ar');
  });
});
