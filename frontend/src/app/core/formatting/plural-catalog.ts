// ACC-94 (decision D1, condition a) — counted strings live OUTSIDE ngx-translate.
//
// Each translation file has one top-level "plural" section. PluralSplittingLoader
// removes it before ngx-translate sees the file and registers it here, so
//
//   'plural.shell.openConditions' | translate
//
// finds no such key. There is no object to render as "[object Object]" and no
// English-shaped fallback: the only way to a counted string is
// FormatService.count() or the amCount pipe, which pick the form with
// Intl.PluralRules. (A mistaken translate call shows the key text, which is
// visible in review; the build-time scan rejects it before that.)
import { Injectable, inject, signal } from '@angular/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, map } from 'rxjs';

// One counted string: the forms for one language. English needs one and other;
// Arabic needs all six (zero, one, two, few, many, other), enforced by
// translation-keys.spec.ts rather than by a runtime fallback.
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>>;

const PLURAL_CATEGORIES: ReadonlySet<string> = new Set(['zero', 'one', 'two', 'few', 'many', 'other']);

export function isPluralForms(value: unknown): value is PluralForms {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 && entries.every(([category, text]) => PLURAL_CATEGORIES.has(category) && typeof text === 'string')
  );
}

@Injectable({ providedIn: 'root' })
export class PluralCatalog {
  // A signal, so a count rendered before its language file arrives updates when
  // it does (Arabic is fetched on the first switch, not at start-up).
  private readonly sections = signal<Readonly<Record<string, unknown>>>({});
  private readonly registrations = signal(0);

  // Increments on every registration; pipes include it in their memo key.
  readonly revision = this.registrations.asReadonly();

  register(language: string, section: unknown): void {
    const value = section !== null && typeof section === 'object' && !Array.isArray(section) ? section : {};
    this.sections.update((current) => ({ ...current, [language]: value }));
    this.registrations.update((n) => n + 1);
  }

  forms(language: string, key: string): PluralForms | undefined {
    let node: unknown = this.sections()[language];
    for (const segment of key.split('.')) {
      if (node === null || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return isPluralForms(node) ? node : undefined;
  }
}

// Splits every language file into what ngx-translate keeps and what the plural
// catalogue keeps. Wraps the HTTP loader rather than replacing it, so file
// locations and caching stay as configured by provideTranslateHttpLoader().
@Injectable()
export class PluralSplittingLoader implements TranslateLoader {
  private readonly inner = inject(TranslateHttpLoader);
  private readonly catalog = inject(PluralCatalog);

  getTranslation(lang: string): Observable<TranslationObject> {
    return this.inner.getTranslation(lang).pipe(
      map((file) => {
        const { plural, ...rest } = file as TranslationObject & { plural?: unknown };
        this.catalog.register(lang, plural);
        return rest as TranslationObject;
      }),
    );
  }
}

// Must come AFTER provideTranslateHttpLoader() in the providers array: it
// replaces the TranslateLoader binding that call made, and reuses its config.
export function providePluralAwareTranslateLoader() {
  return [TranslateHttpLoader, { provide: TranslateLoader, useClass: PluralSplittingLoader }];
}
