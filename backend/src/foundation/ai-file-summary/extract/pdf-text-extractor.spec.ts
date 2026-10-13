import { join } from 'node:path';
import { PdfTextExtractor, PdfUnreadableError } from './pdf-text-extractor';
import { ExtractionBusyError } from './extraction-slots';
import { makePdf } from './pdf-fixture';

// ACC-193 — real pdfjs-dist, in a real worker thread, under Jest (§4.1).
const HANG = join(__dirname, 'hang.fixture.mjs');

async function readAll(extractor: PdfTextExtractor, pdf: Uint8Array, maxPages = 100, stopAfter = Infinity, deadline?: number) {
  const pages: string[] = [];
  const result = await extractor.read(pdf, {
    maxPages,
    deadline,
    onPage: (n, text) => {
      pages.push(`${n}:${text.trim()}`);
      return n < stopAfter;
    },
  });
  return { ...result, pages };
}

describe('PdfTextExtractor (ACC-193)', () => {
  it('reads every page\'s text, in order, and the page count', async () => {
    const result = await readAll(new PdfTextExtractor(), makePdf(['Hand hygiene audit', 'Ward 4B', 'Night shift 58 percent']));
    expect(result).toEqual({ numPages: 3, pages: ['1:Hand hygiene audit', '2:Ward 4B', '3:Night shift 58 percent'] });
  });

  it('reads no page past maxPages, and still reports the whole count', async () => {
    const result = await readAll(new PdfTextExtractor(), makePdf(['a', 'b', 'c', 'd']), 2);
    expect(result).toEqual({ numPages: 4, pages: ['1:a', '2:b'] });
  });

  it('stops at once when onPage says so (the token budget)', async () => {
    const extractor = new PdfTextExtractor();
    const result = await readAll(extractor, makePdf(['a', 'b', 'c', 'd']), 100, 2);
    expect(result.pages).toEqual(['1:a', '2:b']);
    expect(extractor.activeWorkers).toBe(0);
  });

  it('a page with no text (a scan) comes back empty, not missing', async () => {
    const result = await readAll(new PdfTextExtractor(), makePdf([null, 'text']));
    expect(result.pages).toEqual(['1:', '2:text']);
  });

  it('bytes that are not a PDF → PdfUnreadableError, and the slot is given back', async () => {
    const extractor = new PdfTextExtractor();
    await expect(readAll(extractor, Buffer.from('this is not a pdf at all'))).rejects.toBeInstanceOf(PdfUnreadableError);
    expect(extractor.activeWorkers).toBe(0);
  });

  it('the deadline passing while reading → PdfUnreadableError("timeout"), and the worker is stopped', async () => {
    const extractor = new PdfTextExtractor({ timeoutMs: 300, workerFile: HANG });
    const error = await readAll(extractor, makePdf(['x'])).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PdfUnreadableError);
    expect((error as PdfUnreadableError).reason).toBe('timeout');
    expect(extractor.activeWorkers).toBe(0);
  });

  it('§14.1: with every slot busy, a third read waits — and is refused busy at its deadline, never run', async () => {
    const extractor = new PdfTextExtractor({ slots: 2, workerFile: HANG });
    // The first two hold their slots for 1 s; the third may wait only 150 ms.
    const first = readAll(extractor, makePdf(['1']), 100, Infinity, Date.now() + 1000).catch((e: unknown) => e);
    const second = readAll(extractor, makePdf(['2']), 100, Infinity, Date.now() + 1000).catch((e: unknown) => e);
    expect(extractor.activeWorkers).toBe(2);
    const third = await readAll(extractor, makePdf(['3']), 100, Infinity, Date.now() + 150).catch((e: unknown) => e);
    expect(third).toBeInstanceOf(ExtractionBusyError);
    expect(await first).toBeInstanceOf(PdfUnreadableError);
    expect(await second).toBeInstanceOf(PdfUnreadableError);
    expect(extractor.activeWorkers).toBe(0);
  });

  it('§14.1: a waiting read gets the slot as soon as one frees, within its own deadline', async () => {
    const extractor = new PdfTextExtractor({ slots: 1, timeoutMs: 20_000 });
    const [a, b] = await Promise.all([readAll(extractor, makePdf(['first'])), readAll(extractor, makePdf(['second']))]);
    expect(a.pages).toEqual(['1:first']);
    expect(b.pages).toEqual(['1:second']);
    expect(extractor.activeWorkers).toBe(0);
  });
});
