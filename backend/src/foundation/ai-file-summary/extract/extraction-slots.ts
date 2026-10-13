/**
 * ACC-193 (§14.1) — at most N PDF extractions at a time in this process. A
 * press waits for a free slot, but only until its own deadline; then it is
 * refused as busy. In memory, per server instance — correct at one replica,
 * like the rate-limit counters (CLAUDE.md, Rate Limiting).
 */
export class ExtractionBusyError extends Error {
  constructor() {
    super('No extraction slot became free in time');
    this.name = 'ExtractionBusyError';
  }
}

export class ExtractionSlots {
  private inUse = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(readonly size: number) {}

  /** Slots taken right now — for tests and logs. */
  get active(): number {
    return this.inUse;
  }

  /**
   * Resolves with a release function once a slot is held, or rejects with
   * ExtractionBusyError at `deadline` (epoch ms). The release is idempotent.
   */
  acquire(deadline: number): Promise<() => void> {
    if (this.inUse < this.size) {
      this.inUse += 1;
      return Promise.resolve(this.releaser());
    }
    return new Promise((resolve, reject) => {
      const wake = (): void => {
        clearTimeout(timer);
        this.inUse += 1;
        resolve(this.releaser());
      };
      const timer = setTimeout(
        () => {
          const at = this.waiting.indexOf(wake);
          if (at >= 0) this.waiting.splice(at, 1);
          reject(new ExtractionBusyError());
        },
        Math.max(0, deadline - Date.now()),
      );
      this.waiting.push(wake);
    });
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inUse -= 1;
      const next = this.waiting.shift();
      if (next) next();
    };
  }
}
