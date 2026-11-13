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
 * Ready unless told otherwise: only the shell, which defers the host, says it
 * is coming (expectHost(), at construction, before any page can ask). Anything
 * rendered without the shell — a spec with its own p-confirmDialog — is
 * served at once, as before.
 *
 * A confirm still waiting when the shell goes (sign-out) is DROPPED, never
 * shown by the next shell's host: its callbacks belong to components that no
 * longer exist. hostGone() returns the gate to its starting state.
 *
 * Its own file, apart from AmConfirmService, so the shell can read `needed`
 * without pulling the confirm service into the start-up bundle.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmHostGate {
  /** True once a confirm has been asked for before the host was there. */
  readonly needed = signal(false);

  private ready = true;
  private queue: { open: () => void; drop: () => void }[] = [];

  /**
   * Run `open` now if the host is listening, else as soon as it is. `drop`
   * runs instead if the shell goes before the host ever listened.
   */
  whenReady(open: () => void, drop: () => void): void {
    if (this.ready) {
      open();
      return;
    }
    this.queue.push({ open, drop });
    this.needed.set(true);
  }

  /** The shell defers the host: hold confirms until it reports in. */
  expectHost(): void {
    this.ready = false;
  }

  /** The host calls this once its p-confirmDialog is subscribed. */
  hostReady(): void {
    this.ready = true;
    const waiting = this.queue;
    this.queue = [];
    for (const { open } of waiting) open();
  }

  /**
   * The shell is gone (sign-out), and its host with it, loaded or not. Every
   * waiting confirm is dropped, and the gate is as it was before any shell:
   * ready, nothing needed. The next shell's expectHost() makes it wait again.
   */
  hostGone(): void {
    const waiting = this.queue;
    this.queue = [];
    this.ready = true;
    this.needed.set(false);
    for (const { drop } of waiting) drop();
  }
}
