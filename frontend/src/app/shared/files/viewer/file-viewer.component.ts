import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { FormatService } from '../../../core/formatting';
import { LanguageService } from '../../../core/services/language.service';
import { DrawerComponent } from '../../components/drawer/drawer.component';
import { FilesService } from '../files.service';
import { parseCsv } from './csv';
import { FileBytesService } from './file-bytes.service';
import { fileTypeOf, splitName, textDirection } from './file-type';
import { FileViewError, FileViewProblem, IFileViewerRequest, IViewableFile, downloadAllowed, previewKindFor } from './file-viewer.model';
import { FileCsvViewComponent } from './renderers/csv-view.component';
import { FileImageViewComponent, ImageZoom } from './renderers/image-view.component';
import { FilePdfViewComponent, PDF_ZOOM_STEPS, PdfZoom } from './renderers/pdf-view.component';
import { FileStatePanelComponent, StatePanelTone } from './renderers/state-panel.component';
import { FileTextViewComponent } from './renderers/text-view.component';
import { decodeText, textLines } from './text-decode';

/** The CSV table keeps at most this many DATA rows (the drawing). */
export const CSV_PREVIEW_ROWS = 500;
/** A PDF this long says, in the footer, that pages render as they are reached. */
const PDF_FOOTER_FROM_PAGES = 10;
/** Image zoom steps, as multiples of the actual pixels. */
const IMAGE_ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

type ViewState =
  | { status: 'loading' }
  | { status: 'problem'; problem: FileViewProblem }
  | { status: 'pdf'; bytes: ArrayBuffer }
  | { status: 'image'; url: string }
  | { status: 'text'; lines: string[]; truncated: boolean }
  | { status: 'csv'; header: string[]; rows: string[][]; total: number; truncated: boolean };

interface IPanel {
  icon: string;
  tone: StatePanelTone;
  role: 'region' | 'alert';
  title: string;
  body: string;
  fileLine: boolean;
  primary: 'download' | 'retry' | null;
  secondary: 'download' | null;
}

/**
 * ACC-189 — the in-app file viewer: one component that opens any attached
 * file, from every attachment list (File Viewer drawing, 9 Oct). Opened by
 * `FileViewerService`, never placed in a template.
 *
 * - ONE header for every type and state: the type icon, the name (cut in the
 *   middle so the extension stays visible), type and size and where the file
 *   came from, previous / position / next, Download. The content changes; the
 *   frame never does.
 * - States replace the BODY, never the header: loading, couldn't open,
 *   deleted, SharePoint withdrawn, no preview yet, and the organisation's
 *   storage refusing the browser (D3).
 * - ONE FILE IN MEMORY AT A TIME (plan §8): moving on or closing first aborts
 *   the fetch in flight, revokes the object URL and drops the bytes. No
 *   prefetching. The file shown is the version that was opened.
 * - Previous / next walk the list it was opened from; "n / total" counts
 *   files. A type with no preview is still a stop.
 */
