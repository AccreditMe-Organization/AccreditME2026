/**
 * ACC-189 — pdf.js, loaded the first time someone opens a PDF and never before
 * (Ahmad, 10 Oct, D5), so it is not in the main bundle.
 *
 * The LEGACY build: the modern one targets only the newest browsers, and our
 * floor is Safari 16.4 / Firefox 115 (CLAUDE.md, Supported Browsers).
 *
 * Hardening, and what each line rests on:
 * - EVAL: pdf.js 6 has no eval or `new Function` path at all — the old
 *   `isEvalSupported` option (the CVE-2024-4367 class) is gone because the
 *   code it guarded is gone. Verified in the shipped build, not assumed.
 * - SCRIPTING: PDF JavaScript runs only through `pdf.sandbox` and its QuickJS
 *   wasm. Neither is shipped: `angular.json` copies the wasm folder WITHOUT
 *   `quickjs-eval.*`, and nothing imports the sandbox.
 * - XFA forms off; annotation links are not made clickable (the viewer draws
 *   the canvas only — D4, no text layer).
 * - Image decoders (JBIG2, JPEG 2000, colour profiles) come from our own
 *   origin; if wasm is refused, pdf.js uses their plain-JS fallbacks.
 */
import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfJsModule = typeof PdfJs;

const ASSETS = 'assets/pdfjs/';

let loading: Promise<PdfJsModule> | null = null;

function assetUrl(path: string): string {
  return new URL(`${ASSETS}${path}`, document.baseURI).href;
}

export function loadPdfJs(): Promise<PdfJsModule> {
  loading ??= import('pdfjs-dist/legacy/build/pdf.mjs')
    .then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = assetUrl('pdf.worker.min.mjs');
      return pdfjs;
    })
    .catch((error: unknown) => {
      loading = null; // a failed chunk load may succeed next time
      throw error;
    });
  return loading;
}

/** The options every PDF is opened with — in one place, so a spec can pin them. */
export function pdfDocumentOptions(data: Uint8Array) {
  return {
    data,
    enableXfa: false,
    cMapUrl: assetUrl('cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    iccUrl: assetUrl('iccs/'),
    useSystemFonts: false,
    stopAtErrors: false,
  };
}
