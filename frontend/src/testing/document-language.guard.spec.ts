import { TestBed } from '@angular/core/testing';
import { DocumentLanguage, readDocumentLanguage, writeDocumentLanguage } from './document-language';

/**
 * ACC-184 — THE GUARD. These hooks are declared at the top level of a spec
 * file, outside any `describe`, so Jasmine runs them around EVERY spec in the
 * suite, after the spec's own hooks.
 *
 * A spec that leaves the document in a different direction or language from
 * the one it found FAILS here, by name — so the next leak is caught in the spec
 * that causes it, instead of as mirrored offsets in an unrelated file under one
 * random order in twenty. Either way the document is put back, so the leak
 * never reaches the next spec.
 *
 * "Different" means EFFECTIVE direction and language: no `dir` is left to right
 * and no `lang` is English, as the browser treats them. A spec that merely
 * creates LanguageService in English writes `dir="ltr"` over an absent
 * attribute; that changes nothing a later spec can measure, so it is put back
 * silently rather than failed.
 */
const effective = (state: DocumentLanguage): string =>
  `${state.dir || 'ltr'}/${state.lang || 'en'}`;

let before: DocumentLanguage = { dir: null, lang: null };

beforeEach(() => {
  before = readDocumentLanguage();
});

afterEach(() => {
  // Tear down first, for the same reason preserveDocumentLanguage() does: a
  // pending LanguageService effect must not write rtl back after the check.
  TestBed.resetTestingModule();
  const after = readDocumentLanguage();
  if (after.dir === before.dir && after.lang === before.lang) return;

  writeDocumentLanguage(before);
  if (effective(after) !== effective(before)) {
    fail(
      `This spec changed <html> from ${effective(before)} to ${effective(after)} and did not put it back. ` +
        'Call preserveDocumentLanguage() (src/testing/document-language.ts) first in its describe — ' +
        'a later spec measuring layout would otherwise run right to left.',
    );
  }
});
