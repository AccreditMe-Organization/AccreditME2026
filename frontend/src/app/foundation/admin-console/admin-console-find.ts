// ACC-292 — "Find a setting" on the Administration console: which cards a
// query keeps, and where to mark it. Pure functions, so the rule is testable
// without a page.
//
// A card matches when the query is found in its name or its line, in EITHER
// language, or in one of its synonyms ("smtp" finds Email Provider). Case and
// Arabic marks are ignored: "تقويم" finds «التقويم الرسمي», and a query typed
// without a shadda still finds «كلًّا».
//
// The mark is drawn only on the text the reader sees. In Arabic it covers the
// whole word (the design's rule), so a mark never cuts joined letters apart.

export interface MarkSegment {
  text: string;
  mark: boolean;
}

export interface FindCandidate {
  /** Name and line in English and in Arabic (whatever is loaded). */
  texts: readonly string[];
  synonyms: readonly string[];
}

// Harakat, the superscript alef and the tatweel: written on some words, never
// typed in a search.
const ARABIC_MARKS = /[ً-ٰٟـ]/;
const ARABIC_LETTER = /[؀-ۿ]/;
// A word ends at a space or at punctuation.
const WORD_END = /[\s.,،؛:;!?()«»"“”]/;

function foldChar(ch: string): string {
  switch (ch) {
    case 'أ':
    case 'إ':
    case 'آ':
      return 'ا';
    case 'ى':
      return 'ي';
    default:
      return ch.toLowerCase();
  }
}

/** The text as the matcher reads it, and where each of its characters came from. */
function fold(text: string): { folded: string; from: number[] } {
  let folded = '';
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ARABIC_MARKS.test(ch)) continue;
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) from.push(i);
    folded += f;
  }
  return { folded, from };
}

export function foldForFind(text: string): string {
  return fold(text).folded.trim();
}

export function matchesFind(candidate: FindCandidate, query: string): boolean {
  const q = foldForFind(query);
  if (!q) return true;
  return (
    candidate.texts.some((text) => fold(text).folded.includes(q)) ||
    candidate.synonyms.some((synonym) => foldForFind(synonym).includes(q))
  );
}

/**
 * The text cut into segments with the first match marked, or null when the
 * query is not in this text (the caller then shows it plain).
 */
export function markFind(text: string, query: string): MarkSegment[] | null {
  const q = foldForFind(query);
  if (!q) return null;
  const { folded, from } = fold(text);
  const at = folded.indexOf(q);
  if (at < 0) return null;

  let start = from[at]!;
  let end = from[at + q.length - 1]! + 1;
  // Marks written after the last matched letter belong to it.
  while (end < text.length && ARABIC_MARKS.test(text[end]!)) end++;
  if (ARABIC_LETTER.test(q)) {
    while (start > 0 && !WORD_END.test(text[start - 1]!)) start--;
    while (end < text.length && !WORD_END.test(text[end]!)) end++;
  }

  return [
    { text: text.slice(0, start), mark: false },
    { text: text.slice(start, end), mark: true },
    { text: text.slice(end), mark: false },
  ].filter((segment) => segment.text.length > 0);
}
