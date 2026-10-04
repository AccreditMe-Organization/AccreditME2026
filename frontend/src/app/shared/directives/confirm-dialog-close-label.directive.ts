import {
  DestroyRef,
  Directive,
  Injector,
  afterNextRender,
  inject,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';

/**
 * ACC-83 — gives the confirmation dialog's close button an accessible name,
 * because PrimeNG's own API cannot.
 *
 * ## The input exists and does nothing
 *
 * `ConfirmDialog` declares a `closeAriaLabel` input, and binding it looks like
 * the fix. It is not: verified by extracting the component's inline template
 * from `primeng-confirmdialog.mjs`, which **never mentions `closeAriaLabel` or
 * `closeButtonProps`** — the only thing it forwards to the `<p-dialog>` it
 * renders is `[closable]`. So the input is accepted, stored, and read by
 * nothing. `Dialog` itself binds `[ariaLabel]="closeAriaLabel"` with no
 * fallback of its own, so the attribute is simply absent and the button has no
 * name at all.
 *
 * That is the same shape this codebase keeps finding — a real-looking setting
 * that silently does nothing — except here it belongs to a dependency.
 *
 * ## Why not just remove the button
 *
 * `closable: false` was the obvious alternative, since the × duplicates Reject.
 * It is wrong, and the source says why:
 *
 *     if (this.closeOnEscape && this.closable) { this.bindDocumentEscapeListener(); }
 *
 * `closable: false` ALSO DISABLES ESCAPE. Removing an unnamed button at the
 * cost of a keyboard user's dismiss path is strictly worse than naming it.
 *
 * ## Why a directive, and the precedent for it
 *
 * Same reason `InputNumberLatinDigits` exists (ACC-94): a PrimeNG component
 * ignores something it should read, the gap is not fixable within PrimeNG, and
 * a small directive at the one use site is cheaper than either a fork or a
 * per-caller workaround. `<p-confirmDialog>` is declared exactly once, in the
 * app shell, so this is applied exactly once and covers every confirmation in
 * the app — including ones not yet written.
 *
 * ## How it knows when to run
 *
 * It subscribes to `ConfirmationService.requireConfirmation$` — the same
 * observable `ConfirmDialog` itself subscribes to, so there is no polling and
 * no guess about when a dialog appears — then sets the attribute after the next
 * render, which is when the button exists.
 *
 * The button is found by PrimeNG's own `.p-dialog-close-button` class, which is
 * what the rendered DOM actually carries — `data-pc-section` is `"root"` on it,
 * not `"closebutton"`, measured rather than assumed. If the markup ever
 * changes the attribute is simply not set: this never throws, and the spec
 * beside it is what fails.
 */
@Directive({
  selector: 'p-confirmDialog[amCloseLabel]',
  standalone: true,
})
export class ConfirmDialogCloseLabel {
  private readonly confirmation = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.confirmation.requireConfirmation$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        // Read at open time, not once at construction: the reading language can
        // change between two confirmations in the same session.
        const label = this.translate.instant('common.close');
        afterNextRender(() => this.apply(label), { injector: this.injector });
      });
  }

  private apply(label: string): void {
    const button = document.querySelector<HTMLElement>(
      '.p-confirmdialog button.p-dialog-close-button',
    );
    button?.setAttribute('aria-label', label);
  }
}
