// ACC-193 — reads a PDF's text in a worker thread, one page at a time.
//
// Plain JavaScript on purpose: pdfjs-dist is an ES module, which the backend's
// Jest (CommonJS) cannot load into its own registry, while a worker thread is
// loaded by Node natively — in tests and in production alike. `nest build`
// copies `*.worker.mjs` into dist/ beside the compiled extractor (nest-cli.json).
//
// It also keeps a large PDF off the API's event loop, and the parent caps its
// memory and time (pdf-text-extractor.ts).
//
// workerData: { bytes: Uint8Array, maxPages: number, standardFontDataUrl: string }
// Messages, in order:
//   { type: 'meta', numPages }
//   { type: 'page', n, items }     — once per page, n = 1, 2, …, up to maxPages;
//                                    items: { s, rtl, x, y, w, size, eol }[]. The text
//                                    is built on the main thread, in reading order, by
//                                    pdf-page-text.ts (ACC-224).
//   { type: 'done' }
//   { type: 'error', name }        — the PDF could not be read (corrupt, protected, …)
// The parent may terminate the worker at any point, e.g. when its token budget is spent.

import { parentPort, workerData } from 'node:worker_threads';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const { bytes, maxPages, standardFontDataUrl } = workerData;

let task;
try {
  task = pdfjs.getDocument({
    data: bytes,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    standardFontDataUrl,
    verbosity: 0,
  });
  const doc = await task.promise;
  parentPort.postMessage({ type: 'meta', numPages: doc.numPages });
  const last = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= last; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const [, , c, d, x, y] = item.transform;
      items.push({ s: item.str, rtl: item.dir === 'rtl', x, y, w: item.width, size: Math.hypot(c, d), eol: Boolean(item.hasEOL) });
    }
    page.cleanup();
    parentPort.postMessage({ type: 'page', n, items });
  }
  parentPort.postMessage({ type: 'done' });
} catch (error) {
  // The name only (InvalidPDFException, PasswordException, …): never the file's content.
  parentPort.postMessage({ type: 'error', name: error && error.name ? String(error.name) : 'Error' });
} finally {
  if (task) await task.destroy().catch(() => undefined);
}
