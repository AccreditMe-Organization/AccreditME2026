import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { PdfJsLoader, PdfJsModule, pdfDocumentOptions } from '../pdf-loader';

/** Fit width (the default), fit page, or a zoom level where 100% is the page's printed size. */
export type PdfZoom = { mode: 'fitWidth' } | { mode: 'fitPage' } | { mode: 'custom'; percent: number };

/** Zoom steps, 50–300% (the drawing). */
export const PDF_ZOOM_STEPS = [50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300] as const;

/** Canvas memory cap per page: about 16.7 million pixels, pdf.js's own default. */
const MAX_CANVAS_PIXELS = 16_777_216;

interface IPageSlot {
  n: number;
  /** The page's size at scale 1, in PDF points — page 1's until the page itself is read. */
  width: number;
  height: number;
  rendered: boolean;
}

type PdfDocument = Awaited<ReturnType<PdfJsModule['getDocument']>['promise']>;
type RenderTask = ReturnType<Awaited<ReturnType<PdfDocument['getPage']>>['render']>;

/**
 * ACC-189 — a PDF, drawn by pdf.js onto canvas (Ahmad, 10 Oct, D5). No text
 * layer and no annotation links (D4): pages are pictures of the document.
 *
 * MEMORY (plan §8): the bytes go to pdf.js once and are transferred to its
 * worker. Pages render LAZILY as they come near the view; each unrendered
 * page keeps its real height so the scrollbar is honest; a canvas far from
 * view is released (width and height 0). Destroying this component destroys
 * the document and its worker.
 *
 * Pages are never mirrored in an Arabic session: a page is the document, not
 * the chrome (ACC-79).
 */
