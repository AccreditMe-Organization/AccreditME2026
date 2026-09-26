/**
 * ACC-120 — attaching the Arabic preposition ل to a name we did not write.
 *
 * Arabic prepositions of one letter are PREFIXES: they attach to the following
 * word rather than standing beside it. "for Pharmacy" is لقسم الصيدلة, not
 * "ل قسم الصيدلة". Interpolating a name after a bare ل therefore works — until
 * the name begins with the definite article ال, where the alif ELIDES:
 *
 *     ل + قسم الصيدلة        →  لقسم الصيدلة          correct by concatenation
 *     ل + العناية المركزة    →  للعناية المركزة        the alif is dropped
 *     لـ + العناية المركزة   →  لـالعناية المركزة      WRONG, and what we shipped
 *
 * Found in a browser on the Arrange-cover dialog's own title. The kashida form
 * (لـ) makes it worse rather than better: it renders the preposition detached
 * from a word it is grammatically part of, so the reader sees a stray letter.
 *
 * ## Why this is a helper and not two edited strings
 *
 * Two strings needed it the day it was written — a dialog title and a Setup
 * health sentence — and both name a tenant-supplied org unit. Any future screen
 * that titles itself "<verb> for <record>" in Arabic meets the same rule, and
 * the rule is not guessable from the English string.
 *
 * ## Why it is called from the COMPONENT and passed as a second parameter
 *
 * The component cannot know which language will render the string — ngx-translate
 * chooses at render time — so it cannot decide whether to prefix. So it supplies
 * BOTH forms and each language uses the one its grammar needs, which is the
 * pattern ACC-94 already set for duration and relative time ("pass both to the
 * translation and let each language use the one its grammar needs"). English
 * reads `{{unit}}`, Arabic reads `{{unitWithLam}}`, and neither language carries
 * a placeholder it does not use.
 *
 * ## A NON-ARABIC name keeps the detached form, deliberately
 *
 * Org unit names are tenant data and `nameAr` is optional — the display layer
 * falls back to `nameEn`, so an Arabic session routinely shows a Latin name. A
 * bare ل against Latin script gives "لNeonatal ICU", which is worse than a
 * visible preposition, so a name that does not begin in Arabic script gets
 * "لـ " with a space. Not ideal Arabic; the least wrong option for a mixed
 * string, and the alternative would be inventing a transliteration.
 */

/** The Arabic block, enough to tell Arabic script from Latin for this purpose. */
const STARTS_ARABIC = /^[؀-ۿ]/;

const LAM = 'ل';
const ALIF = 'ا';
const KASHIDA = 'ـ';

/**
 * `name` with the preposition ل attached, eliding the definite article's alif.
 * Returns '' for an empty name rather than a stray preposition.
 */
export function withArabicLam(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  if (trimmed === '') return '';

  // Latin (or any non-Arabic) name: keep the preposition visible and detached.
  if (!STARTS_ARABIC.test(trimmed)) return `${LAM}${KASHIDA} ${trimmed}`;

  // ال → لل: the article's alif is dropped, so drop exactly that one character.
  if (trimmed.startsWith(`${ALIF}${LAM}`)) return `${LAM}${trimmed.slice(1)}`;

  return `${LAM}${trimmed}`;
}
