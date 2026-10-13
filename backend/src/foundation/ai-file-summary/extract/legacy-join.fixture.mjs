// ACC-224 test fixture — the PDF worker's text join EXACTLY as it was before
// ACC-224, kept as the reference that "unchanged" files are compared against
// (pdf-arabic-order.spec.ts). It sends each page's old text as ONE item, so the
// extractor hands it on as stored, followed by a single space.
// Named *.fixture.mjs, not *.worker.mjs, so `nest build` does not ship it.
import { parentPort, workerData } from 'node:worker_threads';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

const { bytes, maxPages, standardFontDataUrl } = workerData;

let task;
try {
  task = pdfjs.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, standardFontDataUrl, verbosity: 0 });
  const doc = await task.promise;
  parentPort.postMessage({ type: 'meta', numPages: doc.numPages });
  const last = Math.min(doc.numPages, maxPages);
  for (let n = 1; n <= last; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    // ---- the pre-ACC-224 join, verbatim ----
    let text = '';
    for (const item of content.items) {
      if (!('str' in item)) continue;
      text += item.str;
      text += item.hasEOL ? '\n' : ' ';
    }
    // ----------------------------------------
    page.cleanup();
    parentPort.postMessage({ type: 'page', n, items: [{ s: text, rtl: false, x: 0, y: 0, w: 0, size: 0, eol: false }] });
  }
  parentPort.postMessage({ type: 'done' });
} catch (error) {
  parentPort.postMessage({ type: 'error', name: error && error.name ? String(error.name) : 'Error' });
} finally {
  if (task) await task.destroy().catch(() => undefined);
}
