import { TranslateService } from '@ngx-translate/core';
import { refusalBody, refusalCode } from '../../core/http/refusal';
import { roleInactiveMessage } from '../roles/role-inactive-refusal';

/**
 * ACC-159 — the refusals Invite and Resend invitation can answer with, said
 * from their CODE in the reader's language. Never the server's English
 * `message`, which is written for a log.
 *
 * The seat limit and the three position rules are shared by invite() and by a
 * resend of an EXPIRED invitation, which takes a seat and its position again
 * (user-refusal.ts on the server). A head position's deactivated role is the
 * existing ROLE_INACTIVE sentence.
 */
const KEYS: Record<string, string> = {
  SEAT_LIMIT_REACHED: 'user.invitationRefusal.seatLimit',
  POSITION_INACTIVE: 'user.invitationRefusal.positionInactive',
  POSITION_ALREADY_HELD: 'user.invitationRefusal.positionAlreadyHeld',
  UNIT_ALREADY_HAS_HEAD: 'user.invitationRefusal.unitAlreadyHasHead',
};

/** The status words the server may name in INVITATION_NOT_PENDING. */
const STATUS_KEYS: Record<string, string> = {
  ACTIVE: 'user.status.active',
  INACTIVE: 'user.status.inactive',
  SUSPENDED: 'user.status.suspended',
};

/**
 * The sentence for one of these refusals, or null for any other error, so the
 * caller keeps its own fallback. `name` is the person the invitation is for.
 */
export function invitationRefusalMessage(err: unknown, translate: TranslateService, name: string): string | null {
  const code = refusalCode(err);
  if (code === 'INVITATION_NOT_PENDING') {
    const status = refusalBody(err)?.['userStatus'];
    const statusKey = typeof status === 'string' ? STATUS_KEYS[status] : undefined;
    return statusKey
      ? translate.instant('user.invitationRefusal.notPendingStatus', { name, status: translate.instant(statusKey) })
      : translate.instant('user.invitationRefusal.notPending', { name });
  }
  const key = code ? KEYS[code] : undefined;
  if (key) return translate.instant(key);
  return roleInactiveMessage(err, translate);
}
