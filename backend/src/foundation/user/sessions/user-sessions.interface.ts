import { ConflictException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { SESSION_MAX_LENGTH_SECONDS } from '../../auth/session-limit';
import type { SessionDevice } from './session-device';

/** ACC-216 — the most sign-ins one read returns; `total` counts past it. */
export const USER_SESSIONS_CAP = 20;

/**
 * ACC-216 — one current sign-in, on GET /users/:userId/sessions.
 *
 * A sign-in is a CHAIN of RefreshToken rows (every renewal revokes one row and
 * writes the next, copying `sessionStartedAt`); the row listed is the chain's
 * one live row. Never returned: the token hash, the token version, or the raw
 * User-Agent (`deviceInfo`), which is read here only to name the device.
 */
export interface IUserSession {
  /** The live row's id. Ending it ends its whole chain (the sign-in). */
  id: string;
  /** When this sign-in began: `sessionStartedAt`, else the row's own createdAt. */
  startedAt: Date;
  /** The live row's createdAt: its last renewal, so accurate to about 15 minutes. */
  lastActiveAt: Date;
  /** The live row's expiry: at most 12 hours from the start (ACC-126). */
  expiresAt: Date;
  device: SessionDevice;
  /** `req.ip` at the last renewal. Only for the person themself and a users:manage_sessions holder (Q3). */
  address: string | null;
  /** The caller's own current sign-in (yourself only), matched by the access token's `sst`. */
  current: boolean;
}

export interface IUserSessions {
  /** Every current sign-in, counted past the cap. */
  total: number;
  /** At most USER_SESSIONS_CAP, most recently active first. */
  rows: IUserSession[];
}

/**
 * The live predicate (plan step-216 §1.4) as one `where`, scoped by the person
 * AND the organisation. A row is a current sign-in when it is not revoked, not
 * expired, under 12 hours from its start (a row with no start counts from its
 * createdAt, as `sessionStartOf()` does), and issued at the person's current
 * `tokenVersion` (null = issued before the column existed). The caller also
 * requires the person to be ACTIVE: deactivation before ACC-216 PR 3 left rows
 * unrevoked, which `refresh()` refuses and this must not list.
 */
export function liveSessionWhere(
  userId: string,
  organizationId: string,
  tokenVersion: number,
  now: Date,
): Prisma.RefreshTokenWhereInput {
  const startedAfter = new Date(now.getTime() - SESSION_MAX_LENGTH_SECONDS * 1000);
  return {
    userId,
    organizationId,
    revokedAt: null,
    expiresAt: { gt: now },
    AND: [
      { OR: [{ sessionStartedAt: { gt: startedAfter } }, { sessionStartedAt: null, createdAt: { gt: startedAfter } }] },
      { OR: [{ tokenVersion: null }, { tokenVersion }] },
    ],
  };
}

// --- Refusals, each with its code (the screen says them in both languages) ---

export type SessionsRefusalCode =
  | 'SESSIONS_END_SELF'
  | 'SESSIONS_IMPERSONATING'
  | 'SESSIONS_END_HIGHER_ACCOUNT'
  | 'SESSION_IS_CURRENT'
  | 'CURRENT_SESSION_UNKNOWN';

export const SESSIONS_REFUSAL_MESSAGES: Readonly<Record<SessionsRefusalCode, string>> = {
  SESSIONS_END_SELF: 'To sign yourself out of other devices, use your own signed-in devices.',
  SESSIONS_IMPERSONATING: "This can't be done while signed in as someone else.",
  SESSIONS_END_HIGHER_ACCOUNT: 'Only an Organization Administrator can sign an Organization Administrator out everywhere.',
  SESSION_IS_CURRENT: "This is the device you're using. Use Sign out to end it.",
  CURRENT_SESSION_UNKNOWN: "This device's sign-in couldn't be identified. Sign out and sign in again, then try again.",
};

export class SessionsRefusalException extends ConflictException {
  constructor(readonly code: SessionsRefusalCode) {
    super({ statusCode: 409, message: SESSIONS_REFUSAL_MESSAGES[code], error: 'Conflict', code });
  }
}
