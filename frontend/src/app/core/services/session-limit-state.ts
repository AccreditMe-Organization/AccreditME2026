import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { refusalCode } from '../http/refusal';

/**
 * ACC-126 — every session ends 12 hours after sign-in, however active the
 * person is. The server enforces it (the access token cannot outlive the
 * limit, and /auth/refresh refuses past it with `SESSION_TIME_LIMIT`); this is
 * what the app knows about it.
 *
 * Plain state with NO dependencies, on purpose: AuthService writes the
 * deadline, the renewal service notes the refusal, and SessionLimitService
 * (which depends on IdleService, which depends on AuthService) reads it. Put
 * in either service, it would close an injection cycle.
 */
export const SESSION_TIME_LIMIT = 'SESSION_TIME_LIMIT';

/** True for the API's "this session has reached its 12-hour limit" refusal. */
export function isSessionTimeLimitRefusal(err: unknown): boolean {
  return (
    err instanceof HttpErrorResponse && err.status === 401 && refusalCode(err) === SESSION_TIME_LIMIT
  );
}

@Injectable({ providedIn: 'root' })
export class SessionLimitState {
  private readonly _endsAt = signal<number | null>(null);
  private readonly _signedOutForLimit = signal(false);

  /** When the signed-in session must end, in epoch ms; null when unknown. */
  readonly endsAt = this._endsAt.asReadonly();

  /**
   * True once the server has refused this browser's session for its time
   * limit. The sign-in page reads it, because the path that met the refusal
   * may not navigate there itself (restoreSession() never redirects, ACC-24).
   */
  readonly signedOutForLimit = this._signedOutForLimit.asReadonly();

  /** From sign-in or /auth/me. A missing or unreadable value means "unknown". */
  setEndsAt(iso: string | null | undefined): void {
    const at = iso ? Date.parse(iso) : NaN;
    this._endsAt.set(Number.isFinite(at) ? at : null);
  }

  /** Records the refusal when `err` is one. Returns whether it was. */
  note(err: unknown): boolean {
    if (!isSessionTimeLimitRefusal(err)) return false;
    this._signedOutForLimit.set(true);
    this._endsAt.set(null);
    return true;
  }

  /** Signed out: there is no session to count down. The note stays for the sign-in page. */
  endSession(): void {
    this._endsAt.set(null);
  }

  /** Signed in again: a fresh session, nothing to explain. */
  clearNote(): void {
    this._signedOutForLimit.set(false);
  }
}
