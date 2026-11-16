// ACC-126 — the session's 12-hour limit, on screen: a warning 10 minutes
// before, then the sign-out.
//
// Someone who reaches the limit is, by construction, active (the idle rule
// would otherwise have signed them out first), so they are likely in the middle
// of a form. Ten minutes rather than the idle warning's two: they cannot extend
// the session, so they need time to finish and save, not one click. There is
// no "Stay signed in" — nothing can.
//
// THE SERVER IS THE AUTHORITY. This timer only tells the person in time; the
// access token cannot outlive the limit and /auth/refresh refuses past it. A
// tab asleep through the deadline is signed out by that refusal instead
// (authInterceptor → /login?reason=limit).
//
// The sign-out itself is IdleService's: it calls POST /auth/logout, clears
// locally, tells the other tabs (with the reason), and goes to the sign-in page
// with reason=limit.

import { DestroyRef, Injectable, NgZone, computed, inject, signal } from '@angular/core';
import { IdleService } from './idle.service';
import { SessionLimitState } from './session-limit-state';

/** How long before the limit the warning appears. Fixed (Ahmad, ACC-126). */
export const SESSION_LIMIT_WARNING_LEAD_MS = 10 * 60 * 1000;

/** How often the deadline is checked. */
const TICK_MS = 1000;

@Injectable({ providedIn: 'root' })
export class SessionLimitService {
  private readonly state = inject(SessionLimitState);
  private readonly idle = inject(IdleService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  private readonly now = signal(Date.now());
  /** The deadline whose warning was dismissed; it is not shown again for it. */
  private readonly dismissedFor = signal<number | null>(null);
  private timer: ReturnType<typeof setInterval> | null = null;
  private signingOutFor: number | null = null;

  /** When the session ends, in epoch ms; null when unknown. */
  readonly endsAt = this.state.endsAt;

  /** True from 10 minutes before the limit until it, unless dismissed. */
  readonly warningVisible = computed(() => {
    const end = this.endsAt();
    if (end === null || this.dismissedFor() === end) return false;
    const left = end - this.now();
    return left > 0 && left <= SESSION_LIMIT_WARNING_LEAD_MS;
  });

  /**
   * Begins watching. Idempotent, like IdleService.start().
   *
   * The once-a-second tick runs OUTSIDE Angular's zone: a timer that never
   * ends would otherwise keep the zone from ever being stable (a spec's
   * whenStable() never resolves). The signals it writes still schedule change
   * detection, and the sign-out goes back into the zone to navigate.
   */
  start(): void {
    if (this.timer) return;
    this.now.set(Date.now());
    this.zone.runOutsideAngular(() => {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    });
    this.destroyRef.onDestroy(() => this.stop());
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** "Continue working", or Escape: the warning goes; the deadline does not move. */
  dismiss(): void {
    this.dismissedFor.set(this.endsAt());
  }

  /** "Sign out now" — a sign-out the person chose. */
  signOutNow(): void {
    void this.idle.signOut('user');
  }

  private tick(): void {
    const now = Date.now();
    this.now.set(now);
    const end = this.endsAt();
    if (end === null || now < end || this.signingOutFor === end) return;
    this.signingOutFor = end;
    this.zone.run(() => void this.idle.signOut('limit'));
  }
}
