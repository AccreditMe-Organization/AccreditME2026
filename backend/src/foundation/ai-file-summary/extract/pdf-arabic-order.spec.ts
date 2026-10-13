import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileText } from './file-text';
import { PdfTextExtractor } from './pdf-text-extractor';
import { makePdf } from './pdf-fixture';

// ACC-224 — real PDFs from real generators (fixtures/README.md), read through
// the real worker and readFileText(), i.e. exactly what the model receives.

// Real pdfjs in real worker threads (see file-text.spec.ts).
jest.setTimeout(30_000);

const FIXTURES = join(__dirname, 'fixtures');
const LEGACY = join(__dirname, 'legacy-join.fixture.mjs');
const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

const pdf = new PdfTextExtractor();
const legacy = new PdfTextExtractor({ workerFile: LEGACY });

async function modelText(bytes: Uint8Array): Promise<string> {
  return (await readFileText('pdf', bytes, 100_000, pdf)).text;
}

/** Each page's raw text from the extractor (before normalisation). */
async function rawPages(extractor: PdfTextExtractor, bytes: Uint8Array): Promise<string[]> {
  const pages: string[] = [];
  await extractor.read(bytes, { maxPages: 100, onPage: (_n, text) => pages.push(text) > 0 });
  return pages;
}

describe('ACC-224 — a line stored in visual order is read in reading order (Chrome)', () => {
  it('chrome-ar.pdf: Arabic, as it was typed', async () => {
    expect(await modelText(fixture('chrome-ar.pdf'))).toBe(
      [
        '[page 1]',
        'سياسة نظافة اليدين (وثيقة اختبار)',
        'تحدد هذه السياسة قواعد نظافة اليدين في جميع الأقسام السريرية للحد من العدوى.',
        'يدقق فريق مكافحة العدوى الالتزام شهرياً في كل جناح.',
      ].join('\n'),
    );
  });

  it('chrome-mixed.pdf: a code, a year, a percentage and a Latin phrase keep their own order', async () => {
    expect(await modelText(fixture('chrome-mixed.pdf'))).toBe(
      [
        '[page 1]',
        'تطبق السياسة IPC-07 منذ عام 2026، والهدف التزام بنسبة 95% في كل جناح.',
        'راجع دليل Hand Hygiene Audit قبل 14 يوماً من التدقيق.',
      ].join('\n'),
    );
  });

  it('chrome-hard.pdf: a date, Arabic-Indic digits, a decimal, brackets, a wrapped paragraph, an English line quoting Arabic', async () => {
    expect(await modelText(fixture('chrome-hard.pdf'))).toBe(
      [
        '[page 1]',
        'صدرت في 12/10/2026 برقم ١٤٤٧ ورمزها (IPC) والنسخة 3.5 من الدليل.',
        'يتواصل التدقيق في جناح 4B ومنطقة ICU-2 كل أسبوع، ويرفع التقرير إلى لجنة مكافحة العدوى قبل نهاية',
        'الشهر، وتبقى النسخ في سجل الجودة لمدة 10 سنوات على الأقل.',
        'The ward is called الجناح الشرقي and its code is E-4.',
      ].join('\n'),
    );
  });

  it('Q1: no Persian yeh or heh survives in a reordered line', async () => {
    for (const name of ['chrome-ar.pdf', 'chrome-mixed.pdf', 'chrome-hard.pdf']) {
      expect(await modelText(fixture(name))).not.toMatch(/[یھ]/);
    }
  });
});

describe('ACC-224 — every other file is read exactly as before', () => {
  // The reference is the pre-ACC-224 join, run by legacy-join.fixture.mjs. It
  // arrives as one stored item, so the extractor adds exactly one space after it.
  const unchanged: Array<[string, () => Uint8Array]> = [
    ['word-ar.pdf (Arabic in logical order)', () => fixture('word-ar.pdf')],
    ['word-mixed.pdf (mixed lines in logical order)', () => fixture('word-mixed.pdf')],
    ['chrome-en.pdf (English)', () => fixture('chrome-en.pdf')],
    ['a generated English PDF (pdf-fixture.ts)', () => makePdf(['Infection control policy', 'Hand hygiene section', null])],
  ];

  it.each(unchanged)('%s: character for character', async (_name, bytes) => {
    const before = await rawPages(legacy, bytes());
    const after = await rawPages(pdf, bytes());
    // Non-vacuity: the reference really read text, on every page there is.
    expect(before.length).toBeGreaterThan(0);
    expect(before.join('').trim().length).toBeGreaterThan(0);
    expect(after.map((text) => `${text} `)).toEqual(before);
  });

  it('word-ar.pdf keeps Word\'s own quirks, which are ACC-225\'s', async () => {
    expect(await modelText(fixture('word-ar.pdf'))).toBe(
      [
        '[page 1]',
        'سياسة نظافة اليدين ( وثيقة اختبار )',
        'تحدد هذه السياسة قواعد نظافة اليدين في جميع األقسام السريرية للحد من العدوى .',
        'يدقق فريق مكافحة العدوى االلتزام شهريا في كل جناح .',
      ].join('\n'),
    );
  });

  it('chrome-en.pdf reads as typed', async () => {
    expect(await modelText(fixture('chrome-en.pdf'))).toBe(
      [
        '[page 1]',
        'Hand Hygiene Policy IPC-07 (test document)',
        'Staff clean their hands at the five moments. The target is 95% compliance in 2026.',
        'Wards below 80% for two months submit a corrective action plan within 14 days.',
      ].join('\n'),
    );
  });
});
