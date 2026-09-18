import { Injectable, signal } from '@angular/core';

/**
 * The stack of open modal layers (ACC-111).
 *
 * Exists because ESCAPE MUST REACH ONLY THE TOP LAYER, and nothing in the DOM
 * gives us that for free. `EditDialogComponent` listens for Escape on
 * `document` in the CAPTURE phase — it has to, because it must decide about
 * unsaved work before anything else closes anything. Capture listeners on the
 * same target fire in REGISTRATION order, and the parent dialog is always
 * constructed first, so a nested layer can never win by listening later or by
 * calling stopPropagation: the parent has already run.
 *
 * Without this, pressing Escape on a date picker stacked above a form would
 * ask "Discard changes?" about the form — a worse bug than the one the layer
 * was introduced to fix.
 *
 * So each layer registers while it is open, and every Escape handler asks
 * whether it is on top before acting. The stack is LIFO by construction: a
 * layer opened later is closed first.
 */
@Injectable({ providedIn: 'root' })
export class LayerStackService {
  private nextId = 0;
  private readonly stack = signal<number[]>([]);

  /** Registers a newly opened layer and returns its id. */
  push(): number {
    const id = ++this.nextId;
    this.stack.update((s) => [...s, id]);
    return id;
  }

  /** Removes a closed layer, wherever it sits — closing out of order is legal. */
  remove(id: number): void {
    this.stack.update((s) => s.filter((entry) => entry !== id));
  }

  /** Whether `id` is the topmost open layer, and so owns Escape. */
  isTop(id: number): boolean {
    const s = this.stack();
    return s.length > 0 && s[s.length - 1] === id;
  }

  /** How many layers are open. For tests and diagnostics. */
  depth(): number {
    return this.stack().length;
  }
}
