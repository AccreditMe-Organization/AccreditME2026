import { Signal, signal } from '@angular/core';
import { Observable, Subscription } from 'rxjs';

/**
 * The six request outcomes, as ONE state machine (ACC-111, artboard 8).
 *
 * Every panel and list in the product answers a request, and before this each
 * one improvised: three panels on the Committee record disagreed about what a
 * 403 looks like. ACC-104 consumes this rather than writing a fourth.
 *
 * ## Why a discriminated union rather than flags
 *
 * The rule artboard 8 states is mechanical: **`undefined` is loading and
 * renders a skeleton; `[]` is empty and renders a reason.** A component may
 * not treat the two alike — that is how "No users yet" appeared on a tenant
 * with 312 users, while the request was still in flight. A `loading` boolean
 * beside a `rows` array lets a template read one without the other; a
 * discriminated status cannot be half-read.
 */
export type RequestOutcome<T> =
  /** Nothing has been asked for yet, or the answer arrived inside 200ms. */
  | { readonly status: 'idle' }
  /** In flight long enough to be worth saying so. Render a skeleton. */
  | { readonly status: 'loading' }
  /** A completed response with rows. */
  | { readonly status: 'rows'; readonly data: readonly T[] }
  /** A completed response with NO rows. The reason is not optional. */
  | { readonly status: 'empty'; readonly reason: string }
  /**
   * Refused. `httpStatus` decides what a screen renders, and the distinction
   * is load-bearing (ACC-101): a 403 may name the permission, because the
   * caller named the parent themselves; a 404 must render as not-found and
   * NEVER as a permission wall, or it announces the existence of the record it
   * exists to conceal.
   */
  | { readonly status: 'denied'; readonly httpStatus: number }
  /** Failed for a reason that might not recur. Always offers a retry. */
  | { readonly status: 'error'; readonly errorId?: string };

/** How long a request may take before a skeleton is worth showing. */
export const SKELETON_DELAY_MS = 200;

/** How long a request may run before it is treated as failed. */
export const REQUEST_TIMEOUT_MS = 8000;

export interface RequestOutcomeOptions {
  /**
   * Why the set is empty, in the caller's own words — "A committee needs at
   * least 3 members before it can leave Formation", not "No data". Artboard 8
   * requires a reason, so it is required here.
   */
  readonly emptyReason: string;
  /** Overridable for tests; the defaults are the design's. */
  readonly skeletonDelayMs?: number;
  readonly timeoutMs?: number;
}

export interface RequestOutcomeHandle<T> {
  readonly outcome: Signal<RequestOutcome<T>>;
  /** Re-runs the source. What the error state's Retry calls. */
  readonly retry: () => void;
  readonly destroy: () => void;
}

/**
 * Runs `source` and reports it as one of the six outcomes.
 *
 * Two timings, both from artboard 8, and both about not lying to the reader:
 *
 * - **Suppressed under 200ms.** A fast response never flashes a skeleton. The
 *   state stays `idle`, which renders nothing, rather than showing and hiding
 *   a shape in the same breath.
 * - **8 seconds becomes an error with a retry.** A spinner that has run for
 *   eight seconds is not informing anyone; it is a page that looks broken
 *   while claiming to work. The request is not cancelled — the subscription is
 *   dropped, so a late answer cannot overwrite the error the reader is looking
 *   at.
 */
export function createRequestOutcome<T>(
  source: () => Observable<readonly T[]>,
  options: RequestOutcomeOptions,
): RequestOutcomeHandle<T> {
  const skeletonDelay = options.skeletonDelayMs ?? SKELETON_DELAY_MS;
  const timeout = options.timeoutMs ?? REQUEST_TIMEOUT_MS;

  const outcome = signal<RequestOutcome<T>>({ status: 'idle' });

  let subscription: Subscription | null = null;
  let skeletonTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = (): void => {
    if (skeletonTimer !== null) clearTimeout(skeletonTimer);
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    skeletonTimer = null;
    timeoutTimer = null;
  };

  const settle = (next: RequestOutcome<T>): void => {
    clearTimers();
    subscription?.unsubscribe();
    subscription = null;
    outcome.set(next);
  };

  const run = (): void => {
    subscription?.unsubscribe();
    clearTimers();
    outcome.set({ status: 'idle' });

    skeletonTimer = setTimeout(() => outcome.set({ status: 'loading' }), skeletonDelay);
    timeoutTimer = setTimeout(() => settle({ status: 'error' }), timeout);

    subscription = source().subscribe({
      next: (data) => {
        // THE RULE: a completed response with zero rows is empty. Nothing else
        // is — least of all an array nobody has fetched yet.
        settle(
          data.length === 0
            ? { status: 'empty', reason: options.emptyReason }
            : { status: 'rows', data },
        );
      },
      error: (err: unknown) => {
        const httpStatus = readStatus(err);
        settle(
          httpStatus === 403 || httpStatus === 404
            ? { status: 'denied', httpStatus }
            : { status: 'error', errorId: readErrorId(err) },
        );
      },
    });
  };

  run();

  return {
    outcome: outcome.asReadonly(),
    retry: run,
    destroy: () => {
      clearTimers();
      subscription?.unsubscribe();
      subscription = null;
    },
  };
}

function readStatus(err: unknown): number | null {
  const status = (err as { status?: unknown })?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * The id support can act on. "It broke" is not a report, so an error carries
 * whatever the backend gave us to quote.
 */
function readErrorId(err: unknown): string | undefined {
  const body = (err as { error?: { errorId?: unknown; requestId?: unknown } })?.error;
  const id = body?.errorId ?? body?.requestId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * A RECORD PAGE'S outcome, from its panels' (artboard 8's sixth state).
 *
 * Partial is not a seventh answer a single request can give — it is what
 * SEVERAL requests together look like when some succeeded and some did not.
 * Keeping it out of `RequestOutcome` is deliberate: a panel that could report
 * itself "partial" would invite a component to guess about its neighbours.
 *
 * A failed panel never blanks the record (ACC-104), so this exists to describe
 * the page, not to decide what any panel renders.
 */
export type PageOutcome = 'loading' | 'complete' | 'partial' | 'failed';

export function composePageOutcome(outcomes: readonly RequestOutcome<unknown>[]): PageOutcome {
  if (outcomes.length === 0) return 'complete';
  const isLoading = (o: RequestOutcome<unknown>): boolean =>
    o.status === 'loading' || o.status === 'idle';
  const isBroken = (o: RequestOutcome<unknown>): boolean =>
    o.status === 'error' || o.status === 'denied';

  if (outcomes.every(isLoading)) return 'loading';
  if (outcomes.every(isBroken)) return 'failed';
  if (outcomes.some(isBroken)) return 'partial';
  return outcomes.some(isLoading) ? 'loading' : 'complete';
}

/** Convenience for templates that only need "is there a skeleton right now". */
export function isSkeleton(outcome: RequestOutcome<unknown>): boolean {
  return outcome.status === 'loading';
}
