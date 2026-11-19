import { Injectable } from '@angular/core';

/**
 * ACC-316 PR 7b (P206) — the order of a meeting page's minutes writes.
 *
 * Every minutes write (an attendance tap, an item's discussion or decision, an
 * open action's note, an action item) answers with the WHOLE minutes, and each
 * component writes behind its own lock, so an older response can arrive after a
 * newer one. The page shows a response only when it answers the NEWEST write
 * begun on the page: anything older would put back what a later write changed.
 *
 * Provided by the meeting page, so its panels and dialogs share one order. A
 * component used on its own (a spec) gets its own order and shows every answer.
 */
@Injectable()
export class MinutesWriteOrder {
  private issued = 0;

  /** A write is starting: its place in the order. */
  begin(): number {
    return ++this.issued;
  }

  /** May this write's answer be shown: is it the newest write begun? */
  isNewest(seq: number): boolean {
    return seq === this.issued;
  }
}
