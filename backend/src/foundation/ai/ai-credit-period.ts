import { DateTime } from 'luxon';

/**
 * ACC-194 — the credit period rule, and the ONLY place it lives (Ahmad,
 * 12 Oct, D2 and D14).
 *
 * A period is anchored to the organisation's ACTIVATION, in UTC. Activation is
 * `bootstrappedAt`, falling back to `createdAt` (D14: no billing exists yet;
 * when it does, the period follows the billing date). Let A be the activation
 * instant and d its UTC day of the month:
 *
 *   - d = 1–28: MONTHLY. Renewals fall at 00:00 UTC on day d of every month
 *     after A's month. Every month has a day 1–28, so the day never drifts.
 *   - d = 29, 30, 31: every 30 DAYS, whatever the month's length. Renewals fall
 *     at 00:00 UTC on A's date + 30·k days.
 *
 * The MODE is always decided from A, never from a period's start: a 30-day
 * period that starts on 2 March would otherwise read as "monthly on the 2nd".
 *
 * The first period begins at A itself and ends at the first renewal after it.
 */

export interface CreditPeriod {
  start: Date;
  renewsAt: Date;
}

export const THIRTY_DAY_MODE_FROM_DAY = 29;

/** Activation, per D14. */
export function activationOf(org: { bootstrappedAt: Date | null; createdAt: Date }): Date {
  return org.bootstrappedAt ?? org.createdAt;
}

/** The k-th renewal after activation (k ≥ 1), at 00:00 UTC. */
export function renewalAt(activation: Date, k: number): Date {
  const a = DateTime.fromJSDate(activation, { zone: 'utc' });
  const midnight = DateTime.utc(a.year, a.month, a.day);
  if (a.day >= THIRTY_DAY_MODE_FROM_DAY) return midnight.plus({ days: 30 * k }).toJSDate();
  return midnight.plus({ months: k }).toJSDate();
}

/** The period containing `now`: from the latest renewal at or before it (or activation) to the next. */
export function creditPeriodAt(activation: Date, now: Date): CreditPeriod {
  const a = DateTime.fromJSDate(activation, { zone: 'utc' });
  const n = DateTime.fromJSDate(now, { zone: 'utc' });

  // An estimate of how many renewals have passed, corrected by stepping.
  let k: number;
  if (a.day >= THIRTY_DAY_MODE_FROM_DAY) {
    const midnight = DateTime.utc(a.year, a.month, a.day);
    k = Math.floor(n.diff(midnight, 'days').days / 30);
  } else {
    k = (n.year - a.year) * 12 + (n.month - a.month);
  }
  k = Math.max(k, 0);
  while (k > 0 && renewalAt(activation, k).getTime() > now.getTime()) k--;
  while (renewalAt(activation, k + 1).getTime() <= now.getTime()) k++;

  return {
    start: k === 0 ? activation : renewalAt(activation, k),
    renewsAt: renewalAt(activation, k + 1),
  };
}
