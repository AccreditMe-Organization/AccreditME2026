import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { PdfJsLoader } from '../pdf-loader';
import { FilePdfViewComponent } from './pdf-view.component';
import { PdfPageEvents, PdfPageVisibility, PdfPageWatch } from './pdf-page-visibility';

/**
 * A pdf.js stand-in: three A4 pages and spies on teardown. Renders resolve at
 * once, or — with `hold` — only when the test releases them, so a spec can see
 * a page between "asked to paint" and "painted". Every render is recorded.
 */
function pdfStub(options: { hold?: boolean } = {}) {
  const loadingDestroy = jasmine.createSpy('loadingTask.destroy').and.resolveTo(undefined);
  const getDocument = jasmine.createSpy('getDocument');
  const renders: { release: () => void }[] = [];
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => {
      let release = (): void => undefined;
      const promise = options.hold ? new Promise<void>((r) => (release = r)) : Promise.resolve();
      renders.push({ release });
      return { promise, cancel: () => undefined };
    },
  };
  const doc = { numPages: 3, getPage: () => Promise.resolve(page) };
  getDocument.and.callFake(() => ({ promise: Promise.resolve(doc), destroy: loadingDestroy }));
  const module = { PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 }, getDocument };
  return { module, getDocument, loadingDestroy, renders };
}

/** How long a spec waits for a page to be painted once it is reported near the view. */
const PAINT_TIMEOUT_MS = 10_000;

/**
 * ACC-253 — the spec, not the browser, says which pages are near the view. A
 * real IntersectionObserver in CI's headless Chrome sometimes never reported
 * page 1 ("renders asked for: 0", three PRs); the view's behaviour on a
 * report is what these specs are about. The real source has its own spec
 * below.
 */
class FakePageVisibility {
  events: PdfPageEvents | null = null;
  watchedPages: readonly Element[] = [];
  disconnects = 0;

  watch(_scroller: Element | null, pages: readonly Element[], events: PdfPageEvents): PdfPageWatch {
    this.watchedPages = pages;
    this.events = events;
    return {
      disconnect: () => {
        this.disconnects++;
        this.events = null;
      },
    };
  }

  /** Page `n` came within a screen of the view, as the browser would report it. */
  near(n: number): void {
    if (!this.events) throw new Error('The PDF view is not watching its pages yet');
    this.events.near(n, true);
  }
}

