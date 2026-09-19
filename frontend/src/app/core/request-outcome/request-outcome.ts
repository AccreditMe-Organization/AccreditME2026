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
  /**
   * A completed response with rows. `refreshing` means a REFETCH is in flight
   * with these rows still on screen — see the two loadings, below.
   */
  | {
      readonly status: 'rows';
      readonly data: readonly T[];
      readonly refreshing: boolean;
      /**
       * A REFETCH failed and these rows are what we still have. They answer
       * the PREVIOUS request, so the screen must say so: the sort header, page
       * or filter the user just changed does not describe them.
       *
       * Artboard 8: an error states whether anything changed, because on a
       * read saying so out loud stops the user re-submitting. A list read as
       * evidence that silently shows the old order under a new header is the
       * same family of defect as one that silently shortens.
       */
      readonly staleError?: { readonly errorId?: string };
    }
  /**
   * A completed response with NO rows. The reason is not optional, and
   * `filtered` says WHICH emptiness this is — artboard 8 requires two, and
   * they differ in more than wording: "No members yet" offers a creating
   * action and carries the dashed mark, while "No members match 'zahrani'"
   * offers a way out of the filter and no decoration. Telling someone to
   * clear a search they never made is worse than saying nothing.
   */
  | {
      readonly status: 'empty';
      readonly reason: string;
      readonly filtered: boolean;
      readonly refreshing: boolean;
    }
  /**
   * Refused. `httpStatus` decides what a screen renders, and the distinction
   * is load-bearing (ACC-101): a 403 may name the permission, because the
   * caller named the parent themselves; a 404 must render as not-found and
   * NEVER as a permission wall, or it announces the existence of the record it
   * exists to conceal.
   */
  | { readonly status: 'denied'; readonly httpStatus: number }
  /**
   * Failed with NOTHING to show. Always offers a retry.
   *
   * A refetch that fails is NOT this: it keeps its rows and marks them stale —
   * see `staleError` on the rows variant.
   */
  | { readonly status: 'error'; readonly errorId?: string };

/** How long a request may take before a skeleton is worth showing. */
export const SKELETON_DELAY_MS = 200;

/** How long a request may run before it is treated as failed. */
export const REQUEST_TIMEOUT_MS = 8000;

/** What to say when a completed response has no rows. */
export interface EmptyDescription {
  /**
   * In the caller's own words — "A committee needs at least 3 members before
   * it can leave Formation", or "No members match 'zahrani'". Not "No data".
   */
  readonly reason: string;
  /** True when a filter or search caused it, which changes what is offered. */
  readonly filtered: boolean;
}

export interface RequestOutcomeOptions {
  /**
   * Called when a response lands with zero rows — a FUNCTION, not a constant,
   * because the two empties artboard 8 requires cannot both be written at
   * setup time: one of them quotes the search the user just typed. The caller
   * reads its own current filter state here.
   */
  readonly describeEmpty: () => EmptyDescription;
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
 * ## TWO LOADINGS, not one (artboard 8)
 *
 * "No centred spinner for an initial load; a spinner means 'in place,
 * refreshing'." An INITIAL load has nothing to show, so it shows skeletons
 * shaped like the rows to come. A REFETCH — a sort, a page, a filter, a search
 * — already has rows on screen, and they STAY: the outcome remains `rows`,
 * with `refreshing` true, and the screen shows a spinner in place.
 *
 * Collapsing the two would make rows vanish on every sort of the most-used
 * screen in the product. It would also undercut the focus rule: moving focus
 * to the first row of a replaced set assumes there are rows, not an
 * intermediate skeleton with nothing to focus.
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

  /**
   * The last ANSWER, kept so a refetch can leave it on screen. Null until the
   * first one arrives, which is exactly what separates an initial load from a
   * refresh — nothing else needs to be told which this is.
   */
  let lastAnswer: Extract<RequestOutcome<T>, { status: 'rows' | 'empty' }> | null = null;

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
    // The stale mark is kept WITH the answer, deliberately. While a retry is
    // in flight the rows are still the previous answer, so the notice must
    // stay up; it clears only when a new answer actually lands. Stripping it
    // here passed every spec and was quietly less truthful.
    if (next.status === 'rows' || next.status === 'empty') lastAnswer = next;
    outcome.set(next);
  };

  const run = (): void => {
    subscription?.unsubscribe();
    clearTimers();

    // A refetch keeps what is on screen; only a FIRST load has nothing to
    // keep. Note both paths start un-marked: the 200ms suppression applies to
    // a refresh exactly as it does to an initial load, so a fast sort shows
    // nothing at all — no skeleton, and no spinner either.
    outcome.set(lastAnswer ? { ...lastAnswer, refreshing: false } : { status: 'idle' });

    skeletonTimer = setTimeout(
      () => outcome.set(lastAnswer ? { ...lastAnswer, refreshing: true } : { status: 'loading' }),
      skeletonDelay,
    );
    timeoutTimer = setTimeout(() => settle({ status: 'error' }), timeout);

    subscription = source().subscribe({
      next: (data) => {
        // THE RULE: a completed response with zero rows is empty. Nothing else
        // is — least of all an array nobody has fetched yet.
        if (data.length === 0) {
          const described = options.describeEmpty();
          settle({
            status: 'empty',
            reason: described.reason,
            filtered: described.filtered,
            refreshing: false,
          });
          return;
        }
        settle({ status: 'rows', data, refreshing: false });
      },
      error: (err: unknown) => {
        const httpStatus = readStatus(err);
        if (httpStatus === 403 || httpStatus === 404) {
          settle({ status: 'denied', httpStatus });
          return;
        }
        // A REFETCH that failed keeps its rows rather than blanking the list —
        // but marked, because they answer the request BEFORE this one.
        if (lastAnswer?.status === 'rows') {
          settle({
            status: 'rows',
            data: lastAnswer.data,
            refreshing: false,
            staleError: { errorId: readErrorId(err) },
          });
          return;
        }
        settle({ status: 'error', errorId: readErrorId(err) });
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

/**
 * A SKELETON is only ever right for a first load. A refetch shows a spinner
 * over the rows it already has — see the two loadings on createRequestOutcome.
 */
export function isSkeleton(outcome: RequestOutcome<unknown>): boolean {
  return outcome.status === 'loading';
}

/** Rows that answer the previous request, because a refetch failed. */
export function isStale(outcome: RequestOutcome<unknown>): boolean {
  return outcome.status === 'rows' && outcome.staleError !== undefined;
}

/** A refetch in flight with an answer still on screen. Render a spinner. */
export function isRefreshing(outcome: RequestOutcome<unknown>): boolean {
  return (outcome.status === 'rows' || outcome.status === 'empty') && outcome.refreshing;
}
