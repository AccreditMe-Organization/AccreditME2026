import { Injectable, signal } from '@angular/core';

/** Why the rows under a keyboard user changed. The answer differs per cause. */
type FocusIntent =
  | { kind: 'row-removed'; index: number }
  | { kind: 'set-replaced' }
  | null;

/**
 * Where focus goes when the ROW SET CHANGES under a keyboard user (ACC-111).
 *
 * A reader on row 7 sorts a column, turns the page, applies a filter, or
 * deletes that row from its own menu. The row they were standing on is gone,
 * or is now a different record. Left alone, focus falls to `<body>` — the user
 * is silently dumped at the top of the document, and NO MOUSE TEST CAN SEE IT.
 *
 * ## Two causes, two answers, deliberately
 *
 * - **The focused row was REMOVED** (deleted, deactivated out of the filter):
 *   focus the row that takes its place — the same index, or the last row if it
 *   was the last. Work continues where it was, which is the WAI-ARIA practice
 *   for a removed item and what someone deleting three rows in a row expects.
 *
 * - **The whole SET was replaced** (sort, page, filter, search): focus the
 *   FIRST row. Keeping the index here would be worse than useless: row 7 of
 *   the new sort is an unrelated record, and landing there implies a
 *   continuity that does not exist.
 *
 * Either way the change is ANNOUNCED, because a silent focus jump is its own
 * defect: a screen-reader user has no other way to learn the list moved under
 * them.
 *
 * If the new set is empty there is no row to hold focus, so it goes to the
 * list container, which is focusable for exactly this reason.
 */
@Injectable({ providedIn: 'root' })
export class ListFocusService {
  private intent: FocusIntent = null;

  /** Read by DataListComponent's live region. */
  readonly announcement = signal('');

  /** The focused row is being destroyed. Called by ListRowDirective. */
  noteRowRemoved(index: number): void {
    this.intent = { kind: 'row-removed', index };
  }

  /** A sort, page, filter or search replaced the rows. */
  noteSetReplaced(): void {
    this.intent = { kind: 'set-replaced' };
  }

  /**
   * Called once the new rows are in the DOM. Returns what it focused, so a
   * spec can assert on the decision rather than on a side effect.
   */
  restore(container: HTMLElement | null): 'row' | 'container' | 'none' {
    const intent = this.intent;
    this.intent = null;
    if (!intent || !container) return 'none';

    // Only act if the user was actually IN the list. Stealing focus from
    // someone who has since clicked elsewhere is worse than doing nothing.
    const active = document.activeElement;
    const wasInList = active === document.body || active === null || container.contains(active);
    if (!wasInList) return 'none';

    const rows = Array.from(container.querySelectorAll<HTMLElement>('.am-list-row'));
    if (rows.length === 0) {
      container.focus();
      return 'container';
    }

    const target =
      intent.kind === 'row-removed' ? rows[Math.min(intent.index, rows.length - 1)] : rows[0];
    target.focus();
    return 'row';
  }

  announce(message: string): void {
    // Re-announce an identical message by clearing first; a live region that
    // is set to the value it already holds says nothing.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(message));
  }
}