@Component({
  selector: 'am-file-pdf-view',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-fpdf" dir="ltr">
      @for (page of pages(); track page.n) {
        <div
          class="am-fpdf__page"
          [attr.data-page]="page.n"
          [style.width.px]="page.width * scale()"
          [style.height.px]="page.height * scale()"
        >
          <canvas
            [attr.data-page]="page.n"
            role="img"
            [attr.aria-label]="'files.viewer.pdf.pageAria' | translate: { page: format.number(page.n), total: format.number(pages().length) }"
          ></canvas>
          @if (!page.rendered) {
            <div class="am-fpdf__pending" aria-hidden="true">
              {{ 'files.viewer.pdf.loadingPage' | translate: { page: format.number(page.n) } }}
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-fpdf {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--am-space-16);
        padding: var(--am-space-20) var(--am-space-20);
      }
      .am-fpdf__page {
        position: relative;
        flex: none;
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        box-shadow: var(--am-shadow-overlay);
      }
      .am-fpdf__page canvas {
        display: block;
        inline-size: 100%;
        block-size: 100%;
      }
      .am-fpdf__pending {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: var(--am-type-value-size);
        color: var(--am-ink-500);
        background: linear-gradient(90deg, var(--am-skeleton-base) 0%, var(--am-skeleton-shimmer) 50%, var(--am-skeleton-base) 100%);
      }
    `,
  ],
})
export class FilePdfViewComponent {
  protected readonly format = inject(FormatService);
  private readonly loader = inject(PdfJsLoader);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly bytes = input.required<ArrayBuffer>();
  readonly zoom = input<PdfZoom>({ mode: 'fitWidth' });

  readonly opened = output<{ pageCount: number }>();
  readonly failed = output<unknown>();
  readonly currentPage = output<number>();
  /** The effective zoom level shown in the toolbar, whatever the mode. */
  readonly percent = output<number>();

  readonly pages = signal<IPageSlot[]>([]);
  private readonly containerSize = signal<{ width: number; height: number }>({ width: 0, height: 0 });
  private readonly cssPerPoint = signal(4 / 3);

  /** Viewport scale: CSS pixels per PDF point. */
  readonly scale = computed(() => {
    const zoom = this.zoom();
    const first = this.pages()[0];
    const { width, height } = this.containerSize();
    if (zoom.mode === 'custom') return (zoom.percent / 100) * this.cssPerPoint();
    if (!first || width <= 0) return this.cssPerPoint();
    const gutter = 2 * 20 + 2; // the column's padding and the page border
    const fitWidth = Math.max(0.1, (width - gutter) / first.width);
    if (zoom.mode === 'fitWidth') return fitWidth;
    return Math.max(0.1, Math.min(fitWidth, (height - gutter) / first.height));
  });

  private doc: PdfDocument | null = null;
  private loadingTask: { destroy(): Promise<void> } | null = null;
  private readonly renderTasks = new Map<number, RenderTask>();
  private readonly near = new Set<number>();
  private readonly ratios = new Map<number, number>();
  private renderedAt = new Map<number, number>();
  private observers: IntersectionObserver[] = [];
  private resizeObserver: ResizeObserver | null = null;
  private destroyed = false;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.teardown());

    effect(() => {
      const bytes = this.bytes();
      untracked(() => void this.open(bytes));
    });

    // A new scale re-renders what is near the view; the rest re-render when reached.
    effect(() => {
      const scale = this.scale();
      this.percent.emit(Math.round((scale / this.cssPerPoint()) * 100));
      untracked(() => {
        for (const n of this.near) void this.render(n);
      });
    });
  }

  /** Scrolls page `n` to the top of the view. */
  goToPage(n: number): void {
    const el = this.host.nativeElement.querySelector(`.am-fpdf__page[data-page="${n}"]`);
    (el as HTMLElement | null)?.scrollIntoView({ block: 'start' });
  }

  private async open(bytes: ArrayBuffer): Promise<void> {
    try {
      const pdfjs = await this.loader.load();
      if (this.destroyed) return;
      this.cssPerPoint.set(pdfjs.PixelsPerInch.PDF_TO_CSS_UNITS);
      const task = pdfjs.getDocument(pdfDocumentOptions(new Uint8Array(bytes)));
      this.loadingTask = task;
      const doc = await task.promise;
      if (this.destroyed) {
        void task.destroy();
        return;
      }
      this.doc = doc;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      this.pages.set(
        Array.from({ length: doc.numPages }, (_, i) => ({ n: i + 1, width: first.width, height: first.height, rendered: false })),
      );
      this.opened.emit({ pageCount: doc.numPages });
      queueMicrotask(() => this.observe());
    } catch (error) {
      if (!this.destroyed) this.failed.emit(error);
    }
  }

  private observe(): void {
    const root = this.host.nativeElement;
    const view = root.ownerDocument.defaultView;
    if (!view || this.destroyed) return;

    const scroller = root.closest('.am-drawer__body') ?? root.parentElement;
    if (scroller && 'ResizeObserver' in view) {
      this.resizeObserver = new ResizeObserver(() =>
        this.containerSize.set({ width: scroller.clientWidth, height: scroller.clientHeight }),
      );
      this.resizeObserver.observe(scroller);
    }

    const pageOf = (entry: IntersectionObserverEntry): number => Number((entry.target as HTMLElement).dataset['page']);
    const nearby = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const n = pageOf(e);
          if (e.isIntersecting) {
            this.near.add(n);
            void this.render(n);
          } else {
            this.near.delete(n);
          }
        }
      },
      { rootMargin: '100% 0px' },
    );
    const far = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (!e.isIntersecting) this.release(pageOf(e));
      },
      { rootMargin: '400% 0px' },
    );
    const visible = new IntersectionObserver(
      (entries) => {
        for (const e of entries) this.ratios.set(pageOf(e), e.intersectionRatio);
        let best = 0;
        let bestRatio = -1;
        for (const [n, ratio] of this.ratios) if (ratio > bestRatio || (ratio === bestRatio && n < best)) [best, bestRatio] = [n, ratio];
        if (best) this.currentPage.emit(best);
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    this.observers = [nearby, far, visible];
    for (const el of Array.from(root.querySelectorAll('.am-fpdf__page'))) {
      for (const o of this.observers) o.observe(el);
    }
  }

  private async render(n: number): Promise<void> {
    const doc = this.doc;
    if (!doc || this.destroyed) return;
    const scale = this.scale();
    if (this.renderedAt.get(n) === scale) return;
    this.renderTasks.get(n)?.cancel();

    const page = await doc.getPage(n);
    if (this.destroyed || this.scale() !== scale) return;
    const unscaled = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });
    const canvas = this.host.nativeElement.querySelector(`canvas[data-page="${n}"]`) as HTMLCanvasElement | null;
    if (!canvas) return;

    // Sharp on high-density screens, within the memory cap.
    const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PIXELS / (viewport.width * viewport.height)));
    canvas.width = Math.floor(viewport.width * dpr);
    canvas.height = Math.floor(viewport.height * dpr);

    const task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    this.renderTasks.set(n, task);
    try {
      await task.promise;
      this.renderedAt.set(n, scale);
      this.pages.update((pages) =>
        pages.map((p) => (p.n === n ? { ...p, width: unscaled.width, height: unscaled.height, rendered: true } : p)),
      );
    } catch {
      // Cancelled by a newer render or by teardown; the newer one decides.
    } finally {
      if (this.renderTasks.get(n) === task) this.renderTasks.delete(n);
    }
  }

  /** A page far from view gives its canvas memory back, and renders again when reached. */
  private release(n: number): void {
    this.renderTasks.get(n)?.cancel();
    this.renderTasks.delete(n);
    if (!this.renderedAt.has(n)) return;
    this.renderedAt.delete(n);
    const canvas = this.host.nativeElement.querySelector(`canvas[data-page="${n}"]`) as HTMLCanvasElement | null;
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    this.pages.update((pages) => pages.map((p) => (p.n === n ? { ...p, rendered: false } : p)));
  }

  private teardown(): void {
    this.destroyed = true;
    for (const task of this.renderTasks.values()) task.cancel();
    this.renderTasks.clear();
    for (const o of this.observers) o.disconnect();
    this.resizeObserver?.disconnect();
    for (const canvas of Array.from(this.host.nativeElement.querySelectorAll('canvas'))) {
      canvas.width = 0;
      canvas.height = 0;
    }
    // Destroying the loading task destroys the document and its worker.
    void this.loadingTask?.destroy();
    this.doc = null;
    this.loadingTask = null;
  }
}
