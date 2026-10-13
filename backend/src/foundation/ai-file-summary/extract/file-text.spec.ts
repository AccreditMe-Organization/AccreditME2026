import {
  MIN_LETTERS,
  SUMMARY_PAGE_CAP,
  SUMMARY_ROW_CAP,
  countLetters,
  cutToTokens,
  estimateTokens,
  normalizeText,
  readFileText,
  summarizableKind,
} from './file-text';
import { PdfTextExtractor } from './pdf-text-extractor';
import { makePdf } from './pdf-fixture';

const pdf = new PdfTextExtractor();
const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('summarizableKind (decision 3)', () => {
  it('PDF, CSV and TXT only — by the server\'s type', () => {
    expect(summarizableKind('application/pdf')).toBe('pdf');
    expect(summarizableKind('text/csv')).toBe('csv');
    expect(summarizableKind('text/plain')).toBe('txt');
    for (const other of ['image/png', 'image/heic', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel']) {
      expect(summarizableKind(other)).toBeNull();
    }
  });
});

describe('estimateTokens (§4.3) — deliberately high', () => {
  it('Latin: a third of the bytes, above the ~4 characters a token real text runs at', () => {
    const text = 'The hand hygiene audit found compliance of 58 percent on the night shift. '.repeat(10);
    expect(estimateTokens(text)).toBeGreaterThan(text.length / 4);
    expect(estimateTokens(text)).toBe(Math.ceil(text.length / 3));
  });

  it('Arabic: two bytes a character, so 1.5 characters a token', () => {
    const text = 'بلغ الامتثال لنظافة اليدين في الجناح';
    expect(estimateTokens(text)).toBe(Math.ceil(Buffer.byteLength(text, 'utf8') / 3));
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(Math.ceil(text.replace(/ /g, '').length / 1.5));
  });
});

describe('normalizeText', () => {
  it('folds Arabic presentation forms (NFKC), as PDFs often carry them', () => {
    // U+FEFB is the presentation-form "lam-alef" ligature; NFKC makes it ل + ا.
    expect(normalizeText('ﻻ')).toBe('لا');
  });

  it('collapses spaces, keeps single line breaks, drops control characters', () => {
    expect(normalizeText('  a    b\u0007\r\n\r\n\r\n\r\nc  ')).toBe('a b\n\nc');
  });

  it('keeps tabs: a CSV row is sent tab-separated', () => {
    expect(normalizeText('ward\tscore')).toBe('ward\tscore');
  });
});

describe('cutToTokens', () => {
  it('returns text that fits as it is, and cuts what does not to the budget', () => {
    expect(cutToTokens('short', 100)).toBe('short');
    const long = 'word '.repeat(1000);
    const cut = cutToTokens(long, 50);
    expect(estimateTokens(cut)).toBeLessThanOrEqual(50);
    expect(cut.length).toBeGreaterThan(100);
  });

  it('never splits a surrogate pair', () => {
    const cut = cutToTokens('😀'.repeat(100), 10);
    expect(cut).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});

describe('readFileText — PDF (decision 5)', () => {
  it('reads every page with a page marker, and counts them', async () => {
    const result = await readFileText('pdf', makePdf(['Infection control policy', 'Hand hygiene section']), 10_000, pdf);
    expect(result).toEqual({
      text: '[page 1]\nInfection control policy\n[page 2]\nHand hygiene section',
      unit: 'pages',
      unitsRead: 2,
      unitsTotal: 2,
      letters: countLetters('page Infection control policy page Hand hygiene section'),
    });
  });

  it('stops at the 100-page cap and still knows the whole count', async () => {
    const result = await readFileText('pdf', makePdf(Array.from({ length: SUMMARY_PAGE_CAP + 1 }, (_, i) => `Page ${i + 1}`)), 100_000, pdf);
    expect(result.unitsRead).toBe(100);
    expect(result.unitsTotal).toBe(101);
    expect(result.text).toContain('[page 100]\nPage 100');
    expect(result.text).not.toContain('[page 101]');
  });

  it('stops at the token budget, at a page boundary: N counts only whole pages read', async () => {
    // Short enough to stay on one line: the fixture's page clips a longer line at its edge.
    const page = 'Section text that takes some room on this page.';
    const one = estimateTokens(`[page 1]\n${normalizeText(page)}`) + 1;
    const result = await readFileText('pdf', makePdf([page, page, page, page]), one * 2 + 5, pdf);
    expect(result.unitsRead).toBe(2);
    expect(result.unitsTotal).toBe(4);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(one * 2 + 5);
  });

  it('page 1 alone over the budget is cut, and counts as one page read', async () => {
    const result = await readFileText('pdf', makePdf(['A long first page. '.repeat(50), 'second']), 40, pdf);
    expect(result.unitsRead).toBe(1);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(40);
  });

  it('a scanned PDF has no letters to read (decision 6)', async () => {
    const result = await readFileText('pdf', makePdf([null, null]), 10_000, pdf);
    expect(result.letters).toBeLessThan(MIN_LETTERS);
    expect(result.unitsTotal).toBe(2);
  });
});

describe('readFileText — CSV', () => {
  it('reads the header and the rows, tab-separated, counting data rows', async () => {
    const result = await readFileText('csv', utf8('ward,compliance\n4B,58\n4C,79\n'), 10_000, pdf);
    expect(result).toEqual({ text: 'ward\tcompliance\n4B\t58\n4C\t79', unit: 'rows', unitsRead: 2, unitsTotal: 2, letters: countLetters('wardcomplianceBC') });
  });

  it('stops at 500 data rows and counts every record (the viewer\'s own cap)', async () => {
    const rows = Array.from({ length: 2140 }, (_, i) => `ward ${i},${i % 100}`);
    const result = await readFileText('csv', utf8(['ward,score', ...rows].join('\n')), 100_000, pdf);
    expect(result.unitsRead).toBe(SUMMARY_ROW_CAP);
    expect(result.unitsTotal).toBe(2140);
  });

  it('stops at the token budget', async () => {
    const rows = Array.from({ length: 400 }, (_, i) => `Ward number ${i},Some comment text here`);
    const result = await readFileText('csv', utf8(['ward,note', ...rows].join('\n')), 200, pdf);
    expect(result.unitsRead).toBeLessThan(400);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(200);
  });

  it('a CSV of numbers only has no letters to read', async () => {
    const result = await readFileText('csv', utf8('1,2,3\n4,5,6\n'), 10_000, pdf);
    expect(result.letters).toBeLessThan(MIN_LETTERS);
  });
});

describe('readFileText — TXT', () => {
  it('reads the whole file, the byte-order mark dropped', async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('Policy text, read in full.')]);
    const result = await readFileText('txt', bytes, 10_000, pdf);
    expect(result).toEqual({ text: 'Policy text, read in full.', unit: 'text', unitsRead: bytes.byteLength, unitsTotal: bytes.byteLength, letters: 20 });
  });

  it('a file over the budget is read from the start, and says it was partial', async () => {
    const bytes = utf8('A sentence of policy text. '.repeat(500));
    const result = await readFileText('txt', bytes, 100, pdf);
    expect(estimateTokens(result.text)).toBeLessThanOrEqual(100);
    expect(result.unitsRead).toBeLessThan(result.unitsTotal);
    expect(result.text.startsWith('A sentence of policy text.')).toBe(true);
  });
});
