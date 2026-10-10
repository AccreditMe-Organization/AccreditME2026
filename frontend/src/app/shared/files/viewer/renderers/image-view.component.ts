import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';

/** The image's zoom: fit to the view, or a scale of its actual pixels (1 = 100%). */
export type ImageZoom = number | 'fit';

/**
 * ACC-189 — an image on a checkerboard, so a transparent PNG reads correctly.
 * Fit to the view by default; an explicit scale shows the image at that
 * multiple of its actual pixels, and once it is larger than the view, dragging
 * moves it (the cursor says so). The object URL is the host's: it creates it
 * and revokes it.
 */
@Component({
  selector: 'am-file-image-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #stage
      class="am-fimg"
      [class.am-fimg--fit]="zoom() === 'fit'"
      [class.am-fimg--pannable]="pannable()"
      [class.am-fimg--dragging]="dragging()"
      (pointerdown)="startDrag($event)"
      (pointermove)="drag($event)"
      (pointerup)="endDrag($event)"
      (pointercancel)="endDrag($event)"
    >
      <img
        class="am-fimg__img"
        [src]="url()"
        [alt]="alt()"
        [style.width.px]="displayWidth()"
        (load)="loaded($event)"
        (error)="failed.emit()"
        draggable="false"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        block-size: 100%;
      }
      .am-fimg {
        block-size: 100%;
        box-sizing: border-box;
        overflow: auto;
        display: grid;
        place-items: center;
        padding: var(--am-space-16);
        background: repeating-conic-gradient(var(--am-skeleton-base) 0% 25%, var(--am-skeleton-shimmer) 0% 50%) 0 0 / 20px 20px;
      }
      .am-fimg__img {
        display: block;
        box-shadow: var(--am-shadow-overlay);
        user-select: none;
      }
      .am-fimg--fit .am-fimg__img {
        max-inline-size: 100%;
        max-block-size: 100%;
        object-fit: contain;
      }
      .am-fimg--pannable {
        cursor: grab;
        place-items: start;
      }
      .am-fimg--dragging {
        cursor: grabbing;
      }
    `,
  ],
})
export class FileImageViewComponent {
  readonly url = input.required<string>();
  /** The file name: the image's alternative text. */
  readonly alt = input.required<string>();
  readonly zoom = input<ImageZoom>('fit');
  readonly failed = output<void>();
  readonly naturalSize = output<{ width: number; height: number }>();

  private readonly stage = viewChild<ElementRef<HTMLDivElement>>('stage');
  private readonly natural = signal<{ width: number; height: number } | null>(null);
  readonly dragging = signal(false);
  private dragFrom: { x: number; y: number; left: number; top: number } | null = null;

  readonly displayWidth = computed(() => {
    const zoom = this.zoom();
    const natural = this.natural();
    return zoom === 'fit' || !natural ? null : Math.round(natural.width * zoom);
  });

  /** Past fit — the image is larger than the view — so dragging moves it. */
  readonly pannable = computed(() => {
    const width = this.displayWidth();
    const stage = this.stage()?.nativeElement;
    return width !== null && !!stage && (width > stage.clientWidth || (this.natural()?.height ?? 0) * (this.zoom() as number) > stage.clientHeight);
  });

  loaded(event: Event): void {
    const img = event.target as HTMLImageElement;
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    this.natural.set(size);
    this.naturalSize.emit(size);
  }

  startDrag(event: PointerEvent): void {
    const stage = this.stage()?.nativeElement;
    if (!stage || !this.pannable() || event.button !== 0) return;
    this.dragFrom = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    this.dragging.set(true);
    stage.setPointerCapture?.(event.pointerId);
  }

  drag(event: PointerEvent): void {
    const stage = this.stage()?.nativeElement;
    if (!stage || !this.dragFrom) return;
    stage.scrollLeft = this.dragFrom.left - (event.clientX - this.dragFrom.x);
    stage.scrollTop = this.dragFrom.top - (event.clientY - this.dragFrom.y);
  }

  endDrag(event: PointerEvent): void {
    if (!this.dragFrom) return;
    this.dragFrom = null;
    this.dragging.set(false);
    this.stage()?.nativeElement.releasePointerCapture?.(event.pointerId);
  }
}
