import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Observable, Subscriber, of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { FileBytesEvent, FileBytesService } from './file-bytes.service';
import { FileViewerComponent } from './file-viewer.component';
import { IFileViewerRequest, IViewableFile } from './file-viewer.model';
import { IFileSummaryView, SummaryLanguage } from './file-summary.model';
import { PdfJsLoader } from './pdf-loader';

// ACC-193 — Summarize in the viewer: the header button, the panel above the
// file, and every state from the drawing.

const PDF: IViewableFile = { id: 'ev-1', name: 'IPC policy.pdf', mimeType: 'application/pdf', sizeBytes: 2_516_582 };
const IMG: IViewableFile = { id: 'ev-2', name: 'Isolation room 3.png', mimeType: 'image/png', sizeBytes: 3_100_000 };
const TXT: IViewableFile = { id: 'ev-3', name: 'Ward 6A observations.txt', mimeType: 'text/plain', sizeBytes: 6_000 };
const CSV: IViewableFile = { id: 'ev-4', name: 'Q3 surveillance.csv', mimeType: 'text/csv', sizeBytes: 412_000 };
const DOCX: IViewableFile = {
  id: 'ev-5',
  name: 'Infection control policy IPC-04.docx',
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  sizeBytes: 1_200_000,
};

const utf8 = (s: string): ArrayBuffer => new TextEncoder().encode(s).buffer as ArrayBuffer;
const OPEN: IFileSummaryView = { available: true, inProgress: false, summary: null };
const SAVED = (over: Partial<NonNullable<IFileSummaryView['summary']>> = {}): IFileSummaryView => ({
  available: true,
  inProgress: false,
  summary: {
    language: 'en',
    overview: 'The policy sets hand hygiene rules for every ward.',
    keyPoints: ['Gel before and after every contact', 'Monthly audits per ward'],
    madeAt: '2026-10-09T08:00:00.000Z',
    coverage: null,
    ...over,
  },
});
const refusal = (status: number, code: string, extra: Record<string, unknown> = {}) =>
  new HttpErrorResponse({ status, error: { statusCode: status, message: code, code, ...extra } });

class BytesStub {
  calls: { subscriber: Subscriber<FileBytesEvent> }[] = [];
  load(): Observable<FileBytesEvent> {
    return new Observable<FileBytesEvent>((subscriber) => {
      this.calls.push({ subscriber });
    });
  }
  answer(bytes: ArrayBuffer): void {
    const s = this.calls[this.calls.length - 1]!.subscriber;
    s.next({ type: 'loaded', bytes });
    s.complete();
  }
}

/** The host's two routes, answered by the test, and seen when abandoned. */
class SummaryStub {
  gets: { file: { id: string }; language: SummaryLanguage; sub: Subscriber<IFileSummaryView>; aborted: boolean }[] = [];
  makes: { file: { id: string }; language: SummaryLanguage; sub: Subscriber<IFileSummaryView>; aborted: boolean }[] = [];
  private call(list: SummaryStub['gets'], file: { id: string }, language: SummaryLanguage): Observable<IFileSummaryView> {
    return new Observable<IFileSummaryView>((sub) => {
      const entry = { file, language, sub, aborted: false };
      list.push(entry);
      return () => (entry.aborted = true);
    });
  }
  get = (file: { id: string }, language: SummaryLanguage) => this.call(this.gets, file, language);
  make = (file: { id: string }, language: SummaryLanguage) => this.call(this.makes, file, language);
  answerGet(view: IFileSummaryView): void {
    const s = this.gets[this.gets.length - 1]!.sub;
    s.next(view);
    s.complete();
  }
  answerMake(view: IFileSummaryView): void {
    const s = this.makes[this.makes.length - 1]!.sub;
    s.next(view);
    s.complete();
  }
  failMake(err: unknown): void {
    this.makes[this.makes.length - 1]!.sub.error(err);
  }
}

