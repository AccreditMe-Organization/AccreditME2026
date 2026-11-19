import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/**
 * ACC-316 PR 7b (P206, P211) — the order of a meeting page's minutes writes.
 *
 * Every minutes write (an attendance tap, an item's discussion or decision, an
 * open action's note, an action item) answers with the WHOLE minutes, and each
 * component writes behind its own lock, so an older answer can arrive after a
 * newer one. The page shows an answer only when it answers the NEWEST write
 * begun: anything older would put back what a later write changed.
 *
 * A dropped answer must not leave the page stale (P211): the newest write may
 * fail, or may have read the minutes before the older write committed. So once
 * an answer was dropped, the page reads the minutes again (`reread`) as soon as
 * the newest write settles, either way, or at once if it already had. The
 * chosen fix is this re-read, not serialising the writes: taps stay immediate.
 *
 * Provided by the meeting page, so its panels and dialogs share one order. A
 * component used on its own (a spec) gets its own order.
 */
@Injectable()
export class MinutesWriteOrder {
  private issued = 0;
  private newestSettled = true;
  private dropped = false;
  /** The page reads the minutes again: an answer was dropped and the newest write has settled. */
  readonly reread = new Subject<void>();

  /** A write is starting: its place in the order. */
  begin(): number {
    this.newestSettled = false;
    return ++this.issued;
  }

  /** A write answered: true when its answer may be shown (it answers the newest write). */
  answered(seq: number): boolean {
    if (seq === this.issued) {
      this.newestSettled = true;
      this.flushDropped();
      return true;
    }
    this.markDropped();
    return false;
  }

  /** A write failed. The newest one failing settles the order, and re-reads if an older answer was dropped. */
  failed(seq: number): void {
    if (seq !== this.issued) return;
    this.newestSettled = true;
    this.flushDropped();
  }

  private markDropped(): void {
    this.dropped = true;
    // The newest write has already answered: nothing later will bring this write's effect.
    if (this.newestSettled) this.flushDropped();
  }

  private flushDropped(): void {
    if (!this.dropped) return;
    this.dropped = false;
    this.reread.next();
  }
}
