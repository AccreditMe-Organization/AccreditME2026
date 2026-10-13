import { DestroyRef, Signal, effect, inject, signal } from '@angular/core';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';

/**
 * ACC-120 slice 5 — the date view, as New task, Set acting head and the task
 * request dialog have it: choosing a date SWAPS the dialog body for the inline
 * calendar — same dialog, same footer, the other values still live — so no
 * floating panel opens inside a dialog and the body is the taller of the two,
 * never the sum.
 *
 * The view is a LAYER: Escape closes it before EditDialogComponent's own
 * capture-phase handler can ask about discarding the form (ACC-111).
 *
 * `K` names which date is being picked, for a dialog with more than one.
 * Call from a component's injection context.
 */
export class DateView<K extends string> {
  private readonly layers = inject(LayerStackService);
  private readonly open = signal<K | null>(null);
  private layerId: number | null = null;

  /** Which date the calendar is choosing, or null when the fields show. */
  readonly picking: Signal<K | null> = this.open.asReadonly();

  constructor() {
    effect(() => {
      const isOpen = this.open() !== null;
      if (isOpen && this.layerId === null) {
        this.layerId = this.layers.push();
      } else if (!isOpen && this.layerId !== null) {
        this.layers.remove(this.layerId);
        this.layerId = null;
      }
    });
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || this.open() === null) return;
      if (this.layerId === null || !this.layers.isTop(this.layerId)) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    };
    document.addEventListener('keydown', onKeydown);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKeydown);
      if (this.layerId !== null) this.layers.remove(this.layerId);
    });
  }

  openFor(key: K): void {
    this.open.set(key);
  }

  close(): void {
    this.open.set(null);
  }
}
