import { TestBed } from '@angular/core/testing';

/**
 * ACC-184 — `<html dir>` and `<html lang>` are global state that no TestBed
 * resets, and LanguageService writes both whenever the language changes. A spec
 * that renders an Arabic session and stops there leaves the whole document
 * right to left for every spec after it — which is how DataListComponent's
 * alignment spec failed in CI with its column offsets in mirror order, in a
 * file the leaking spec never touched.
 *
 * This had been fixed file by file at least five times before, each copy a
 * little different. This is the one rule, and the global guard beside it
 * (`document-language.guard.spec.ts`) fails any spec that breaks it.
 */
export interface DocumentLanguage {
  readonly dir: string | null;
  readonly lang: string | null;
}

export function readDocumentLanguage(): DocumentLanguage {
  const html = document.documentElement;
  return { dir: html.getAttribute('dir'), lang: html.getAttribute('lang') };
}

/** Puts back exactly what was there — an attribute that was absent is removed. */
export function writeDocumentLanguage(state: DocumentLanguage): void {
  const html = document.documentElement;
  for (const name of ['dir', 'lang'] as const) {
    const value = state[name];
    if (value === null) html.removeAttribute(name);
    else html.setAttribute(name, value);
  }
}

/**
 * Call FIRST inside any `describe` whose specs change the document's direction
 * or language — directly, or by switching the real LanguageService to Arabic.
 *
 * Before each spec it records `dir` and `lang`; after it, it tears the TestBed
 * down and then puts the recorded values back.
 *
 * - **Teardown first, and the order is the fix.** `translate.use()` resolves
 *   asynchronously, so LanguageService's effect can fire after the reset and
 *   write `rtl` back during a LATER spec. Destroying the injector destroys the
 *   effect with it.
 * - **First in the describe, so it runs last.** Jasmine runs `afterEach` hooks
 *   in reverse order of declaration, so a spec's own `httpMock.verify()` still
 *   runs against the live TestBed before this tears it down.
 */
export function preserveDocumentLanguage(): void {
  let original: DocumentLanguage = { dir: null, lang: null };
  beforeEach(() => {
    original = readDocumentLanguage();
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    writeDocumentLanguage(original);
  });
}
