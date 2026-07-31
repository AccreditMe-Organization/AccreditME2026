// ACC-19 Section 7 — first-ever empirical proof that LanguageService.use()
// produces a REAL rendered consequence, not just a signal value change.
// Distinct from language.service.spec.ts (which uses TranslateNoOpLoader and
// only asserts on document.documentElement, never renders a component): this
// spec uses a loader with real per-language translation dictionaries and a
// component with an actual |translate-piped template binding, proving both
// halves of the plan's minimum bar in one test — a translated string
// appearing in rendered DOM, and dir flipping to rtl.
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  TranslateLoader,
  TranslatePipe,
  provideTranslateLoader,
  provideTranslateService,
} from '@ngx-translate/core';
import { LanguageService } from './language.service';

class FakeDictionaryLoader extends TranslateLoader {
  private readonly dictionaries: Record<string, Record<string, string>> = {
    en: { greeting: 'Hello' },
    ar: { greeting: 'مرحبا' },
  };

  getTranslation(lang: string) {
    return of(this.dictionaries[lang] ?? {});
  }
}

@Component({
  standalone: true,
  imports: [TranslatePipe],
  template: `<p>{{ 'greeting' | translate }}</p>`,
})
class TranslatedGreetingHostComponent {}

describe('LanguageService — rendered consequence of use() (ACC-19 Section 7)', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');

    TestBed.configureTestingModule({
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(FakeDictionaryLoader) }),
      ],
    });
  });

  it('re-renders a |translate-piped template with real translated text and flips dir to rtl after switching to Arabic', () => {
    const fixture = TestBed.createComponent(TranslatedGreetingHostComponent);
    const languageService = TestBed.inject(LanguageService);
    fixture.detectChanges();
    TestBed.tick();

    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('Hello');
    expect(document.documentElement.getAttribute('dir')).toBe('ltr');

    languageService.use('ar').subscribe();
    TestBed.tick();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('مرحبا');
    expect(document.documentElement.getAttribute('dir')).toBe('rtl');
  });
});
