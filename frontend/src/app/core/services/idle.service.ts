// ACC-122 — the idle rule: thirty minutes of no USER activity ends the
// session, with a warning two minutes before.
//
// ## Activity means input, never traffic
//
// The clock is driven by DOM input events and nothing else. That is the whole
// design, and it is why the notification bell cannot hold a session open: the
// bell polls on a timer, and polling never touches this service. There is no
// exclusion list to keep correct, because HTTP was never an input in the first
// place. Anyone adding "extend on API call" here would be reintroducing the
// bug the ticket describes — a session that outlives an empty chair.
//
// ## One clock, shared by every tab
//
// A user with the roster open in one tab and a form in another is ONE user. If
// each tab kept its own clock, the idle tab would sign them out mid-sentence.
// So last-activity lives in localStorage, which every tab of the origin reads,
// and a BroadcastChannel message tells the other tabs to re-read it at once
// rather than waiting for their next tick.
//
// Both are best-effort. localStorage throws in a private window or with site
// data blocked (the rule ACC-96 already set), and BroadcastChannel may be
// absent. Either failure degrades to per-tab behaviour — a stricter session,
// never a longer one — and never throws into the app.
//
// ## Signing out means signing out
//
// On timeout the service calls POST /auth/logout, not just clearSession(). The
// refresh token is a database row with a 7-day life; dropping the client's
// memory of it would leave the session alive on the server while telling the
// user they had been signed out for inactivity.

import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Idle before sign-out. Fixed at 30 minutes (Ahmad, ACC-122). */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** How long the warning is on screen before the sign-out. */
export const IDLE_WARNING_LEAD_MS = 2 * 60 * 1000;

/**
 * Activity is recorded at most this often.
 *
 * pointermove fires continuously; writing to localStorage and posting a
 * BroadcastChannel message on every pixel would be a performance bug of our
 * own making. 15s is far below any threshold that matters against 30 minutes.
 */
const ACTIVITY_THROTTLE_MS = 15 * 1000;

/** How often idleness is evaluated. 1s so the countdown reads honestly. */
const TICK_MS = 1000;

const STORAGE_KEY = 'am.session.lastActivity';
const CHANNEL_NAME = 'am-session';

type ChannelMessage = { type: 'activity'; at: number } | { type: 'signed-out' };

@Injectable({ providedIn: 'root' })
export class IdleService {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  /** Epoch ms of the last input seen in ANY tab. */
  private readonly lastActivity = signal(Date.now());

  /** Ticks so the computed values below recompute; never read directly. */
  private readonly now = signal(Date.now());

  private timer: ReturnType<typeof setInterval> | null = null;
  private channel: BroadcastChannel | null = null;
  private listenersAttached = false;
  private lastRecordedAt = 0;
  private signingOut = false;

  /** True while the warning should be on screen. */
  readonly warningVisible = computed(() => {
    const idleFor = this.now() - this.lastActivity();
    return idleFor >= IDLE_TIMEOUT_MS - IDLE_WARNING_LEAD_MS && idleFor < IDLE_TIMEOUT_MS;
  });

  /** Whole seconds left before sign-out; 0 once past. */
  readonly secondsRemaining = computed(() => {
    const left = IDLE_TIMEOUT_MS - (this.now() - this.lastActivity());
    return left > 0 ? Math.ceil(left / 1000) : 0;
  });

  /**
   * Begins watching. Idempotent — safe to call from a component that may be
   * constructed more than once per session.
   */
  start(): void {
    if (this.timer) return;

    this.signingOut = false;
    this.lastActivity.set(this.readStoredActivity() ?? Date.now());
    this.recordActivity(true);
    this.attachListeners();
    this.openChannel();

    this.timer = setInterval(() => {
      this.now.set(Date.now());
      const idleFor = Date.now() - this.lastActivity();
      if (idleFor >= IDLE_TIMEOUT_MS) void this.signOut('idle');
    }, TICK_MS);

    this.destroyRef.onDestroy(() => this.stop());
  }

  /** Stops watching and releases everything. Safe to call when not started. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.detachListeners();
    this.closeChannel();
  }

  /**
   * "Stay signed in". Records activity exactly as a keypress would, so every
   * other tab agrees and the warning clears everywhere at once.
   */
  extend(): void {
    this.recordActivity(true);
    this.now.set(Date.now());
  }

  /** The user chose to sign out from the warning, or the countdown ran out. */
  async signOut(reason: 'idle' | 'user'): Promise<void> {
    if (this.signingOut) return;
    this.signingOut = true;
    this.stop();
    this.post({ type: 'signed-out' });

    const returnUrl = this.router.url;
    try {
      // Revoke server-side. A failure here must not strand the user in a
      // session they have been told is over, so the local clear runs anyway.
      await new Promise<void>((resolve) => {
        this.authService.logout().subscribe({ next: () => resolve(), error: () => resolve() });
      });
    } finally {
      this.authService.clearSession();
      void this.router.navigate(['/login'], {
        queryParams: { returnUrl, reason: reason === 'idle' ? 'idle' : undefined },
      });
    }
  }

  // ── activity ──────────────────────────────────────────────────────────────

  private readonly onActivity = (): void => this.recordActivity(false);

  private recordActivity(force: boolean): void {
    const at = Date.now();
    if (!force && at - this.lastRecordedAt < ACTIVITY_THROTTLE_MS) return;
    this.lastRecordedAt = at;
    this.lastActivity.set(at);
    this.writeStoredActivity(at);
    this.post({ type: 'activity', at });
  }

  private attachListeners(): void {
    if (this.listenersAttached || typeof document === 'undefined') return;
    for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart'] as const) {
      document.addEventListener(event, this.onActivity, { passive: true });
    }
    this.listenersAttached = true;
  }

  private detachListeners(): void {
    if (!this.listenersAttached || typeof document === 'undefined') return;
    for (const event of ['keydown', 'pointerdown', 'pointermove', 'touchstart'] as const) {
      document.removeEventListener(event, this.onActivity);
    }
    this.listenersAttached = false;
  }

  // ── cross-tab ─────────────────────────────────────────────────────────────

  private openChannel(): void {
    if (this.channel || typeof BroadcastChannel === 'undefined') return;
    try {
      this.channel = new BroadcastChannel(CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
        const message = event.data;
        if (message?.type === 'activity') {
          // Never move the clock BACKWARDS: a late message from a tab whose
          // own record is older would otherwise shorten everyone's session.
          if (message.at > this.lastActivity()) this.lastActivity.set(message.at);
        } else if (message?.type === 'signed-out') {
          this.stop();
          this.signingOut = true;
          this.authService.clearSession();
          void this.router.navigate(['/login']);
        }
      };
    } catch {
      this.channel = null;
    }
  }

  private closeChannel(): void {
    try {
      this.channel?.close();
    } catch {
      /* already closed */
    }
    this.channel = null;
  }

  private post(message: ChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      /* a closed or unavailable channel is not an error here */
    }
  }

  // ── storage (best effort, per ACC-96's rule) ──────────────────────────────

  private readStoredActivity(): number | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private writeStoredActivity(at: number): void {
    try {
      localStorage.setItem(STORAGE_KEY, String(at));
    } catch {
      /* private window, or site data blocked — degrade to this tab only */
    }
  }
}
