import { HttpErrorResponse } from '@angular/common/http';

/**
 * ACC-216 Sessions — a refusal from the sessions routes, said from its CODE in
 * the reader's language, never from the server's English `message` (ACC-208's
 * rule). The codes are the backend's `SessionsRefusalCode`, plus ACC-221's
 * ACCOUNT_OWNER_PROTECTED, which "Sign out everywhere" shares with the two-step
 * reset (the account-action rule).
 */
export const SESSIONS_REFUSAL_CODES = [
  'SESSION_IS_CURRENT',
  'CURRENT_SESSION_UNKNOWN',
  'SESSIONS_END_SELF',
  'SESSIONS_IMPERSONATING',
  'SESSIONS_END_HIGHER_ACCOUNT',
  'ACCOUNT_OWNER_PROTECTED',
] as const;

export type SessionsRefusalCode = (typeof SESSIONS_REFUSAL_CODES)[number];

/** The translation key for a failed sessions request: its code's, else the generic one. */
export function sessionsRefusalKey(err: unknown): string {
  const code = err instanceof HttpErrorResponse ? (err.error as { code?: unknown } | null)?.code : undefined;
  return typeof code === 'string' && (SESSIONS_REFUSAL_CODES as readonly string[]).includes(code)
    ? `userRecord.sessions.refusal.${code}`
    : 'userRecord.sessions.refusal.generic';
}
