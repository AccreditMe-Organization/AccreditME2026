import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, signal } from '@angular/core';
import { refusalCode } from '../http/refusal';

/**
 * ACC-204 — "this browser's session belongs to another organisation's address".
 *
 * One browser holds one session for every address (the cookies live on the one
 * API host), so signed in at al-nakheel, the same browser opening platform's
 * address carries al-nakheel's session there. The API refuses it with
 * `SESSION_OTHER_ORGANIZATION` (TenantGuard and /auth/refresh), and this app
 * reads that as NOT SIGNED IN AT THIS ADDRESS:
 *
 *   - restoreSession() does not renew on it and lands on the page as signed
 *     out, without redirecting (ACC-24);
 *   - the interceptor does not renew on it either;
 *   - the renewal service records it when /auth/refresh is refused with it.
 *
 * The sign-in page reads `signedInElsewhere` to say so in one line, and a
 * successful sign-in here clears it — that sign-in replaces the other
 * address's session in this browser, which is what the line warns.
 */
export const SESSION_OTHER_ORGANIZATION = 'SESSION_OTHER_ORGANIZATION';

/** True for the API's "session belongs to another organisation's address" refusal. */
export function isOtherOrganizationRefusal(err: unknown): boolean {
  return (
    err instanceof HttpErrorResponse && err.status === 401 && refusalCode(err) === SESSION_OTHER_ORGANIZATION
  );
}

@Injectable({ providedIn: 'root' })
export class SessionAddressState {
  private readonly _signedInElsewhere = signal(false);

  /** True once this address has met a session that belongs to another one. */
  readonly signedInElsewhere = this._signedInElsewhere.asReadonly();

  /** Records the refusal when `err` is one. Returns whether it was. */
  note(err: unknown): boolean {
    if (!isOtherOrganizationRefusal(err)) return false;
    this._signedInElsewhere.set(true);
    return true;
  }

  /** A session at THIS address now exists: nothing elsewhere to warn about. */
  clear(): void {
    this._signedInElsewhere.set(false);
  }
}
