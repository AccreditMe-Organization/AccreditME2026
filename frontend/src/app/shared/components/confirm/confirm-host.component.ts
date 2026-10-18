import { Component, ViewEncapsulation } from '@angular/core';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ConfirmDialogCloseLabel } from '../../directives/confirm-dialog-close-label.directive';
import { CONFIRM_DESTRUCTIVE_CLASS, CONFIRM_REJECT_CLASS } from './am-confirm.service';

/**
 * ACC-120 slice 10 — the app's ONE confirmation dialog, rendered once by the
 * shell. Calls never reach it directly: they go through AmConfirmService.ask(),
 * which sets the tone, the labels, the layer and the focus.
 *
 * - Width: Design System Rev 8's "Confirm · 420" (`--am-dialog-confirm`),
 *   capped at the window less a 16px gutter each side, so a 390px phone gets
 *   358. It was sized by its content: 805px for Reactivate, edge to edge on a
 *   phone.
 * - Buttons: the action is filled (primary, or `--am-danger-ink` for a
 *   destructive confirm), Cancel is a text button. PrimeNG's own danger red
 *   (#EF4444) is not used: white on it is 3.8:1, below AA.
 * - No icon: the drawing has one question and two buttons.
 * - amCloseLabel names the × (ACC-83).
 */
@Component({
  selector: 'am-confirm-host',
  standalone: true,
  imports: [ConfirmDialogModule, ConfirmDialogCloseLabel],
  encapsulation: ViewEncapsulation.None,
  template: `<p-confirmDialog amCloseLabel styleClass="am-confirm" [style]="frame" [draggable]="false" />`,
  styles: [
    `
      .am-confirm.p-dialog {
        inline-size: var(--am-dialog-confirm);
        max-inline-size: calc(100vw - 32px);
      }
      .am-confirm .p-confirmdialog-message {
        margin: 0;
      }
      .am-confirm .${CONFIRM_DESTRUCTIVE_CLASS}.p-button {
        background: var(--am-danger-ink);
        border-color: var(--am-danger-ink);
        color: var(--am-surface-raised);
      }
      .am-confirm .${CONFIRM_DESTRUCTIVE_CLASS}.p-button:not(:disabled):hover,
      .am-confirm .${CONFIRM_DESTRUCTIVE_CLASS}.p-button:not(:disabled):active {
        background: color-mix(in srgb, var(--am-danger-ink), var(--am-ink-900) 15%);
        border-color: color-mix(in srgb, var(--am-danger-ink), var(--am-ink-900) 15%);
        color: var(--am-surface-raised);
      }
      .am-confirm .${CONFIRM_REJECT_CLASS}.p-button {
        color: var(--am-ink-700);
      }
    `,
  ],
})
export class ConfirmHostComponent {
  // Width and its cap as the dialog's own style, so they apply whatever the
  // breakpoints PrimeNG writes for its dialogs.
  protected readonly frame = { width: 'var(--am-dialog-confirm)', maxWidth: 'calc(100vw - 32px)' };
}
