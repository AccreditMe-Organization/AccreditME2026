// ACC-95 — counted words in server-built text (notification titles and bodies),
// written once.
//
// A notice is stored text in both languages, so a count in it is chosen here,
// by the language's own plural rules, never as "task(s)". English has two
// categories (one, other); Arabic has six (zero, one, two, few, many, other).
// The types require every category, so a missing Arabic form is a compile
// error, never a blank or an English fallback.
//
// `{count}` in a form is replaced with the count in LATIN digits in both
// languages (Ahmad's rule for the whole product; the screens do the same).

export type EnglishForms = Readonly<Record<'one' | 'other', string>>;
export type ArabicForms = Readonly<Record<'zero' | 'one' | 'two' | 'few' | 'many' | 'other', string>>;

const EN_RULES = new Intl.PluralRules('en');
const AR_RULES = new Intl.PluralRules('ar');
const LATIN_DIGITS = new Intl.NumberFormat('en');

/** Both languages for a count. `{count}` is replaced with Latin digits. */
export function counted(count: number, forms: { en: EnglishForms; ar: ArabicForms }): { en: string; ar: string } {
  const digits = LATIN_DIGITS.format(count);
  const en = forms.en[EN_RULES.select(count) as keyof EnglishForms];
  const ar = forms.ar[AR_RULES.select(count) as keyof ArabicForms];
  return { en: en.split('{count}').join(digits), ar: ar.split('{count}').join(digits) };
}
