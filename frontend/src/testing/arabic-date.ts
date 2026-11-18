/**
 * ACC-313 (CC-323) — a formatted date takes the page's direction.
 *
 * A date from the formatting layer is words and digits in the reader's
 * language. Forced left to right (`dir="ltr"`, on the element or an ancestor),
 * an Arabic date that starts with its day shows the day LAST:
 * «نوفمبر 2026، 12:00 17». The DOM text is the same either way, so the
 * direction is what this asserts; the text checks come first, so a missing or
 * empty span cannot pass for a correct one.
 *
 * `check:formatting` keeps the same rule in source; this pins it per screen.
 */
export function expectArabicDateInPageDirection(
  span: Element | null | undefined,
  parts: { day: string; month: string; time?: string },
): void {
  // Non-vacuity: the span exists and holds the date, day first, month after it,
  // the time (for a date-time) last.
  expect(span).withContext('the date is rendered').toBeTruthy();
  const text = (span?.textContent ?? '').replace(/\s+/g, ' ').trim();
  expect(text.length).withContext('the date is not empty').toBeGreaterThan(0);
  expect(text.startsWith(parts.day)).withContext(`"${text}" starts with the day`).toBeTrue();
  expect(text.indexOf(parts.month)).withContext(`"${text}": the month after the day`).toBeGreaterThan(parts.day.length - 1);
  if (parts.time) expect(text.endsWith(parts.time)).withContext(`"${text}" ends with the time`).toBeTrue();

  // The rule: nothing on the page forces it left to right. The document root is
  // left out: its direction is the page's own (LanguageService sets it), and a
  // spec's document is left to right unless it switched it.
  expect(span!.getAttribute('dir')).withContext(`"${text}" carries no dir`).toBeNull();
  expect(ltrAncestor(span!)).withContext(`"${text}" sits inside no dir="ltr"`).toBeNull();
}

function ltrAncestor(element: Element): Element | null {
  for (let e = element.parentElement; e && e !== document.documentElement; e = e.parentElement) {
    if (e.getAttribute('dir') === 'ltr') return e;
  }
  return null;
}

/**
 * CC-326 — the same rule for an Arabic PHRASE around a formatted date or time
 * («منذ 5 نوفمبر 2026», «دخلت هذه المرحلة قبل يومين»): it takes the page's
 * direction too. Non-vacuity first: the span exists and starts with the phrase.
 */
export function expectPhraseInPageDirection(span: Element | null | undefined, startsWith: string): void {
  expect(span).withContext('the phrase is rendered').toBeTruthy();
  const text = (span?.textContent ?? '').replace(/\s+/g, ' ').trim();
  expect(text.startsWith(startsWith)).withContext(`"${text}" starts with "${startsWith}"`).toBeTrue();
  expect(span!.getAttribute('dir')).withContext(`"${text}" carries no dir`).toBeNull();
  expect(ltrAncestor(span!)).withContext(`"${text}" sits inside no dir="ltr"`).toBeNull();
}
