import { Injectable, signal } from '@angular/core';

/** Why the rows under a keyboard user changed. The answer differs per cause. */
type FocusIntent =
  | { kind: 'row-removed'; index: number }
  | { kind: 'trigger-lost'; key: string | null; index: number }
  | { kind: 'set-replaced'; fromRow: boolean }
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

  /**
   * A dialog closed and its trigger no longer exists, because the rows were
   * recreated underneath it. TWO CAUSES THAT NEED DIFFERENT ANSWERS:
   *
   * - **Delete**: the record is gone. Its POSITION is right — the next row is
   *   where work continues.
   * - **Edit**: the record still exists and may have MOVED, if the list is
   *   sorted on the field just changed. Its KEY is right; restoring by
   *   position would land on whoever now occupies the old slot, which is a
   *   different record — the same error that makes first-row the answer for a
   *   replaced set.
   *
   * So identity first, position as the fallback. The dialog cannot tell which
   * happened (a save and a delete look identical from there), but the DOM can:
   * if a row still carries the key, it was an edit.
   */
  noteTriggerLost(key: string | null, index: number): void {
    this.intent = { kind: 'trigger-lost', key, index };
  }

  /**
   * A sort, page, filter or search replaced the rows.
   *
   * WHERE FOCUS WAS decides whether moving it helps or steals, and that is
   * captured HERE, at the moment of the change — by the time the new rows
   * render, the evidence is gone. A user usually replaces the set by using a
   * control inside the table: a sort header, the next-page button. Focus is on
   * that control and they may well use it again, so jumping them to row 1
   * would take it out from under them. Only a reader standing ON A ROW is
   * moved.
   */
  noteSetReplaced(): void {
    const active = document.activeElement;
    const fromRow = !!(active && active.closest && active.closest('.am-list-row'));
    this.intent = { kind: 'set-replaced', fromRow };
  }

  /**
   * Called once the new rows are in the DOM. Returns what it focused, so a
   * spec can assert on the decision rather than on a side effect.
   */
  restore(container: HTMLElement | null): 'row' | 'container' | 'none' {
    const intent = this.intent;
    this.intent = null;
    if (!intent || !container) return 'none';

    // The set was replaced while the user held a table CONTROL — a sort
    // header, a pager button. Leave it alone: they are still holding it.
    if (intent.kind === 'set-replaced' && !intent.fromRow) return 'none';

    // And never take focus back from someone who has since moved elsewhere.
    const active = document.activeElement;
    const wasInList = active === document.body || active === null || container.contains(active);
    if (!wasInList) return 'none';

    const rows = Array.from(container.querySelectorAll<HTMLElement>('.am-list-row'));
    if (rows.length === 0) {
      container.focus();
      return 'container';
    }

    const target = this.targetFor(intent, container, rows);
    target.focus();
    return 'row';
  }

  private targetFor(
    intent: NonNullable<FocusIntent>,
    container: HTMLElement,
    rows: HTMLElement[],
  ): HTMLElement {
    if (intent.kind === 'set-replaced') return rows[0];

    if (intent.kind === 'trigger-lost' && intent.key !== null) {
      const byKey = container.querySelector<HTMLElement>(
        `.am-list-row[data-am-row-key="${CSS.escape(intent.key)}"]`,
      );
      // Found: the record survived and may have moved — follow it.
      // Not found: it was deleted, so fall through to its position.
      if (byKey) return byKey;
    }

    const index = intent.kind === 'row-removed' ? intent.index : intent.index;
    return rows[Math.min(Math.max(index, 0), rows.length - 1)];
  }

  announce(message: string): void {
    // Re-announce an identical message by clearing first; a live region that
    // is set to the value it already holds says nothing.
    this.announcement.set('');
    setTimeout(() => this.announcement.set(message));
  }
}
