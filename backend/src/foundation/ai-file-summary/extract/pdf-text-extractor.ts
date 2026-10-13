import { Inject, Injectable, Optional } from '@nestjs/common';
import { Worker } from 'node:worker_threads';
import { dirname, join, sep } from 'node:path';
import { ExtractionBusyError, ExtractionSlots } from './extraction-slots';

/** ACC-193 — the PDF could not be read: corrupt, protected, too large to parse, or too slow. */
export class PdfUnreadableError extends Error {
  constructor(readonly reason: string) {
    super(`PDF could not be read (${reason})`);
    this.name = 'PdfUnreadableError';
  }
}

export interface IPdfReadOptions {
  /** Read no page past this one. */
  maxPages: number;
  /**
   * Called with each page's text, in order. Return false to stop: the worker
   * is terminated at once and no further page is read (the token budget, §4.3).
   */
  onPage: (n: number, text: string) => boolean;
  /**
   * Epoch ms by which a slot must be held AND the reading done (§14.1). Default:
   * now + PDF_READ_TIMEOUT_MS. The service passes one deadline for the whole press.
   */
  deadline?: number;
}

/** Test-only overrides: fewer or more slots, a shorter timeout, a stand-in worker. */
export interface IPdfExtractorOptions {
  slots?: number;
  timeoutMs?: number;
  workerFile?: string;
}
export const PDF_EXTRACTOR_OPTIONS = Symbol('PDF_EXTRACTOR_OPTIONS');

export interface IPdfReadResult {
  numPages: number;
}

/** §14.1 — at most two PDF workers per process; §4.1 — 512 MB and 30 s each. */
export const PDF_WORKER_SLOTS = 2;
export const PDF_WORKER_MEMORY_MB = 512;
export const PDF_READ_TIMEOUT_MS = 30_000;

const WORKER_FILE = join(__dirname, 'pdf-text.worker.mjs');
// pdfjs wants '/' and a trailing '/', on every platform (a Windows path with '\' is refused).
const STANDARD_FONTS = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts').split(sep).join('/') + '/';

/**
 * ACC-193 — reads a PDF's text in a worker thread (pdf-text.worker.mjs).
 *
 * ONE deadline covers both waiting for a slot and reading (§14.1): a press
 * that waited 20 s has 10 s left to read. No slot in time → ExtractionBusyError
 * (from ExtractionSlots); the deadline passing while reading, a crash, the
 * memory cap, or a PDF pdfjs refuses → PdfUnreadableError. The slot is
 * always given back.
 */
@Injectable()
export class PdfTextExtractor {
  private readonly slots: ExtractionSlots;

  private readonly options: IPdfExtractorOptions;

  constructor(@Optional() @Inject(PDF_EXTRACTOR_OPTIONS) options?: IPdfExtractorOptions) {
    this.options = options ?? {};
    this.slots = new ExtractionSlots(this.options.slots ?? PDF_WORKER_SLOTS);
  }

  /** Slots in use — for tests. */
  get activeWorkers(): number {
    return this.slots.active;
  }

  async read(bytes: Uint8Array, opts: IPdfReadOptions): Promise<IPdfReadResult> {
    const deadline = opts.deadline ?? Date.now() + (this.options.timeoutMs ?? PDF_READ_TIMEOUT_MS);
    const release = await this.slots.acquire(deadline);
    try {
      // A slot that came free with no time left to read is no slot at all: busy, not unreadable.
      if (Date.now() >= deadline) throw new ExtractionBusyError();
      return await this.runWorker(bytes, opts, deadline);
    } finally {
      release();
    }
  }

  private runWorker(bytes: Uint8Array, opts: IPdfReadOptions, deadline: number): Promise<IPdfReadResult> {
    return new Promise<IPdfReadResult>((resolve, reject) => {
      const worker = new Worker(this.options.workerFile ?? WORKER_FILE, {
        // A copy, so the caller's buffer is never detached.
        workerData: { bytes: new Uint8Array(bytes), maxPages: opts.maxPages, standardFontDataUrl: STANDARD_FONTS },
        resourceLimits: { maxOldGenerationSizeMb: PDF_WORKER_MEMORY_MB },
      });
      let numPages = 0;
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        void worker.terminate();
        fn();
      };
      const timer = setTimeout(
        () => finish(() => reject(new PdfUnreadableError('timeout'))),
        Math.max(0, deadline - Date.now()),
      );

      worker.on('message', (message: { type: string; numPages?: number; n?: number; text?: string; name?: string }) => {
        if (settled) return;
        if (message.type === 'meta') {
          numPages = message.numPages ?? 0;
        } else if (message.type === 'page') {
          let more = false;
          try {
            more = opts.onPage(message.n ?? 0, message.text ?? '');
          } catch (error) {
            finish(() => reject(error instanceof Error ? error : new Error(String(error))));
            return;
          }
          if (!more) finish(() => resolve({ numPages }));
        } else if (message.type === 'done') {
          finish(() => resolve({ numPages }));
        } else if (message.type === 'error') {
          finish(() => reject(new PdfUnreadableError(message.name ?? 'Error')));
        }
      });
      // A crash, the memory cap (ERR_WORKER_OUT_OF_MEMORY), or an exit before 'done'.
      worker.on('error', (error: Error) => finish(() => reject(new PdfUnreadableError(error.name))));
      worker.on('exit', () => finish(() => reject(new PdfUnreadableError('exit'))));
    });
  }
}
