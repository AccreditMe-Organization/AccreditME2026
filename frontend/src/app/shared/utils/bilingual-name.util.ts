/**
 * ACC-160 — which of a record's two stored names to SHOW, written once.
 *
 * Tenant data carries a name pair (`nameEn`/`nameAr`, `labelEn`/`labelAr`),
 * and the Arabic half is OPTIONAL: the product is sold to customers who do not
 * operate in Arabic, so an Arabic session routinely meets a record that has no
 * Arabic name. This answers "what does the reader see" for every such pair.
 *
 * ## The rule
 *
 * The Arabic name, when the session is Arabic AND there is one — non-empty
 * after trimming. Otherwise the English name. Never blank.
 *
 * ## Why English rather than a dash
 *
 * The reasoning is not new, and is quoted rather than re-derived. It is how the
 * backend already resolves a delegation qualifier
 * (`delegation-label.service.ts`): "OrgUnit.nameAr is nullable; fall back to
 * the English name rather than null, so an Arabic reader sees the unit rather
 * than losing the qualifier entirely." `arabic-prefix.util.ts` states the same
 * convention for org units. Losing the name is worse for an Arabic reader than
 * reading it in English.
 *
 * That holds for a name shown AS THE RECORD'S IDENTITY — a title, a list's name
 * column, a dropdown option. A column whose own job is "the Arabic name" is a
 * different case and shows "—" for a missing value, because putting the English
 * name there would make the column lie (`public-holiday-list` is the
 * precedent). Do not use this helper for that column.
 *
 * ## Why the trim test, and why the value is returned as stored
 *
 * Whitespace is the emptiness TEST only. A value of "  " is treated as missing
 * — five DTOs still store '' rather than NULL (ACC-160 follow-up), and this
 * keeps any such row from rendering as an invisible name. What is returned is
 * the stored value unchanged: display does not quietly rewrite tenant data.
 *
 * ## Why a pure function with the language passed in
 *
 * So it is exhaustively testable with no DI, and so a caller cannot freeze it.
 * Components call `LanguageService.bilingual()`, which reads the live language
 * at CALL time. Never compute a display name once at load and store it: that is
 * the one-time-set trap, and it keeps the previous language after a switch. Its
 * worked example was the shell's tenant name, until ACC-161 made it a computed
 * over the stored pair (SYSTEM-REFERENCE §9.3).
 */
export function pickBilingualName(
  en: string,
  ar: string | null | undefined,
  arabic: boolean,
): string {
  return arabic && (ar ?? '').trim() !== '' ? (ar as string) : en;
}
