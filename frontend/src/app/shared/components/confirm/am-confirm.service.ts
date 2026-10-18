import { DOCUMENT } from '@angular/common';
import { Injectable, NgZone, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { LayerStackService } from '../../overlay/layer-stack.service';

/**
 * Destructive: the action is filled danger and Cancel gets focus. Neutral: the
 * action is filled primary and gets focus. Nothing else picks a style.
 */
export type ConfirmTone = 'destructive' | 'neutral';

export interface AmConfirmOptions {
  tone: ConfirmTone;
  /** The question, already translated. */
  header: string;
  /** The consequence, already translated. */
  message: string;
  /** The action's verb, already translated ("Deactivate role"). Never Yes. */
  acceptLabel: string;
  /** Defaults to Cancel. */
  rejectLabel?: string;
  accept: () => void;
  /** Runs for Cancel, ×, and Escape alike. */
  reject?: () => void;
  /** Where focus goes on close. Defaults to whatever had it when ask() ran. */
  opener?: HTMLElement | null;
}

/** The classes the host's styles key on. */
export const CONFIRM_ACCEPT_CLASS = 'am-confirm__accept';
export const CONFIRM_REJECT_CLASS = 'am-confirm__reject';
export const CONFIRM_DESTRUCTIVE_CLASS = 'am-confirm__accept--destructive';

/**
 * ACC-120 slice 10 — the ONE way to ask for a confirmation.
 *
 * Every confirm in the app goes through `ask()`, and `check:confirm-through-
 * helper` fails a `ConfirmationService.confirm(` anywhere else, so the
 * twenty-odd calls cannot drift apart again. Design System Rev 8, "Confirm ·
 * 420": one question, two buttons, no fields; destructive is filled only here,
 * inside its confirmation, where it is the intended act.
 *
 * What `tone` decides, and nothing else may:
 * - the action's style (filled danger, or filled primary) — Cancel is always a
 *   text button, so the safe choice never looks like the main one;
 * - which button has focus when it opens: Cancel for destructive, the action
 *   for neutral. PrimeNG's own `defaultFocus` does nothing in v21 (it looks up
 *   class names the buttons no longer carry, and nothing calls it); its dialog
 *   focuses the first footer button. So this moves focus once, the first time
 *   it enters the confirm.
 *
 * And what every confirm now gets:
 * - A LAYER (LayerStackService) for as long as it is open, so Escape closes the
 *   confirm and never the dialog under it. Only edit-dialog's discard did this;
 *   an Escape on Vacate Head closed the confirm AND the Head panel.
 * - FOCUS BACK on close, to the opener. PrimeNG restores nothing: its markup is
 *   removed and focus fell to <body>. An opener inside a row menu (the item is
 *   gone once the menu closes) resolves to that menu's ⋯, through the
 *   trigger's aria-controls. Focus is moved back only if nothing else took it,
 *   so an accept that opens or closes something keeps the focus it set.
 */
@Injectable({ providedIn: 'root' })
export class AmConfirmService {
  private readonly confirmation = inject(ConfirmationService);
  private readonly layers = inject(LayerStackService);
  private readonly translate = inject(TranslateService);
  private readonly document = inject(DOCUMENT);
  private readonly zone = inject(NgZone);

  ask(options: AmConfirmOptions): void {
    if (!options.acceptLabel?.trim()) {
      throw new Error('AmConfirmService.ask(): acceptLabel is required — a verb that names the action, never Yes.');
    }
    if (!options.header?.trim() || !options.message?.trim()) {
      throw new Error('AmConfirmService.ask(): header and message are required.');
    }

    const destructive = options.tone === 'destructive';
    const opener = options.opener ?? resolveOpener(this.document);
    const layer = this.layers.push();
    let settled = false;

    const settle = (then?: () => void): void => {
      if (settled) return;
      settled = true;
      this.layers.remove(layer);
      stopFocusing();
      then?.();
      this.returnFocus(opener);
    };

    const stopFocusing = this.focusOnOpen(destructive ? CONFIRM_REJECT_CLASS : CONFIRM_ACCEPT_CLASS);

    this.confirmation.confirm({
      header: options.header,
      message: options.message,
      acceptLabel: options.acceptLabel,
      rejectLabel: options.rejectLabel ?? this.translate.instant('common.cancel'),
      acceptButtonStyleClass: destructive ? `${CONFIRM_ACCEPT_CLASS} ${CONFIRM_DESTRUCTIVE_CLASS}` : CONFIRM_ACCEPT_CLASS,
      rejectButtonStyleClass: CONFIRM_REJECT_CLASS,
      rejectButtonProps: { text: true, severity: 'secondary' },
      accept: () => settle(options.accept),
      reject: () => settle(options.reject),
    });
  }

  /**
   * The first time focus enters the confirm, put it on the button the tone
   * names. Returns a stop function. Gives up after a few seconds, so a confirm
   * that never opened leaves no listener behind.
   */
  private focusOnOpen(buttonClass: string): () => void {
    const doc = this.document;
    let stopped = false;
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target as HTMLElement | null;
      const dialog = target?.closest?.('.p-confirmdialog');
      if (!dialog) return;
      stop();
      const wanted = dialog.querySelector<HTMLElement>(`button.${buttonClass}`);
      if (wanted && wanted !== target) wanted.focus();
    };
    const timer = setTimeout(() => stop(), 4000);
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      doc.removeEventListener('focusin', onFocusIn, true);
    };
    this.zone.runOutsideAngular(() => doc.addEventListener('focusin', onFocusIn, true));
    return stop;
  }

  /** Back to the opener, unless something else has taken focus since. */
  private returnFocus(opener: HTMLElement | null): void {
    setTimeout(() => {
      const active = this.document.activeElement as HTMLElement | null;
      const free = !active || active === this.document.body || !!active.closest('.p-confirmdialog');
      if (!free) return;
      if (opener?.isConnected) opener.focus();
    });
  }
}

/**
 * Whatever has focus when ask() runs. A row-menu item is about to disappear, so
 * it resolves to the menu's own trigger (the row's ⋯), found by the
 * aria-controls the CDK menu trigger sets.
 */
export function resolveOpener(doc: Document): HTMLElement | null {
  const active = doc.activeElement as HTMLElement | null;
  if (!active || active === doc.body) return null;
  const menu = active.closest<HTMLElement>('[role="menu"][id]');
  if (menu) {
    const trigger = doc.querySelector<HTMLElement>(`[aria-controls="${menu.id}"]`);
    if (trigger) return trigger;
  }
  return active;
}