describe('FileViewerComponent — Summarize (ACC-193)', () => {
  let bytes: BytesStub;
  let summaries: SummaryStub;
  let fixture: ComponentFixture<FileViewerComponent>;

  function open(files: IViewableFile[], opts: { language?: 'en' | 'ar'; host?: boolean } = {}) {
    bytes = new BytesStub();
    summaries = new SummaryStub();
    TestBed.configureTestingModule({
      imports: [FileViewerComponent],
      providers: [
        provideHttpClient(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: FileBytesService, useValue: bytes },
        { provide: PdfJsLoader, useValue: { load: () => new Promise(() => undefined) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    const request: IFileViewerRequest = {
      files,
      startIndex: 0,
      context: { key: 'files.viewer.from.taskEvidence' },
      access: () => of({ url: 'unused', viaApi: false }),
      download: () => undefined,
      ...(opts.host === false ? {} : { summary: { get: summaries.get, make: summaries.make } }),
    };
    fixture = TestBed.createComponent(FileViewerComponent);
    fixture.componentRef.setInput('request', request);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const frame = (): HTMLElement => document.body.querySelector('.am-drawer__frame') as HTMLElement;
  const q = <T extends Element = HTMLElement>(sel: string): T | null => frame().querySelector<T>(sel);
  const panelText = (): string => (q('[data-am-summary]')?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  /** Opens a file, answers its bytes and its summary read. */
  async function shown(file: IViewableFile, body: ArrayBuffer, view: IFileSummaryView, language: 'en' | 'ar' = 'en') {
    const viewer = open([file], { language });
    bytes.answer(body);
    await render();
    summaries.answerGet(view);
    await render();
    return viewer;
  }

  preserveDocumentLanguage();

  describe('the header button', () => {
    it('PDF, TXT and CSV: "✦ Summarize" after "n / m" and before Download, the ✦ hidden from readers', async () => {
      open([PDF, TXT, CSV]);
      bytes.answer(utf8('%PDF-1.7'));
      await render();
      expect(summaries.gets.map((g) => [g.file.id, g.language])).toEqual([['ev-1', 'en']]);
      summaries.answerGet(OPEN);
      await render();
      const button = q('[data-am-summarize]')!;
      expect(button.textContent?.replace(/\s+/g, ' ').trim()).toBe('✦ Summarize');
      expect(button.querySelector('.am-fview__spark')?.getAttribute('aria-hidden')).toBe('true');
      const order = [q('[data-am-next]')!, button, q('[data-am-download]')!];
      expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    for (const [label, file, body] of [
      ['TXT', TXT, utf8('notes')],
      ['CSV', CSV, utf8('a,b\n1,2')],
    ] as const) {
      it(`${label}: offered`, async () => {
        await shown(file, body, OPEN);
        expect(q('[data-am-summarize]')).not.toBeNull();
      });
    }

    it('an image and a Word file: absent, not disabled — and nothing is asked', async () => {
      open([IMG]);
      bytes.answer(utf8('png'));
      await render();
      expect(q('[data-am-summarize]')).toBeNull();
      expect(summaries.gets).toEqual([]);
      fixture.destroy();
      TestBed.resetTestingModule();
      open([DOCX]);
      await render();
      expect(q('[data-am-summarize]')).toBeNull();
      expect(summaries.gets).toEqual([]);
    });

    it('a host that passes no summary routes: absent', async () => {
      open([TXT], { host: false });
      bytes.answer(utf8('notes'));
      await render();
      expect(q('[data-am-summarize]')).toBeNull();
    });

    it('AI not available for the organisation: absent (decision 2), with no line in its place', async () => {
      await shown(TXT, utf8('notes'), { available: false, inProgress: false, summary: null });
      expect(q('[data-am-summarize]')).toBeNull();
      expect(q('[data-am-summary]')).toBeNull();
    });

    it('not while the file is still loading', async () => {
      open([TXT]);
      await render();
      expect(q('[data-am-summarize]')).toBeNull();
    });
  });

  describe('pressing it', () => {
    it('asks in the reader\'s language; the button reads "Summarizing…" with Cancel; the panel opens at once', async () => {
      const viewer = await shown(TXT, utf8('notes'), OPEN);
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      expect(summaries.makes.map((m) => [m.file.id, m.language])).toEqual([['ev-3', 'en']]);
      const button = q<HTMLButtonElement>('[data-am-summarize]')!;
      expect(button.disabled).toBeTrue();
      expect(button.getAttribute('aria-busy')).toBe('true');
      expect(button.textContent).toContain('Summarizing…');
      expect(q('[data-am-summary-cancel]')).not.toBeNull();
      expect(panelText()).toContain('Summarizing…');
      expect(panelText()).toContain('Reading the file…');
      expect(viewer.summaryPhase()).toBe('working');
    });

    it('the working line says what it reads: pages, the first 100 pages, rows, the first 500 rows (Q4)', async () => {
      const viewer = await shown(PDF, utf8('%PDF'), OPEN);
      viewer.pdfOpened(12);
      expect(viewer.summaryWorkingText()).toBe('Reading 12 pages…');
      viewer.pdfOpened(412);
      expect(viewer.summaryWorkingText()).toBe('Reading the first 100 pages…');
      fixture.destroy();
      TestBed.resetTestingModule();
      const small = await shown(CSV, utf8('ward,score\n4B,58\n4C,79\n6A,91'), OPEN);
      expect(small.summaryWorkingText()).toBe('Reading 3 rows…');
      fixture.destroy();
      TestBed.resetTestingModule();
      const rows = ['ward,score', ...Array.from({ length: 2140 }, (_, i) => `w${i},${i}`)].join('\n');
      const big = await shown(CSV, utf8(rows), OPEN);
      expect(big.summaryWorkingText()).toBe('Reading the first 500 rows…');
    });

    it('the result: the tag, "Summary made …", the overview and key points, expanded — and no button any more', async () => {
      await shown(TXT, utf8('notes'), OPEN);
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      summaries.answerMake(SAVED({ madeAt: '2026-10-13T09:00:00.000Z' }));
      await render();
      const text = panelText();
      expect(text).toContain('AI summary · may miss or misread details · check the file');
      expect(text).toContain('Summary made 13 Oct 2026');
      expect(text).not.toContain('· saved');
      expect(text).toContain('The policy sets hand hygiene rules for every ward.');
      const overview = q('.am-fview__summary-overview')!;
      expect(overview.getAttribute('lang')).toBe('en');
      expect(overview.getAttribute('dir')).toBe('ltr');
      expect(Array.from(frame().querySelectorAll('.am-fview__summary-points li')).map((li) => li.textContent?.trim())).toEqual([
        'Gel before and after every contact',
        'Monthly audits per ward',
      ]);
      expect(q('.am-ai__body--clamped')).toBeNull();
      expect(q('[data-am-summarize]')).toBeNull();
    });

    it('a partial read says so under the tag: "From the first 100 pages of 412."', async () => {
      await shown(PDF, utf8('%PDF'), SAVED({ coverage: { unit: 'pages', read: 100, total: 412 } }));
      expect(panelText()).toContain('Summary made 9 Oct 2026 · saved · From the first 100 pages of 412.');
    });

    it('rows and text say so too', async () => {
      const csv = await shown(CSV, utf8('a,b\n1,2'), SAVED({ coverage: { unit: 'rows', read: 500, total: 2140 } }));
      expect(csv.summaryNote()).toContain('From the first 500 rows of 2,140.');
      fixture.destroy();
      TestBed.resetTestingModule();
      const txt = await shown(TXT, utf8('notes'), SAVED({ coverage: { unit: 'text', read: 90_000, total: 400_000 } }));
      expect(txt.summaryNote()).toContain('From the beginning of the file; the rest was too long to read.');
    });
  });

  describe('a second visit', () => {
    it('the saved summary at once, with no request to make one: clamped to two lines with "Show all", "· saved", collapsible', async () => {
      await shown(PDF, utf8('%PDF'), SAVED());
      expect(summaries.makes).toEqual([]);
      expect(q('[data-am-summarize]')).toBeNull();
      expect(panelText()).toContain('Summary made 9 Oct 2026 · saved');
      expect(q('.am-ai__body--clamped')).not.toBeNull();
      expect(q('.am-ai__show-all')?.textContent?.trim()).toBe('Show all');
      const fold = q('.am-ai__fold')!;
      expect(fold.getAttribute('aria-label')).toBe('Collapse summary');
    });

    it('someone is making it right now: no button, and the panel says so with Try again that re-reads, never presses', async () => {
      await shown(TXT, utf8('notes'), { available: true, inProgress: true, summary: null });
      expect(q('[data-am-summarize]')).toBeNull();
      expect(panelText()).toContain('A summary of this file is being made. Check again in a minute.');
      (q('.am-ai__refusal button') as HTMLButtonElement).click();
      await render();
      expect(summaries.makes).toEqual([]);
      expect(summaries.gets).toHaveSize(2);
    });

    it('AI turned off later: a saved summary still shows, marked as AI, with no button (Q1)', async () => {
      await shown(TXT, utf8('notes'), { ...SAVED(), available: false });
      expect(panelText()).toContain('AI summary · may miss or misread details');
      expect(q('[data-am-summarize]')).toBeNull();
    });
  });

  describe('refusals after a press — in the panel, never a modal', () => {
    async function pressAndFail(err: unknown) {
      const viewer = await shown(TXT, utf8('notes'), OPEN);
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      summaries.failMake(err);
      await render();
      return viewer;
    }

    it('credits used up: the date they renew, no Try again', async () => {
      await pressAndFail(refusal(409, 'AI_CREDITS_EXHAUSTED', { renewsAt: '2026-10-21T00:00:00.000Z' }));
      expect(panelText()).toContain('They renew on 21 Oct 2026');
      expect(q('.am-ai__refusal button')).toBeNull();
    });

    it('no readable text: said plainly, no Try again', async () => {
      await pressAndFail(refusal(409, 'SUMMARY_NO_TEXT'));
      expect(panelText()).toContain('This file has no readable text to summarize.');
      expect(q('.am-ai__refusal button')).toBeNull();
    });

    it('busy, unreadable, or the provider failed: Try again presses again', async () => {
      await pressAndFail(refusal(503, 'SUMMARY_BUSY'));
      expect(panelText()).toContain('Summaries are busy right now. Try again in a moment.');
      (q('.am-ai__refusal button') as HTMLButtonElement).click();
      await render();
      expect(summaries.makes).toHaveSize(2);
    });

    it('unreadable', async () => {
      await pressAndFail(refusal(409, 'SUMMARY_FILE_UNREADABLE'));
      expect(panelText()).toContain("This file couldn't be read for a summary.");
    });

    it('in progress (a second tab): Try again re-reads', async () => {
      await pressAndFail(refusal(409, 'AI_SUMMARY_IN_PROGRESS'));
      (q('.am-ai__refusal button') as HTMLButtonElement).click();
      await render();
      expect(summaries.makes).toHaveSize(1);
      expect(summaries.gets).toHaveSize(2);
    });

    it('a 404 (the file was deleted meanwhile): the viewer\'s own "deleted" state, no panel', async () => {
      const viewer = await pressAndFail(new HttpErrorResponse({ status: 404, error: { statusCode: 404, message: 'Evidence not found' } }));
      expect(viewer.problem()).toBe('deleted');
      expect(q('[data-am-summary]')).toBeNull();
    });
  });

  describe('leaving cancels here — the server still finishes (Q2)', () => {
    it('Cancel stops waiting, and re-reads the file\'s summary', async () => {
      await shown(TXT, utf8('notes'), OPEN);
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      q<HTMLButtonElement>('[data-am-summary-cancel]')!.click();
      await render();
      expect(summaries.makes[0]!.aborted).toBeTrue();
      expect(summaries.gets).toHaveSize(2);
    });

    it('moving to the next file abandons the request and reads the next file\'s summary', async () => {
      const viewer = open([TXT, CSV]);
      bytes.answer(utf8('notes'));
      await render();
      summaries.answerGet(OPEN);
      await render();
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      viewer.next();
      await render();
      expect(summaries.makes[0]!.aborted).toBeTrue();
      expect(summaries.gets[summaries.gets.length - 1]!.file.id).toBe('ev-4');
      expect(viewer.summaryPhase()).toBe('idle');
    });

    it('closing abandons it too', async () => {
      const viewer = await shown(TXT, utf8('notes'), OPEN);
      q<HTMLButtonElement>('[data-am-summarize]')!.click();
      await render();
      viewer.close();
      expect(summaries.makes[0]!.aborted).toBeTrue();
    });
  });

  describe('language (decision 8)', () => {
    it('switching language re-reads in the new one: an English summary is not shown to an Arabic reader, and Summarize is offered', async () => {
      await shown(PDF, utf8('%PDF'), SAVED());
      TestBed.inject(TranslateService).use('ar');
      await render();
      expect(summaries.gets[summaries.gets.length - 1]!.language).toBe('ar');
      summaries.answerGet(OPEN);
      await render();
      expect(q('[data-am-summarize]')?.textContent).toContain('تلخيص');
      expect(q('[data-am-summary]')).toBeNull();
    });

    it('in Arabic: the panel and its words are right to left, the summary marked Arabic', async () => {
      await shown(TXT, utf8('ملاحظات'), SAVED({ language: 'ar', overview: 'تحدد السياسة قواعد نظافة اليدين.', keyPoints: ['قبل كل تماس'] }), 'ar');
      expect(document.documentElement.dir).toBe('rtl');
      const overview = q('.am-fview__summary-overview')!;
      expect(overview.getAttribute('lang')).toBe('ar');
      expect(overview.getAttribute('dir')).toBe('rtl');
      expect(panelText()).toContain('ملخص بالذكاء الاصطناعي · قد يُغفل تفاصيل أو يخطئ في قراءتها · راجع الملف');
      expect(panelText()).toContain('أُعدّ الملخص في');
      expect(q('.am-ai__fold')?.getAttribute('aria-label')).toBe('طي الملخص');
      // The dashed AI rule sits on the inline-START edge: the right, in Arabic.
      const result = q('.am-ai__result')!;
      expect(getComputedStyle(result).borderRightStyle).toBe('dashed');
    });
  });

  describe('the header at the drawer\'s measured widths (§8.2)', () => {
    for (const language of ['en', 'ar'] as const) {
      for (const width of [720, 864]) {
        it(`${language}, ${width}px: every control inside the frame, Summarize before Download in reading order`, async () => {
          await shown(PDF, utf8('%PDF'), OPEN, language);
          const head = q('.am-fview__head')!;
          frame().style.width = `${width}px`;
          frame().style.maxWidth = `${width}px`;
          await render();
          const box = frame().getBoundingClientRect();
          const controls = Array.from(head.querySelectorAll('button')) as HTMLElement[];
          // Non-vacuity: real, laid-out controls in a frame of the asked width.
          expect(Math.round(box.width)).toBe(width);
          expect(controls.length).toBeGreaterThanOrEqual(2);
          for (const c of controls) {
            const r = c.getBoundingClientRect();
            expect(r.width).toBeGreaterThan(0);
            expect(r.left).toBeGreaterThanOrEqual(box.left - 0.5);
            expect(r.right).toBeLessThanOrEqual(box.right + 0.5);
          }
          const summarize = q('[data-am-summarize]')!.getBoundingClientRect();
          const download = q('[data-am-download]')!.getBoundingClientRect();
          const sameRow = Math.abs(summarize.top - download.top) < 4;
          if (sameRow) {
            if (language === 'ar') expect(summarize.left).toBeGreaterThan(download.left);
            else expect(summarize.left).toBeLessThan(download.left);
          } else {
            // Wrapped to two rows (allowed at the minimum width): Summarize is on the earlier row.
            expect(summarize.top).toBeLessThan(download.top);
          }
        });
      }
    }
  });
});
