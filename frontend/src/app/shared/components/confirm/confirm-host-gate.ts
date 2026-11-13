import { Injectable, signal } from '@angular/core';

/**
 * ACC-90 — the confirm host loads after start-up, so a confirm asked for before
 * it has loaded must wait for it rather than be lost.
 *
 * The shell renders `<am-confirm-host>` inside `@defer (on idle; when
 * gate.needed())`: it loads once the browser is idle, or at once when a confirm
 * is asked for first. PrimeNG's ConfirmationService emits through a Subject,
 * which does not replay, so a confirm emitted before the host's p-confirmDialog
 * subscribed would vanish. AmConfirmService.ask() therefore hands its emission
 * to whenReady(): it runs now if the host is listening, and otherwise as soon as
 * the host says it is.
 *
 * Its own file, apart from AmConfirmService, so the shell can read `needed`
 * without pulling the confirm service into the start-up bundle.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmHostGate {
  /** True once a confirm has been asked for before the host was there. */
  readonly needed = signal(false);

  private ready = false;
  private queue: (() => void)[] = [];

  /** Run `open` now if the host is listening, else as soon as it is. */
  whenReady(open: () => void): void {
    if (this.ready) {
      open();
      return;
    }
    this.queue.push(open);
    this.needed.set(true);
  }

  /** The host calls this once its p-confirmDialog is subscribed. */
  hostReady(): void {
    this.ready = true;
    const waiting = this.queue;
    this.queue = [];
    for (const open of waiting) open();
  }

  /** The host is gone (the shell was torn down): wait for the next one. */
  hostGone(): void {
    this.ready = false;
  }
}
