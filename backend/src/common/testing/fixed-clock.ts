/**
 * ACC-248 — hold the clock at one instant for a test, so an assertion about
 * "now" means the same thing however slow the run is, and whatever day it is.
 *
 * Only `Date` is faked. Promises, timers and anything that awaits a real delay
 * behave as normal, so async code under test runs exactly as it does without
 * this — it simply reads the fixed instant whenever it asks for the time.
 *
 * Call `useFixedClock(at)` in the test (or a `beforeEach`), and
 * `jest.useRealTimers()` after it (an `afterEach`, or a `finally`).
 */
type DoNotFake = NonNullable<Extract<NonNullable<Parameters<typeof jest.useFakeTimers>[0]>, { doNotFake?: unknown }>['doNotFake']>;

const EVERYTHING_BUT_DATE: DoNotFake = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
];

export function useFixedClock(at: Date): void {
  jest.useFakeTimers({ now: at, doNotFake: EVERYTHING_BUT_DATE });
}
