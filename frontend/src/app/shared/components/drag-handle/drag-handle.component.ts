import { Component, ViewEncapsulation, input } from '@angular/core';

/**
 * ACC-212 — a sortable row's drag handle: the drawing's ⣿, a real 22 × 26
 * button, and the styles of the row it moves.
 *
 * The caller puts `cdkDragHandle` on this element (the CDK accepts any element
 * inside the `cdkDrag` row) and binds its own `(keydown)` / `(focusout)` here:
 * the inner button's events bubble to it. Keyboard pick-up is the caller's
 * (it knows the list), so this component only draws.
 *
 * Its styles are not encapsulated, like `am-capped-panel`'s, because they style
 * the CALLER's row (`am-drag-row`): the row picked up from the keyboard
 * (`am-drag-row--lifted`), the CDK's drag preview and its placeholder. One
 * place, so the next sortable list gets the same look.
 */
@Component({
  selector: 'am-drag-handle',
  standalone: true,
  encapsulation: ViewEncapsulation.None,
  template: `<button
    type="button"
    class="am-drag-handle"
    [attr.aria-label]="label()"
    [attr.aria-describedby]="describedBy()"
    [attr.aria-pressed]="pressed()"
    [disabled]="disabled()"
  >
    <span aria-hidden="true">⣿</span>
  </button>`,
  styles: [
    `
      am-drag-handle {
        flex: none;
        display: inline-flex;
      }
      /* Every size and colour is a token: the handle's box is the Stage Tasks
         drawing's (--am-drag-handle-*), the rest the design system's. */
      .am-drag-handle {
        inline-size: var(--am-drag-handle-inline);
        block-size: var(--am-drag-handle-block);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: var(--am-rule-width) solid var(--am-control-border);
        border-radius: var(--am-radius-control);
        background: var(--am-surface-raised);
        color: var(--am-ink-500);
        font-size: var(--am-type-micro-size);
        cursor: grab;
        touch-action: none;
      }
      .am-drag-handle:hover:not(:disabled) {
        border-color: var(--am-control-border-hover);
        color: var(--am-ink-700);
      }
      .am-drag-handle:focus-visible {
        outline: var(--am-focus-ring-width) solid var(--am-focus-ring);
        outline-offset: var(--am-focus-ring-offset);
      }
      /* Disabled as the design system draws a disabled icon button: the disabled
         control border and the ink kept for disabled glyphs, not a fade. */
      .am-drag-handle:disabled {
        cursor: default;
        border-color: var(--am-control-border-disabled);
        color: var(--am-ink-300);
      }
      .am-drag-handle[aria-pressed='true'] {
        cursor: grabbing;
        border-color: var(--am-primary-600);
        color: var(--am-primary-700);
        background: var(--am-primary-100);
      }
      /* The row picked up from the keyboard: a tint and a ring, the same in both directions. */
      .am-drag-row--lifted {
        background: var(--am-primary-50);
        outline: var(--am-focus-ring-width) solid var(--am-primary-600);
        outline-offset: calc(-1 * var(--am-focus-ring-width));
      }
      /* The preview sits inside the caller's list, where the caller's own row rule
         (an encapsulated class plus attribute, also two selectors) would tie with
         one ".am-drag-row.cdk-drag-preview" and could win the bottom edge. The
         class is repeated to win that tie on every side. */
      .am-drag-row.am-drag-row.cdk-drag-preview {
        list-style: none;
        background: var(--am-surface-raised);
        border: var(--am-rule-width) solid var(--am-border-strong);
        border-radius: var(--am-radius-button);
        box-shadow: var(--am-shadow-overlay);
      }
      /* Where the row will land: an empty dashed slot of the row's own height. */
      .am-drag-row.am-drag-row.cdk-drag-placeholder {
        background: var(--am-primary-50);
        outline: var(--am-rule-width) dashed var(--am-primary-600);
        outline-offset: calc(-1 * var(--am-rule-width));
      }
      .am-drag-row.cdk-drag-placeholder > * {
        visibility: hidden;
      }
    `,
  ],
})
export class DragHandleComponent {
  /** The accessible name, e.g. "Reorder task 2: Collect the records". */
  readonly label = input.required<string>();
  /** The id of the line that says how to move it from the keyboard. */
  readonly describedBy = input<string | null>(null);
  /** Picked up from the keyboard. */
  readonly pressed = input(false);
  readonly disabled = input(false);
}