describe('FilePdfViewComponent (ACC-189)', () => {
  let fixture: ComponentFixture<FilePdfViewComponent>;
  let stub: ReturnType<typeof pdfStub>;
  let visibility: FakePageVisibility;

  /** `realVisibility` keeps the browser's own observers (the default source). */
  async function setup(options: { hold?: boolean; realVisibility?: boolean } = {}) {
    stub = pdfStub(options);
    visibility = new FakePageVisibility();
    TestBed.configureTestingModule({
      imports: [FilePdfViewComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PdfJsLoader, useValue: { load: () => Promise.resolve(stub.module) } },
        ...(options.realVisibility ? [] : [{ provide: PdfPageVisibility, useValue: visibility }]),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(FilePdfViewComponent);
    fixture.componentRef.setInput('bytes', new Uint8Array([37, 80, 68, 70]).buffer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  /**
   * ACC-253 — waits for `condition`, polling with a bounded timeout. Never a
   * fixed number of ticks: once a page is reported near the view, its paint
   * still waits for pdf.js's render to settle, and how long that takes depends
   * on how loaded the machine is. A fixed budget (it was 20 × 25 ms) failed on
   * a slow CI run.
   */
  async function until(condition: () => boolean, what: string): Promise<void> {
    const deadline = Date.now() + PAINT_TIMEOUT_MS;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error(`timed out after ${PAINT_TIMEOUT_MS} ms waiting for ${what} (renders asked for: ${stub.renders.length})`);
      await new Promise((r) => setTimeout(r, 10));
      fixture.detectChanges();
    }
    fixture.detectChanges();
  }

  /** The renderer's own completion signal: page n is marked rendered only after its paint settles. */
  const painted = (n: number) => () => fixture.componentInstance.pages()[n - 1]?.rendered === true;

  it('opens the bytes with our pinned options and reports the page count', async () => {
    let count = 0;
    stub = pdfStub();
    TestBed.configureTestingModule({
      imports: [FilePdfViewComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PdfJsLoader, useValue: { load: () => Promise.resolve(stub.module) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    fixture = TestBed.createComponent(FilePdfViewComponent);
    fixture.componentInstance.opened.subscribe((e) => (count = e.pageCount));
    fixture.componentRef.setInput('bytes', new Uint8Array([37, 80, 68, 70]).buffer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(count).toBe(3);
    const options = stub.getDocument.calls.mostRecent().args[0];
    expect(options.enableXfa).toBeFalse();
    expect(options.data).toEqual(jasmine.any(Uint8Array));
  });

  it('draws one placeholder per page, each at the page\'s size, named "Page n of N"', async () => {
    await setup();
    const pages = fixture.nativeElement.querySelectorAll('.am-fpdf__page');
    expect(pages.length).toBe(3);
    expect(fixture.nativeElement.querySelector('canvas')!.getAttribute('aria-label')).toBe('Page 1 of 3');
    // A page is the document: never mirrored, whatever the interface language.
    expect(fixture.nativeElement.querySelector('.am-fpdf')!.getAttribute('dir')).toBe('ltr');
  });

  /** The view has started watching its pages (after its first render). */
  const watching = () => visibility.events !== null;

  it('watches every page, and asks nothing to paint until a page is reported near the view', async () => {
    await setup();
    await until(watching, 'the view to watch its pages');
    expect(visibility.watchedPages.length).toBe(3);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(stub.renders.length).toBe(0);
    expect(fixture.nativeElement.querySelectorAll('.am-fpdf__pending').length).toBe(3);
  });

  it('pages near the view are PAINTED, not left "Loading page n…"', async () => {
    await setup();
    await until(watching, 'the view to watch its pages');
    visibility.near(1);
    await until(painted(1), 'page 1 to be painted');
    const first = fixture.nativeElement.querySelector('.am-fpdf__page') as HTMLElement;
    expect(first.querySelector('.am-fpdf__pending')).toBeNull();
    expect((first.querySelector('canvas') as HTMLCanvasElement).width).toBeGreaterThan(0);
    // Only the page reported near the view was painted; the others still say so.
    // (Page 1 may paint twice: the real ResizeObserver can change the scale.)
    expect([painted(2)(), painted(3)()]).toEqual([false, false]);
    expect(fixture.nativeElement.querySelectorAll('.am-fpdf__pending').length).toBe(2);
  }, PAINT_TIMEOUT_MS * 2 + 5_000);

  it('a page says "Loading page n…" until its paint finishes, and not after', async () => {
    await setup({ hold: true });
    await until(watching, 'the view to watch its pages');
    visibility.near(1);
    await until(() => stub.renders.length > 0, 'page 1 to be asked to paint');
    const first = fixture.nativeElement.querySelector('.am-fpdf__page') as HTMLElement;
    // Asked to paint, not yet painted: still pending, however long it takes.
    expect(painted(1)()).toBeFalse();
    expect(first.querySelector('.am-fpdf__pending')).not.toBeNull();
    for (const r of stub.renders) r.release();
    await until(painted(1), 'page 1 to be painted once released');
    expect(first.querySelector('.am-fpdf__pending')).toBeNull();
  }, PAINT_TIMEOUT_MS * 3 + 5_000);

  it('a zoom level is a percentage of the printed size: 150% is 1.5 × the CSS size of a point', async () => {
    await setup();
    let percent = 0;
    fixture.componentInstance.percent.subscribe((p) => (percent = p));
    fixture.componentRef.setInput('zoom', { mode: 'custom', percent: 150 });
    fixture.detectChanges();
    expect(percent).toBe(150);
    const page = fixture.nativeElement.querySelector('.am-fpdf__page') as HTMLElement;
    expect(parseFloat(page.style.width)).toBeCloseTo(595 * 1.5 * (96 / 72), 0);
  });

  it('destroying the view destroys the document and its worker, and stops watching its pages', async () => {
    await setup();
    await until(watching, 'the view to watch its pages');
    fixture.destroy();
    expect(stub.loadingDestroy).toHaveBeenCalledTimes(1);
    expect(visibility.disconnects).toBe(1);
  });

  describe('the default source: the browser\'s IntersectionObserver (ACC-253)', () => {
    interface Made {
      options: IntersectionObserverInit | undefined;
      observed: Element[];
      disconnected: boolean;
    }
    const RealObserver = window.IntersectionObserver;
    let made: Made[];

    // Records every observer the view creates, and still creates the real one.
    // Nothing here waits for an observer to FIRE: that is the part a headless
    // browser does not promise.
    beforeEach(() => {
      made = [];
      class RecordingObserver extends RealObserver {
        private readonly record: Made;
        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          super(callback, options);
          this.record = { options, observed: [], disconnected: false };
          made.push(this.record);
        }
        override observe(target: Element): void {
          this.record.observed.push(target);
          super.observe(target);
        }
        override disconnect(): void {
          this.record.disconnected = true;
          super.disconnect();
        }
      }
      window.IntersectionObserver = RecordingObserver;
    });

    afterEach(() => {
      window.IntersectionObserver = RealObserver;
    });

    it('creates the three observers on every page, with their look-ahead, and disconnects them on destroy', async () => {
      await setup({ realVisibility: true });
      await until(() => made.length === 3, 'the view to create its observers');
      const pages = Array.from(fixture.nativeElement.querySelectorAll('.am-fpdf__page')) as Element[];
      expect(pages.length).toBe(3);
      const scroller = (fixture.nativeElement as HTMLElement).parentElement;
      expect(made.map((m) => m.options)).toEqual([
        { root: scroller, rootMargin: '100% 0px' },
        { root: scroller, rootMargin: '400% 0px' },
        { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 1] },
      ]);
      for (const m of made) expect(m.observed).toEqual(pages);
      expect(made.some((m) => m.disconnected)).toBeFalse();

      fixture.destroy();
      expect(made.map((m) => m.disconnected)).toEqual([true, true, true]);
    });
  });
});
