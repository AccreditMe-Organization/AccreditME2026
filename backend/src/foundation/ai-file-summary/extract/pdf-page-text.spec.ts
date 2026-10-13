import { IPdfTextItem, WORD_GAP_EM, isVisualOrderLine, pageText } from './pdf-page-text';

// ACC-224 — hand-built item lists, for the cases a real fixture cannot pin
// cheaply. The real PDFs are in pdf-arabic-order.spec.ts.

const SIZE = 10;
const GLYPH = 5;
const SPACE = 2.8; // 0.28 em — Arial's space, as measured on Chrome's output
const RTL_LETTER = /\p{Script=Arabic}/u;

/** The reverse of an Arabic word: the order its glyphs sit on the page, left to right. */
const rev = (s: string): string => [...s].reverse().join('');

/**
 * A line as Chrome stores it: segments in VISUAL order, left to right. An
 * Arabic segment becomes one item per glyph; anything else one item; ' ' a
 * space item. `gap` is the space between items, in page units.
 */
function visualLine(segments: string[], opts: { spaces?: boolean; gap?: number; y?: number; eol?: boolean } = {}): IPdfTextItem[] {
  const items: IPdfTextItem[] = [];
  let x = 0;
  const push = (s: string, rtl: boolean, w: number): void => {
    items.push({ s, rtl, x, y: opts.y ?? 700, w, size: SIZE, eol: false });
    x += w + (opts.gap ?? 0);
  };
  for (const segment of segments) {
    if (segment === ' ') {
      if (opts.spaces === false) x += SPACE;
      else push(' ', false, SPACE);
    } else if (RTL_LETTER.test(segment)) {
      for (const glyph of segment) push(glyph, true, GLYPH);
    } else {
      push(segment, false, GLYPH * segment.length);
    }
  }
  if (opts.eol) items.push({ s: '', rtl: false, x: 0, y: (opts.y ?? 700) - 15, w: 0, size: 0, eol: true });
  return items;
}

/** A line as Word stores it: whole words in reading order, x DECREASING for Arabic. */
function logicalRtlLine(words: string[]): IPdfTextItem[] {
  let x = 500;
  return words.map((s) => {
    x -= GLYPH * s.length + SPACE;
    return { s, rtl: RTL_LETTER.test(s), x, y: 700, w: GLYPH * s.length, size: SIZE, eol: false };
  });
}

function logicalLtrLine(words: string[]): IPdfTextItem[] {
  let x = 0;
  return words.map((s) => {
    const item = { s, rtl: false, x, y: 700, w: GLYPH * s.length, size: SIZE, eol: false };
    x += item.w + SPACE;
    return item;
  });
}

/** The join exactly as it was before ACC-224 — written out here, not imported. */
function joinAsBefore(items: IPdfTextItem[]): string {
  let text = '';
  for (const item of items) text += item.s + (item.eol ? '\n' : ' ');
  return text;
}

