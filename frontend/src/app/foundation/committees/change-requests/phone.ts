import { DOCUMENT } from '@angular/common';
import { DestroyRef, Signal, inject, signal } from '@angular/core';
import { LIST_DIALOG_SHEET_BELOW_PX } from '../../../shared/components/list-dialog/list-dialog.component';

/**
 * ACC-240 — true below the shared phone width, the one the list popups switch
 * to a sheet at (LIST_DIALOG_SHEET_BELOW_PX, 760; ACC-242 will move it to 768 in
 * one place). The request page's sticky action bar and the banner's short line
 * follow it, so nothing here keeps a breakpoint of its own.
 */
export function injectIsPhone(): Signal<boolean> {
  const view = inject(DOCUMENT).defaultView;
  const phone = signal(false);
  const query = view?.matchMedia?.(`(max-width: ${LIST_DIALOG_SHEET_BELOW_PX - 0.02}px)`);
  if (query) {
    phone.set(query.matches);
    const onChange = (e: MediaQueryListEvent): void => phone.set(e.matches);
    query.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', onChange));
  }
  return phone.asReadonly();
}