@Component({
  selector: 'am-file-viewer',
  standalone: true,
  imports: [
    TranslatePipe,
    DrawerComponent,
    FilePdfViewComponent,
    FileImageViewComponent,
    FileTextViewComponent,
    FileCsvViewComponent,
    FileStatePanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-drawer
      [visible]="visible()"
      [ariaLabel]="file().name"
      [closeLabel]="'files.viewer.close' | translate"
      [(expanded)]="expanded"
      (closeRequested)="close()"
    >
      <div amDrawerHeader class="am-fview__head">
        <span class="am-fview__badge" aria-hidden="true">{{ type().badge }}</span>
        <span class="am-fview__id">
          <span class="am-fview__name" [attr.title]="file().name">
            <span class="am-fview__name-head" [attr.dir]="nameDir()">{{ name().head }}</span>
            @if (name().tail) {
              <span class="am-fview__name-tail" [attr.dir]="nameDir()">{{ name().tail }}</span>
            }
          </span>
          <span class="am-fview__meta">
            <span dir="ltr" class="am-fview__isolate">{{ meta() }}</span> ·
            {{ request().context.key | translate: request().context.params }}
          </span>
        </span>
        @if (files().length > 1) {
          <span class="am-fview__nav">
            <button
              type="button"
              class="am-drawer__button"
              data-am-prev
              [disabled]="index() === 0"
              [attr.aria-label]="'files.viewer.previousNamed' | translate: positionParams(index() - 1)"
              [attr.title]="'files.viewer.previousNamed' | translate: positionParams(index() - 1)"
              (click)="previous()"
            >
              <i [class]="language.isRtl() ? 'pi pi-arrow-right' : 'pi pi-arrow-left'" aria-hidden="true"></i>
            </button>
            <span class="am-fview__position" aria-hidden="true">
              <span dir="ltr" class="am-fview__isolate">{{ position() }}</span>
            </span>
            <button
              type="button"
              class="am-drawer__button"
              data-am-next
              [disabled]="index() === files().length - 1"
              [attr.aria-label]="'files.viewer.nextNamed' | translate: positionParams(index() + 1)"
              [attr.title]="'files.viewer.nextNamed' | translate: positionParams(index() + 1)"
              (click)="next()"
            >
              <i [class]="language.isRtl() ? 'pi pi-arrow-left' : 'pi pi-arrow-right'" aria-hidden="true"></i>
            </button>
          </span>
        }
        <span class="am-fview__rule" aria-hidden="true"></span>
        @if (canDownload()) {
          <button type="button" class="am-drawer__button am-drawer__button--text am-fview__download" data-am-download (click)="download()">
            <i class="pi pi-download" aria-hidden="true"></i>
            {{ 'files.viewer.download' | translate }}
          </button>
        }
      </div>

      @if (state().status === 'pdf') {
        <div amDrawerToolbar class="am-fview__toolbar" role="toolbar" [attr.aria-label]="'files.viewer.pdf.toolbar' | translate">
          <span class="am-fview__group">
            <label class="am-fview__toolbar-text" [for]="pageFieldId">{{ 'files.viewer.pdf.page' | translate }}</label>
            <input
              [id]="pageFieldId"
              class="am-fview__page-field"
              type="text"
              inputmode="numeric"
              [value]="pageField()"
              (input)="pageField.set($any($event.target).value)"
              (keydown.enter)="jumpToPage()"
              (blur)="pageField.set(format.number(pdfCurrent()))"
            />
            <span class="am-fview__toolbar-text">{{ 'files.viewer.pdf.of' | translate: { total: format.number(pdfPages()) } }}</span>
          </span>
          <span class="am-fview__group">
            <button type="button" class="am-drawer__button am-drawer__button--text" [class.am-drawer__button--on]="pdfZoom().mode === 'fitWidth'" [attr.aria-pressed]="pdfZoom().mode === 'fitWidth'" (click)="pdfZoom.set({ mode: 'fitWidth' })">
              {{ 'files.viewer.fitWidth' | translate }}
            </button>
            <button type="button" class="am-drawer__button am-drawer__button--text" [class.am-drawer__button--on]="pdfZoom().mode === 'fitPage'" [attr.aria-pressed]="pdfZoom().mode === 'fitPage'" (click)="pdfZoom.set({ mode: 'fitPage' })">
              {{ 'files.viewer.fitPage' | translate }}
            </button>
          </span>
          <span class="am-fview__group">
            <button type="button" class="am-drawer__button" [attr.aria-label]="'files.viewer.zoomOut' | translate" [attr.title]="'files.viewer.zoomOut' | translate" (click)="zoomOut()">
              <i class="pi pi-minus" aria-hidden="true"></i>
            </button>
            <span class="am-fview__toolbar-text am-fview__level" role="status" [attr.aria-label]="'files.viewer.zoomLevel' | translate: { level: percentText(pdfPercent()) }">{{ percentText(pdfPercent()) }}</span>
            <button type="button" class="am-drawer__button" [attr.aria-label]="'files.viewer.zoomIn' | translate" [attr.title]="'files.viewer.zoomIn' | translate" (click)="zoomIn()">
              <i class="pi pi-plus" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      }
      @if (state().status === 'image') {
        <div amDrawerToolbar class="am-fview__toolbar" role="toolbar" [attr.aria-label]="'files.viewer.image.toolbar' | translate">
          <span class="am-fview__group">
            <button type="button" class="am-drawer__button" [attr.aria-label]="'files.viewer.zoomOut' | translate" [attr.title]="'files.viewer.zoomOut' | translate" (click)="zoomOut()">
              <i class="pi pi-minus" aria-hidden="true"></i>
            </button>
            <button type="button" class="am-drawer__button am-drawer__button--text" [class.am-drawer__button--on]="imageZoom() === 'fit'" [attr.aria-pressed]="imageZoom() === 'fit'" (click)="imageZoom.set('fit')">
              {{ 'files.viewer.fit' | translate }}
            </button>
            <button type="button" class="am-drawer__button" [attr.aria-label]="'files.viewer.zoomIn' | translate" [attr.title]="'files.viewer.zoomIn' | translate" (click)="zoomIn()">
              <i class="pi pi-plus" aria-hidden="true"></i>
            </button>
          </span>
          <span class="am-fview__group">
            <button type="button" class="am-drawer__button am-drawer__button--text" [class.am-drawer__button--on]="imageZoom() === 1" [attr.aria-pressed]="imageZoom() === 1" (click)="imageZoom.set(1)">
              {{ percentText(100) }}
            </button>
          </span>
          @if (imageZoom() !== 'fit') {
            <span class="am-fview__group am-fview__toolbar-text">{{ 'files.viewer.image.dragHint' | translate }}</span>
          }
        </div>
      }

      @switch (state().status) {
        @case ('loading') {
          <div class="am-fview__loading">
            <div class="am-fview__skeleton" aria-hidden="true"></div>
            <span role="status">{{ 'files.viewer.loading' | translate }}</span>
          </div>
        }
        @case ('pdf') {
          @if (pdfBytes(); as bytes) {
            <am-file-pdf-view
              [bytes]="bytes"
              [zoom]="pdfZoom()"
              (opened)="pdfOpened($event.pageCount)"
              (failed)="showProblem('failed')"
              (currentPage)="pdfPageShown($event)"
              (percent)="pdfPercent.set($event)"
            />
          }
        }
        @case ('image') {
          @if (imageUrl(); as url) {
            <am-file-image-view [url]="url" [alt]="file().name" [zoom]="imageZoom()" (failed)="showProblem('failed')" />
          }
        }
        @case ('text') {
          @if (textState(); as text) {
            <am-file-text-view [lines]="text.lines" />
          }
        }
        @case ('csv') {
          @if (csvState(); as csv) {
            <am-file-csv-view [header]="csv.header" [rows]="csv.rows" [rowNumbers]="csvRowNumbers()" [note]="csvNote()" />
          }
        }
        @case ('problem') {
          @if (panel(); as p) {
            <am-file-state-panel
              [icon]="p.icon"
              [tone]="p.tone"
              [role]="p.role"
              [title]="p.title"
              [body]="p.body"
              [fileLine]="p.fileLine ? { name: file().name, dir: nameDir(), meta: meta() } : null"
              [primaryLabel]="actionLabel(p.primary)"
              [primaryIcon]="p.primary === 'download' ? 'pi pi-download' : null"
              [secondaryLabel]="actionLabel(p.secondary)"
              [secondaryIcon]="p.secondary === 'download' ? 'pi pi-download' : null"
              [focusPrimary]="p.role === 'region'"
              (primary)="act(p.primary)"
              (secondary)="act(p.secondary)"
            />
          }
        }
      }

      @if (footer(); as f) {
        <div amDrawerFooter class="am-fview__footer">
          <span>{{ f.start }}</span>
          <span class="am-fview__footer-end">{{ f.end }}</span>
        </div>
      }

      <div class="sr-only" aria-live="polite" aria-atomic="true">{{ announcement() }}</div>
    </am-drawer>
  `,
  styles: [
    `
      .am-fview__head {
        display: flex;
        align-items: center;
        gap: var(--am-space-12);
        min-inline-size: 0;
        flex: 1 1 auto;
      }
      .am-fview__badge {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 34px;
        block-size: 34px;
        border-radius: var(--am-radius-button);
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        letter-spacing: var(--am-type-micro-tracking);
        color: var(--am-primary-700);
        background: var(--am-primary-100);
        border: 1px solid var(--am-info-border);
      }
      .am-fview__id {
        flex: 1 1 auto;
        min-inline-size: 0;
        display: flex;
        flex-direction: column;
      }
      .am-fview__name {
        display: flex;
        min-inline-size: 0;
        font-size: var(--am-type-body-size);
        font-weight: 600;
      }
      .am-fview__name-head {
        min-inline-size: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        unicode-bidi: isolate;
      }
      .am-fview__name-tail {
        flex: none;
        white-space: nowrap;
        unicode-bidi: isolate;
      }
      .am-fview__meta {
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-500);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .am-fview__isolate {
        unicode-bidi: isolate;
      }
      .am-fview__nav {
        flex: none;
        display: flex;
        align-items: center;
        gap: var(--am-space-6);
      }
      .am-fview__position {
        min-inline-size: 48px;
        text-align: center;
        font-size: var(--am-type-value-size);
        color: var(--am-ink-700);
      }
      .am-fview__rule {
        flex: none;
        inline-size: 1px;
        block-size: var(--am-space-24);
        background: var(--am-border);
      }
      .am-fview__download {
        border-color: var(--am-control-border-hover);
        font-weight: 500;
      }
      .am-fview__page-field:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      .am-fview__toolbar {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--am-space-8) var(--am-space-16);
        min-block-size: var(--am-drawer-toolbar-height);
        box-sizing: border-box;
        padding: var(--am-space-8) var(--am-space-20);
        border-block-end: 1px solid var(--am-border);
        background: var(--am-surface-raised);
      }
      .am-fview__group {
        display: flex;
        align-items: center;
        gap: var(--am-space-6);
      }
      .am-fview__toolbar-text {
        font-size: var(--am-type-value-size);
        color: var(--am-ink-700);
      }
      .am-fview__level {
        min-inline-size: 46px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .am-fview__page-field {
        inline-size: 46px;
        block-size: 30px;
        box-sizing: border-box;
        padding: 0 var(--am-space-6);
        border: 1px solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        font: inherit;
        font-size: var(--am-type-value-size);
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .am-fview__loading {
        block-size: 100%;
        min-block-size: 280px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--am-space-12);
        font-size: var(--am-type-value-size);
        color: var(--am-ink-700);
      }
      .am-fview__skeleton {
        inline-size: min(520px, 80%);
        block-size: min(560px, 60vh);
        border-radius: var(--am-radius-control);
        background: linear-gradient(90deg, var(--am-skeleton-base) 0%, var(--am-skeleton-shimmer) 50%, var(--am-skeleton-base) 100%);
        background-size: 600px 100%;
        animation: am-fview-shimmer 1.4s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .am-fview__skeleton {
          animation: none;
        }
      }
      @keyframes am-fview-shimmer {
        from {
          background-position: -300px 0;
        }
        to {
          background-position: 300px 0;
        }
      }
      .am-fview__footer {
        flex: none;
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: var(--am-space-6) var(--am-space-16);
        min-block-size: var(--am-drawer-footer-height);
        box-sizing: border-box;
        padding: var(--am-space-8) var(--am-space-20);
        border-block-start: 1px solid var(--am-border);
        background: var(--am-surface);
        font-size: var(--am-type-meta-size);
        color: var(--am-ink-700);
      }
      .am-fview__footer-end {
        color: var(--am-ink-500);
      }
    `,
  ],
})
export class FileViewerComponent {
  protected readonly format = inject(FormatService);
  protected readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly filesService = inject(FilesService);
  private readonly bytesService = inject(FileBytesService);
  private readonly document = inject(DOCUMENT);

  readonly request = input.required<IFileViewerRequest>();
  /** The viewer closed; carries the file LAST SHOWN, for the host's focus return. */
  readonly closed = output<IViewableFile>();

  private readonly drawer = viewChild(DrawerComponent);

  readonly visible = signal(true);
  readonly expanded = signal(false);
  readonly index = signal(0);
  readonly state = signal<ViewState>({ status: 'loading' });
  readonly announcement = signal('');

  readonly pdfZoom = signal<PdfZoom>({ mode: 'fitWidth' });
  readonly pdfPages = signal(0);
  readonly pdfCurrent = signal(1);
  readonly pdfPercent = signal(100);
  readonly pageField = signal('1');
  readonly imageZoom = signal<ImageZoom>('fit');

  private static nextId = 0;
  readonly pageFieldId = `am-fview-page-${FileViewerComponent.nextId++}`;

  readonly files = computed(() => this.request().files);
  readonly file = computed(() => this.files()[this.index()]!);
  readonly type = computed(() => fileTypeOf(this.file().mimeType));
  readonly name = computed(() => splitName(this.file().name));
  readonly nameDir = computed(() => textDirection(this.file().name));
  readonly meta = computed(() => `${this.type().label} · ${this.filesService.size(this.file().sizeBytes)}`);
  readonly position = computed(() => `${this.format.number(this.index() + 1)} / ${this.format.number(this.files().length)}`);

  readonly problem = computed(() => {
    const s = this.state();
    return s.status === 'problem' ? s.problem : null;
  });
  readonly canDownload = computed(() => downloadAllowed(this.problem()));

  readonly pdfBytes = computed(() => {
    const s = this.state();
    return s.status === 'pdf' ? s.bytes : null;
  });
  readonly imageUrl = computed(() => {
    const s = this.state();
    return s.status === 'image' ? s.url : null;
  });
  readonly textState = computed(() => {
    const s = this.state();
    return s.status === 'text' ? s : null;
  });
  readonly csvState = computed(() => {
    const s = this.state();
    return s.status === 'csv' ? s : null;
  });
  readonly csvRowNumbers = computed(() => (this.csvState()?.rows ?? []).map((_, i) => this.format.number(i + 1)));
  readonly csvNote = computed(() => {
    const csv = this.csvState();
    if (!csv?.truncated) return null;
    return this.translate.instant('files.viewer.csv.cut', {
      rows: this.format.count('files.rows', csv.rows.length),
      total: this.format.number(csv.total),
    });
  });

  readonly panel = computed<IPanel | null>(() => {
    const problem = this.problem();
    if (!problem) return null;
    const t = (key: string, params?: Record<string, unknown>): string => this.translate.instant(key, params);
    switch (problem) {
      case 'noPreview': {
        const type = this.type();
        const body =
          type.family === 'photo'
            ? t('files.viewer.noPreview.photo', { type: type.label })
            : type.family === 'other'
              ? t('files.viewer.noPreview.other')
              : t('files.viewer.noPreview.office', { type: type.label });
        return { icon: type.badge, tone: 'muted', role: 'region', title: t('files.viewer.noPreview.title'), body, fileLine: true, primary: 'download', secondary: null };
      }
      case 'storageBlocked':
        return { icon: '⚠', tone: 'warn', role: 'alert', title: t('files.viewer.storageBlocked.title'), body: t('files.viewer.storageBlocked.body'), fileLine: false, primary: 'download', secondary: null };
      case 'deleted':
        return { icon: '⊘', tone: 'muted', role: 'alert', title: t('files.viewer.deleted.title'), body: t('files.viewer.deleted.body'), fileLine: false, primary: null, secondary: null };
      case 'withdrawn':
        return { icon: '⚠', tone: 'warn', role: 'alert', title: t('files.viewer.withdrawn.title'), body: t('files.viewer.withdrawn.body'), fileLine: false, primary: null, secondary: null };
      case 'failed':
      default:
        return { icon: '!', tone: 'danger', role: 'alert', title: t('files.viewer.failed.title'), body: t('files.viewer.failed.body'), fileLine: false, primary: 'retry', secondary: 'download' };
    }
  });

  readonly footer = computed<{ start: string; end: string } | null>(() => {
    const s = this.state();
    const t = (key: string, params?: Record<string, unknown>): string => this.translate.instant(key, params);
    if (s.status === 'text') {
      return {
        start: t('files.viewer.text.footer', { lines: this.format.count('files.lines', s.lines.length) }),
        end: s.truncated ? t('files.viewer.text.cut') : t('files.viewer.text.direction'),
      };
    }
    if (s.status === 'csv') {
      return {
        start: s.truncated
          ? t('files.viewer.csv.footerCut', { shown: this.format.number(s.rows.length), rows: this.format.count('files.rows', s.total) })
          : this.format.count('files.rows', s.total),
        end: t('files.viewer.csv.header'),
      };
    }
    if (s.status === 'pdf' && this.pdfPages() >= PDF_FOOTER_FROM_PAGES) {
      return { start: this.format.count('files.pages', this.pdfPages()), end: t('files.viewer.pdf.lazy') };
    }
    return null;
  });

  private closing = false;
  private loading: Subscription | null = null;
  private objectUrl: string | null = null;
  private started = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.releaseFile());

    // The request arrives once: open at its file. Every later move loads
    // its file at once (moveTo), so a keystroke aborts the fetch in flight
    // immediately rather than at the next change detection.
    effect(() => {
      const request = this.request();
      untracked(() => {
        if (this.started) return;
        this.started = true;
        this.index.set(Math.min(Math.max(request.startIndex, 0), request.files.length - 1));
        this.load();
      });
    });

    const onKeydown = (event: KeyboardEvent): void => this.onKeydown(event);
    this.document.addEventListener('keydown', onKeydown);
    destroyRef.onDestroy(() => this.document.removeEventListener('keydown', onKeydown));
  }

  positionParams(i: number): Record<string, string> {
    return { n: this.format.number(i + 1), total: this.format.number(this.files().length) };
  }

  percentText(percent: number): string {
    return `${this.format.number(percent)}%`;
  }

  actionLabel(action: 'download' | 'retry' | null): string | null {
    if (action === 'download') return this.translate.instant('files.viewer.download');
    if (action === 'retry') return this.translate.instant('files.viewer.retry');
    return null;
  }

  act(action: 'download' | 'retry' | null): void {
    if (action === 'download') this.download();
    else if (action === 'retry') this.load();
  }

  previous(): void {
    if (this.index() > 0) this.moveTo(this.index() - 1);
  }

  next(): void {
    if (this.index() < this.files().length - 1) this.moveTo(this.index() + 1);
  }

  download(): void {
    this.request().download(this.file());
  }

  /**
   * Every close path. The viewer is destroyed by FileViewerService right
   * after this, still VISIBLE: PrimeNG's Drawer removes its mask on destroy
   * only while visible, so flipping `visible` first could leave the mask (and
   * the page's scroll lock) behind if change detection ran in between.
   */
  close(): void {
    if (this.closing) return;
    this.closing = true;
    const last = this.file();
    this.releaseFile();
    this.closed.emit(last);
  }

  showProblem(problem: FileViewProblem): void {
    this.releaseFile();
    this.state.set({ status: 'problem', problem });
  }

  pdfOpened(pageCount: number): void {
    this.pdfPages.set(pageCount);
  }

  pdfPageShown(page: number): void {
    this.pdfCurrent.set(page);
    if (this.document.activeElement?.id !== this.pageFieldId) this.pageField.set(this.format.number(page));
  }

  jumpToPage(): void {
    const n = Number(this.pageField().replace(/[^\d]/g, ''));
    if (!Number.isInteger(n) || n < 1 || n > this.pdfPages()) {
      this.pageField.set(this.format.number(this.pdfCurrent()));
      return;
    }
    this.viewChildPdf()?.goToPage(n);
  }

  zoomIn(): void {
    const s = this.state().status;
    if (s === 'pdf') {
      const next = PDF_ZOOM_STEPS.find((step) => step > this.pdfPercent());
      if (next) this.pdfZoom.set({ mode: 'custom', percent: next });
    } else if (s === 'image') {
      const current = this.imageZoom() === 'fit' ? this.fitScale() : (this.imageZoom() as number);
      const next = IMAGE_ZOOM_STEPS.find((step) => step > current + 1e-6);
      if (next) this.imageZoom.set(next);
    }
  }

  zoomOut(): void {
    const s = this.state().status;
    if (s === 'pdf') {
      const next = [...PDF_ZOOM_STEPS].reverse().find((step) => step < this.pdfPercent());
      if (next) this.pdfZoom.set({ mode: 'custom', percent: next });
    } else if (s === 'image') {
      const current = this.imageZoom() === 'fit' ? this.fitScale() : (this.imageZoom() as number);
      const next = [...IMAGE_ZOOM_STEPS].reverse().find((step) => step < current - 1e-6);
      if (next) this.imageZoom.set(next);
    }
  }

  private readonly pdfView = viewChild(FilePdfViewComponent);
  private viewChildPdf(): FilePdfViewComponent | undefined {
    return this.pdfView();
  }

  /** The scale "Fit" currently shows the image at: zooming steps on from there. */
  private fitScale(): number {
    const img = this.document.querySelector('.am-fimg__img') as HTMLImageElement | null;
    return img && img.naturalWidth ? img.clientWidth / img.naturalWidth : 1;
  }

  private moveTo(i: number): void {
    this.index.set(i);
    this.load();
    this.announcement.set(
      this.translate.instant('files.viewer.moved', { ...this.positionParams(i), name: this.file().name }),
    );
  }

  private load(): void {
    this.releaseFile();
    this.pdfZoom.set({ mode: 'fitWidth' });
    this.imageZoom.set('fit');
    this.pdfPages.set(0);
    this.pdfCurrent.set(1);
    this.pageField.set(this.format.number(1));

    const file = this.file();
    const kind = previewKindFor(file.mimeType);
    // A type with no preview is a stop with its own panel: nothing is fetched.
    if (kind === 'none') {
      this.state.set({ status: 'problem', problem: 'noPreview' });
      return;
    }
    this.state.set({ status: 'loading' });
    this.loading = this.bytesService.load(file, this.request().access).subscribe({
      next: (event) => {
        if (event.type !== 'loaded') return;
        this.loading = null;
        this.present(file, kind, event.bytes);
      },
      error: (error: unknown) => {
        this.loading = null;
        this.state.set({ status: 'problem', problem: error instanceof FileViewError ? error.problem : 'failed' });
      },
    });
  }

  /** Turns the bytes into what the renderer needs, and keeps nothing else. */
  private present(file: IViewableFile, kind: ReturnType<typeof previewKindFor>, bytes: ArrayBuffer): void {
    switch (kind) {
      case 'image':
        this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
        this.state.set({ status: 'image', url: this.objectUrl });
        return;
      case 'text': {
        const decoded = decodeText(bytes);
        this.state.set({ status: 'text', lines: textLines(decoded.text), truncated: decoded.truncated });
        return;
      }
      case 'csv': {
        const parsed = parseCsv(decodeText(bytes, Number.POSITIVE_INFINITY).text, CSV_PREVIEW_ROWS + 1);
        const [header = [], ...rows] = parsed.rows;
        this.state.set({ status: 'csv', header, rows, total: Math.max(parsed.totalRows - 1, 0), truncated: parsed.truncated });
        return;
      }
      case 'pdf':
        this.state.set({ status: 'pdf', bytes });
        return;
      default:
        this.state.set({ status: 'problem', problem: 'noPreview' });
    }
  }

  /** One file at a time: abort the fetch in flight, revoke the URL, drop the bytes. */
  private releaseFile(): void {
    this.loading?.unsubscribe();
    this.loading = null;
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.state.set({ status: 'loading' });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (this.closing || !this.drawer()?.isTopLayer()) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;

    // The arrows mirror in Arabic, matching the arrows on screen: → is previous.
    const rtl = this.language.isRtl();
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (rtl) this.next();
      else this.previous();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (rtl) this.previous();
      else this.next();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.zoomIn();
    } else if (event.key === '-' || event.key === '−') {
      event.preventDefault();
      this.zoomOut();
    } else if (event.key === '0') {
      event.preventDefault();
      if (this.state().status === 'pdf') this.pdfZoom.set({ mode: 'fitWidth' });
      else if (this.state().status === 'image') this.imageZoom.set('fit');
    }
  }
}