describe('pageText — a visual-order line (ACC-224 §2.3)', () => {
  it('reads an Arabic line in reading order, words spaced by Chrome\'s space items', () => {
    const items = visualLine([rev('اليدين'), ' ', rev('نظافة'), ' ', rev('سياسة')]);
    expect(isVisualOrderLine(items)).toBe(true);
    expect(pageText(items).trim()).toBe('سياسة نظافة اليدين');
  });

  it('the same line with every space item removed reads the same: the gap rule', () => {
    const withSpaces = visualLine([rev('اليدين'), ' ', rev('نظافة'), ' ', rev('سياسة')]);
    const gapsOnly = visualLine([rev('اليدين'), ' ', rev('نظافة'), ' ', rev('سياسة')], { spaces: false });
    expect(gapsOnly.some((item) => item.s === ' ')).toBe(false);
    expect(pageText(gapsOnly)).toBe(pageText(withSpaces));
  });

  it(`a gap of 0.1 em is not a word space; 0.2 em is (the threshold is ${WORD_GAP_EM} em)`, () => {
    expect(pageText(visualLine([rev('نظافة')], { gap: 0.1 * SIZE })).trim()).toBe('نظافة');
    // Two glyphs 0.2 em apart are two words, read right to left.
    expect(pageText(visualLine([rev('نظ')], { gap: 0.2 * SIZE })).trim()).toBe('ن ظ');
  });

  it('a number after Arabic keeps its percent sign after it: "95%", not "%95"', () => {
    const items = visualLine([rev('في'), ' ', '%', '95', ' ', rev('بنسبة')]);
    expect(pageText(items).trim()).toBe('بنسبة 95% في');
  });

  it('a code and a date inside an Arabic sentence keep their own order', () => {
    const items = visualLine([rev('من'), ' ', '12/10/2026', ' ', 'IPC-07', ' ', rev('السياسة'), ' ', rev('راجع')]);
    expect(pageText(items).trim()).toBe('راجع السياسة IPC-07 12/10/2026 من');
  });

  it('known limit (§3): a fragment whose letters are mostly Latin takes a left-to-right base', () => {
    // Two Arabic letters against seven Latin: the words stay right, their order does not.
    const items = visualLine(['ICU-2 ward', ' ', rev('في')]);
    expect(pageText(items).trim()).toBe('ICU-2 ward في');
  });

  it('Arabic-Indic digits inside an rtl item keep their order: ١٤٤٧', () => {
    // pdfjs labels a run of Arabic-Indic digits rtl but keeps them in reading order.
    const items = visualLine([rev('ورمزها'), ' ']);
    items.push({ s: '١٤٤٧', rtl: true, x: 60, y: 700, w: 20, size: SIZE, eol: false });
    items.push({ s: ' ', rtl: false, x: 80, y: 700, w: SPACE, size: SIZE, eol: false });
    for (const [i, glyph] of [...rev('برقم')].entries()) items.push({ s: glyph, rtl: true, x: 83 + i * GLYPH, y: 700, w: GLYPH, size: SIZE, eol: false });
    expect(pageText(items).trim()).toBe('برقم ١٤٤٧ ورمزها');
  });

  it('a tanween drawn as its own item joins the glyph it sits over', () => {
    // يوماً: the tanween item sits over the alef, the leftmost glyph.
    const items = visualLine([rev('يوما')]);
    items.push({ s: ' ً', rtl: false, x: items[0]!.x + 1, y: 701.5, w: 0, size: SIZE, eol: false });
    expect(pageText(items).trim()).toBe('يوماً');
  });

  it('an English line quoting a visual-order Arabic phrase keeps a left-to-right base', () => {
    const items = visualLine(['The ward is called', ' ', rev('الشرقي'), ' ', rev('الجناح'), ' ', 'and its code is E-4.']);
    expect(pageText(items).trim()).toBe('The ward is called الجناح الشرقي and its code is E-4.');
  });

  it('on a tie of letters, the page\'s majority decides the line\'s base direction', () => {
    // Four Arabic letters, four Latin ones: the Arabic line above decides (rtl).
    const tie = visualLine(['ABCD', ' ', rev('سجلا')], { y: 650 });
    const arabicLine = visualLine([rev('الجودة'), ' ', rev('سجل')], { y: 700, eol: true });
    expect(pageText([...arabicLine, ...tie]).split('\n')[1]!.trim()).toBe('سجلا ABCD');
    const englishLine = visualLine(['Quality records', ' ', rev('سجل')], { y: 700, eol: true });
    expect(pageText([...englishLine, ...tie]).split('\n')[1]!.trim()).toBe('ABCD سجلا');
  });

  it('a character outside the Basic Multilingual Plane survives the reordering whole', () => {
    const items = visualLine([rev('ملف'), ' ', '📄']);
    expect(pageText(items).trim()).toBe('📄 ملف');
  });

  it('Q1: Persian yeh and heh forms are folded to Arabic letters in a reordered line', () => {
    // "يدين" and "الهدف" as Chrome maps them: ﯾ (U+FBFE, Persian yeh initial)
    // and ﮭ (U+FBAD, heh doachashmee medial).
    expect(pageText(visualLine([rev('ﯾدﯾن')])).trim()).toBe('يدين');
    expect(pageText(visualLine([rev('الﮭدف')])).trim()).toBe('الهدف');
  });

  it('a baseline jump starts a new line even with no end-of-line mark', () => {
    const first = visualLine([rev('نظافة'), ' ', rev('سياسة')], { y: 700 });
    const second = visualLine([rev('اليدين')], { y: 680 });
    expect(pageText([...first, ...second])).toBe('سياسة نظافة اليدين ');
  });
});

describe('pageText — every other line is exactly as before (ACC-224 §4)', () => {
  it('an English line', () => {
    const items = logicalLtrLine(['Hand', 'hygiene', 'audit,', 'ward', '4B,', '58%']);
    expect(isVisualOrderLine(items)).toBe(false);
    expect(pageText(items)).toBe(joinAsBefore(items));
  });

  it('an Arabic line stored in reading order (Word), Persian forms and all', () => {
    const items = logicalRtlLine(['تطبق', 'السیاسة', 'IPC-07', 'منذ', 'عام', '2026', '،']);
    expect(isVisualOrderLine(items)).toBe(false);
    expect(pageText(items)).toBe(joinAsBefore(items));
  });

  it('a whole page of lines, end-of-line marks included', () => {
    const items: IPdfTextItem[] = [
      ...logicalLtrLine(['Purpose.', 'This', 'policy']),
      { s: '', rtl: false, x: 0, y: 680, w: 0, size: 0, eol: true },
      ...logicalRtlLine(['الغرض:', 'تحدد', 'هذه']).map((item) => ({ ...item, y: 680 })),
      { s: 'end', rtl: false, x: 10, y: 660, w: 15, size: SIZE, eol: true },
    ];
    expect(pageText(items)).toBe(joinAsBefore(items));
  });

  it('an Arabic line pdfjs returns as a single item has nothing to reorder', () => {
    const items: IPdfTextItem[] = [{ s: 'سياسة نظافة اليدين', rtl: true, x: 10, y: 700, w: 90, size: SIZE, eol: false }];
    expect(isVisualOrderLine(items)).toBe(false);
    expect(pageText(items)).toBe(joinAsBefore(items));
  });

  it('an empty page is empty', () => {
    expect(pageText([])).toBe('');
  });
});
