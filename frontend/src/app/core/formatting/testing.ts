import { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslateService, TranslationObject } from '@ngx-translate/core';
import { FormatContext, TestFormatContext } from './format-context';
import { PluralCatalog } from './plural-catalog';

// Specs set the tenant zone and the calendar directly, and switch language the
// way the app does (TranslateService.use). Inject TestFormatContext to change
// either mid-test:
//
//   TestBed.inject(TestFormatContext).zone.set('America/New_York');
export function provideFormatTesting(): (Provider | EnvironmentProviders)[] {
  return [TestFormatContext, { provide: FormatContext, useExisting: TestFormatContext }];
}

// Loads translation files into a spec the way PluralSplittingLoader does in the
// app: the "plural" section goes to the plural catalogue, the rest to
// ngx-translate. Pass the real en.json / ar.json to test against what users see.
export function loadTranslationsForTest(files: Record<string, unknown>): void {
  const translate = TestBed.inject(TranslateService);
  const catalog = TestBed.inject(PluralCatalog);
  for (const [language, file] of Object.entries(files)) {
    const { plural, ...rest } = file as TranslationObject & { plural?: unknown };
    catalog.register(language, plural);
    translate.setTranslation(language, rest as TranslationObject);
  }
}
