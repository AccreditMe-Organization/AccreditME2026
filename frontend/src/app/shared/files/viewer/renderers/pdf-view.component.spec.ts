import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { PdfJsLoader } from '../pdf-loader';
import { FilePdfViewComponent } from './pdf-view.component';

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

/** How long a spec waits for the browser to report a page near the view and paint it. */
const PAINT_TIMEOUT_MS = 10_000;

describe('FilePdfViewComponent (ACC-189)', () => {
  let fixture: ComponentFixture<FilePdfViewComponent>;
  let stub: ReturnType<typeof pdfStub>;

  async function setup(options: { hold?: boolean } = {}) {
    stub = pdfStub(options);
    TestBed.configureTestingModule({
      imports: [FilePdfViewComponent],
      providers: [
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PdfJsLoader, useValue: { load: () => Promise.resolve(stub.module) } },
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
   * fixed number of ticks: a page is painted only after the browser's
   * IntersectionObserver reports it near the view and pdf.js's render settles,
   * and how long that takes depends on how loaded the machine is. A fixed
   * budget (it was 20 × 25 ms) failed on a slow CI run.
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

  it('pages near the view are PAINTED, not left "Loading page n…"', async () => {
    await setup();
    await until(painted(1), 'page 1 to be painted');
    const first = fixture.nativeElement.querySelector('.am-fpdf__page') as HTMLElement;
    expect(first.querySelector('.am-fpdf__pending')).toBeNull();
    expect((first.querySelector('canvas') as HTMLCanvasElement).width).toBeGreaterThan(0);
  }, PAINT_TIMEOUT_MS + 5_000);

  it('a page says "Loading page n…" until its paint finishes, and not after', async () => {
    await setup({ hold: true });
    await until(() => stub.renders.length > 0, 'page 1 to be asked to paint');
    const first = fixture.nativeElement.querySelector('.am-fpdf__page') as HTMLElement;
    // Asked to paint, not yet painted: still pending, however long it takes.
    expect(painted(1)()).toBeFalse();
    expect(first.querySelector('.am-fpdf__pending')).not.toBeNull();
    for (const r of stub.renders) r.release();
    await until(painted(1), 'page 1 to be painted once released');
    expect(first.querySelector('.am-fpdf__pending')).toBeNull();
  }, PAINT_TIMEOUT_MS * 2 + 5_000);

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

  it('destroying the view destroys the document and its worker', async () => {
    await setup();
    fixture.destroy();
    expect(stub.loadingDestroy).toHaveBeenCalledTimes(1);
  });
});
