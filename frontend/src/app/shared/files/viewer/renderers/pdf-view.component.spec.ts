import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { PdfJsLoader } from '../pdf-loader';
import { FilePdfViewComponent } from './pdf-view.component';

/** A pdf.js stand-in: three A4 pages, renders that resolve at once, and spies on teardown. */
function pdfStub() {
  const loadingDestroy = jasmine.createSpy('loadingTask.destroy').and.resolveTo(undefined);
  const getDocument = jasmine.createSpy('getDocument');
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: () => ({ promise: Promise.resolve(), cancel: () => undefined }),
  };
  const doc = { numPages: 3, getPage: () => Promise.resolve(page) };
  getDocument.and.callFake(() => ({ promise: Promise.resolve(doc), destroy: loadingDestroy }));
  const module = { PixelsPerInch: { PDF_TO_CSS_UNITS: 96 / 72 }, getDocument };
  return { module, getDocument, loadingDestroy };
}

describe('FilePdfViewComponent (ACC-189)', () => {
  let fixture: ComponentFixture<FilePdfViewComponent>;
  let stub: ReturnType<typeof pdfStub>;

  async function setup() {
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
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(FilePdfViewComponent);
    fixture.componentRef.setInput('bytes', new Uint8Array([37, 80, 68, 70]).buffer);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

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
