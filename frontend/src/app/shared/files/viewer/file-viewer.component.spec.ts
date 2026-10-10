import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Observable, Subscriber, of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LayerStackService } from '../../overlay/layer-stack.service';
import { FileBytesEvent, FileBytesService } from './file-bytes.service';
import { FileViewerComponent } from './file-viewer.component';
import { FileViewError, FileViewProblem, IFileViewerRequest, IViewableFile } from './file-viewer.model';
import { PdfJsLoader } from './pdf-loader';

const PDF: IViewableFile = { id: 'ev-1', name: 'Hand hygiene audit, Ward 4B · September 2026.pdf', mimeType: 'application/pdf', sizeBytes: 2_516_582 };
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

/** One controllable fetch per load(): the test answers it, and sees when it is aborted. */
class BytesStub {
  calls: { file: IViewableFile; subscriber: Subscriber<FileBytesEvent>; aborted: boolean }[] = [];
  load(file: IViewableFile): Observable<FileBytesEvent> {
    return new Observable<FileBytesEvent>((subscriber) => {
      const call = { file, subscriber, aborted: false };
      this.calls.push(call);
      return () => {
        call.aborted = true;
      };
    });
  }
  last() {
    return this.calls[this.calls.length - 1]!;
  }
  answer(bytes: ArrayBuffer): void {
    const s = this.last().subscriber;
    s.next({ type: 'loaded', bytes });
    s.complete();
  }
  fail(problem: FileViewProblem): void {
    this.last().subscriber.error(new FileViewError(problem));
  }
}

describe('FileViewerComponent (ACC-189)', () => {
  let bytes: BytesStub;
  let fixture: ComponentFixture<FileViewerComponent>;
  let downloads: IViewableFile[];
  let closed: IViewableFile[];

  function open(files: IViewableFile[], startIndex = 0, language: 'en' | 'ar' = 'en') {
    bytes = new BytesStub();
    downloads = [];
    closed = [];
    TestBed.configureTestingModule({
      imports: [FileViewerComponent],
      providers: [
        provideHttpClient(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: FileBytesService, useValue: bytes },
        // pdf.js never loads in a spec: a document that never resolves keeps the PDF body quiet.
        { provide: PdfJsLoader, useValue: { load: () => new Promise(() => undefined) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    const request: IFileViewerRequest = {
      files,
      startIndex,
      context: { key: 'files.viewer.from.taskEvidence' },
      access: () => of({ url: 'unused', viaApi: false }),
      download: (f) => downloads.push(f),
    };
    fixture = TestBed.createComponent(FileViewerComponent);
    fixture.componentRef.setInput('request', request);
    fixture.componentInstance.closed.subscribe((f) => closed.push(f));
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  /** The drawer's frame is appended to the body by PrimeNG. */
  const frame = (): HTMLElement => document.body.querySelector('.am-drawer__frame') as HTMLElement;
  const text = (): string => frame().textContent ?? '';
  const render = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const key = (k: string) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

  afterEach(() => {
    fixture?.destroy();
    TestBed.inject(TranslateService).use('en');
    document.documentElement.dir = 'ltr';
  });

  it('opens at the file it was asked for, named in full, with "2 / 3" and where it came from', async () => {
    open([PDF, IMG, TXT], 1);
    await render();
    expect(frame().getAttribute('aria-label')).toBe(IMG.name);
    expect(frame().getAttribute('role')).toBe('dialog');
    expect(text()).toContain('2 / 3');
    expect(text()).toContain('PNG · 3 MB');
    expect(text()).toContain("From a task's evidence");
  });

  it('Previous and Next stop at the ends', async () => {
    const viewer = open([PDF, IMG], 0);
    await render();
    const prev = frame().querySelector('[data-am-prev]') as HTMLButtonElement;
    const next = frame().querySelector('[data-am-next]') as HTMLButtonElement;
    expect(prev.disabled).toBeTrue();
    next.click();
    await render();
    expect(viewer.index()).toBe(1);
    expect(next.disabled).toBeTrue();
    viewer.next();
    expect(viewer.index()).toBe(1);
  });

  it('a one-file list has no arrows and no position', async () => {
    open([PDF]);
    await render();
    expect(frame().querySelector('[data-am-prev]')).toBeNull();
    expect(text()).not.toContain('1 / 1');
  });

  it('announces the move politely: "File 2 of 3, <name>"', async () => {
    const viewer = open([PDF, IMG, TXT]);
    await render();
    viewer.next();
    await render();
    expect(frame().querySelector('[aria-live="polite"]')!.textContent!.trim()).toBe(`File 2 of 3, ${IMG.name}`);
  });

  it('the arrow keys move between files, MIRRORED in Arabic so → is previous', async () => {
    const viewer = open([PDF, IMG, TXT], 1);
    await render();
    key('ArrowRight');
    expect(viewer.index()).toBe(2);
    key('ArrowLeft');
    expect(viewer.index()).toBe(1);

    TestBed.inject(TranslateService).use('ar');
    await render();
    key('ArrowLeft');
    expect(viewer.index()).toBe(2);
    key('ArrowRight');
    expect(viewer.index()).toBe(1);
  });

  it('each type gets its renderer from the SERVER\'s type', async () => {
    const viewer = open([PDF, IMG, TXT, CSV]);
    bytes.answer(utf8('%PDF-1.7'));
    await render();
    expect(frame().querySelector('am-file-pdf-view')).not.toBeNull();

    viewer.next();
    bytes.answer(new Uint8Array([137, 80, 78, 71]).buffer as ArrayBuffer);
    await render();
    expect((frame().querySelector('am-file-image-view img') as HTMLImageElement).src).toMatch(/^blob:/);

    viewer.next();
    bytes.answer(utf8('one\nسطر عربي'));
    await render();
    expect(frame().querySelectorAll('am-file-text-view .am-ftext__line').length).toBe(2);

    viewer.next();
    bytes.answer(utf8('a,b\n1,2'));
    await render();
    expect(frame().querySelector('am-file-csv-view table')).not.toBeNull();
  });

  it('a type with no preview yet shows its panel WITHOUT fetching, and its Download works', async () => {
    open([DOCX]);
    await render();
    expect(bytes.calls.length).toBe(0);
    const panel = frame().querySelector('am-file-state-panel [role="region"]') as HTMLElement;
    expect(panel.textContent).toContain('No preview for this type yet');
    expect(panel.textContent).toContain("Word files can't be shown inside AccreditMe yet.");
    (panel.querySelector('[data-am-primary]') as HTMLButtonElement).click();
    expect(downloads).toEqual([DOCX]);
  });

  it('text is TEXT: <script> and <img onerror> render as characters, never as elements', async () => {
    open([TXT]);
    bytes.answer(utf8('<script>window.__x = 1</script>\n<img src=x onerror="window.__y = 1">'));
    await render();
    const body = frame().querySelector('am-file-text-view') as HTMLElement;
    expect(body.querySelector('script, img')).toBeNull();
    expect(body.textContent).toContain('<script>window.__x = 1</script>');
  });

  it('a CSV is cut at 500 data rows and says so, counting every row', async () => {
    open([CSV]);
    const rows = ['ward,count', ...Array.from({ length: 2000 }, (_, i) => `W${i},${i}`)].join('\r\n');
    bytes.answer(utf8(rows));
    await render();
    expect(frame().querySelectorAll('am-file-csv-view tbody tr').length).toBe(500);
    expect(text()).toContain('Showing the first 500 rows of 2,000. Download to see all.');
    expect(text()).toContain('500 of 2,000 rows');
    expect(text()).toContain('First row is the header');
  });

  describe('states', () => {
    it('SharePoint withdrawn: its own words in English and Arabic, and NO Download anywhere', async () => {
      open([PDF]);
      bytes.fail('withdrawn');
      await render();
      expect(text()).toContain(en.files.viewer.withdrawn.title);
      expect(frame().querySelector('[data-am-download]')).toBeNull();
      expect(frame().querySelector('[data-am-primary]')).toBeNull();

      TestBed.inject(TranslateService).use('ar');
      fixture.componentInstance.state.set({ status: 'problem', problem: 'withdrawn' });
      await render();
      expect(text()).toContain(ar.files.viewer.withdrawn.title);
      expect(text()).toContain(ar.files.viewer.withdrawn.body);
    });

    it('deleted: an alert, and NO Download', async () => {
      open([PDF]);
      bytes.fail('deleted');
      await render();
      expect(frame().querySelector('[role="alert"]')!.textContent).toContain('This file was deleted');
      expect(frame().querySelector('[data-am-download]')).toBeNull();
    });

    it('the organisation\'s storage refusing the browser (D3): its own sentence, Download kept', async () => {
      open([PDF]);
      bytes.fail('storageBlocked');
      await render();
      expect(text()).toContain("This file can't be previewed from your organization's storage");
      expect(frame().querySelector('[data-am-download]')).not.toBeNull();
    });

    it('a view refused PREVIEW_NOT_AVAILABLE shows the no-preview panel', async () => {
      open([PDF]);
      bytes.fail('noPreview');
      await render();
      expect(text()).toContain('No preview for this type yet');
    });

    it("couldn't open: Try again fetches again; Download is still offered", async () => {
      open([PDF]);
      bytes.fail('failed');
      await render();
      expect(text()).toContain("We couldn't open this file");
      (frame().querySelector('[data-am-primary]') as HTMLButtonElement).click();
      expect(bytes.calls.length).toBe(2);
      expect(frame().querySelector('[data-am-download]')).not.toBeNull();
    });

    it('while loading, the header is complete and Download is already live', async () => {
      open([PDF]);
      await render();
      expect(frame().querySelector('[role="status"]')!.textContent).toContain('Opening the file…');
      (frame().querySelector('[data-am-download]') as HTMLButtonElement).click();
      expect(downloads).toEqual([PDF]);
    });
  });

  describe('one file at a time (plan §8)', () => {
    it('moving on ABORTS the fetch in flight', async () => {
      const viewer = open([PDF, IMG]);
      await render();
      const first = bytes.last();
      viewer.next();
      expect(first.subscriber.closed).toBeTrue();
      expect(bytes.calls.length).toBe(2);
    });

    it('revokes the image\'s object URL on next and on close', async () => {
      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
      const viewer = open([IMG, IMG]);
      bytes.answer(new Uint8Array([1]).buffer as ArrayBuffer);
      await render();
      viewer.next();
      expect(revoke).toHaveBeenCalledTimes(1);

      bytes.answer(new Uint8Array([1]).buffer as ArrayBuffer);
      await render();
      viewer.close();
      expect(revoke).toHaveBeenCalledTimes(2);
    });

    it('a viewer torn down WITHOUT closing (its host gone) still revokes', async () => {
      const revoke = spyOn(URL, 'revokeObjectURL').and.callThrough();
      const viewer = open([IMG]);
      bytes.answer(new Uint8Array([1]).buffer as ArrayBuffer);
      await render();
      expect(viewer.state().status).toBe('image');
      fixture.destroy();
      expect(revoke).toHaveBeenCalledTimes(1);
    });
  });

  describe('closing', () => {
    it('Escape closes it — only when it is the TOP layer', async () => {
      open([PDF]);
      await render();
      const layers = TestBed.inject(LayerStackService);
      const above = layers.push();
      key('Escape');
      expect(closed.length).toBe(0);
      layers.remove(above);
      key('Escape');
      expect(closed).toEqual([PDF]);
    });

    it('reports the file LAST SHOWN, so the host returns focus to that row', async () => {
      const viewer = open([PDF, IMG, TXT]);
      await render();
      viewer.next();
      viewer.next();
      (frame().querySelector('[data-am-drawer-close]') as HTMLButtonElement).click();
      expect(closed).toEqual([TXT]);
    });
  });
});
