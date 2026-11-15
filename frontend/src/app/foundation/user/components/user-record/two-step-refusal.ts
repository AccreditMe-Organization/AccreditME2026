import { HttpErrorResponse } from '@angular/common/http';
import { refusalBody, refusalCode } from '../../../../core/http/refusal';
import { roundUpToMinute } from '../../../auth/components/login/sign-in-refusal';

/**
 * What the two two-step dialogs say for each refusal — ACC-164.
 *
 * One branch per code the server sends, mapped from the CODE, never the
 * English message. Pure functions of the error and the clock, so each branch is
 * pinned by its own spec. The design (AccreditMe Two-step Sign-in.dc.html) and
 * the plan's §0b decide where each one goes.
 */

export const TWO_STEP_KEYS = {
  passwordWrong: 'userRecord.twoStep.passwordWrong',
  codeWrong: 'auth.signIn.errors.mfaInvalid',
  locked: 'userRecord.twoStep.locked',
  lockedNoTime: 'userRecord.twoStep.lockedNoTime',
  alreadyOff: 'userRecord.twoStep.alreadyOff',
  unreachable: 'userRecord.twoStep.unreachable',
  offFailed: 'userRecord.twoStep.offFailed',
  resetOwner: 'userRecord.twoStep.resetOwner',
  resetAlreadyOff: 'userRecord.twoStep.resetAlreadyOff',
  resetActingAs: 'userRecord.twoStep.resetActingAs',
  resetHigher: 'userRecord.twoStep.resetHigher',
  resetSelf: 'userRecord.twoStep.resetSelf',
  resetFailed: 'userRecord.twoStep.resetFailed',
} as const;

/** The message's look: red for a failure, blue for news (already off). */
export type TwoStepTone = 'danger' | 'info';

/** Turn off: where the refusal is said, and what it does to the form. */
export interface TurnOffRefusal {
  /** Under a field, or (null) as a message above the buttons. */
  readonly field: 'password' | 'code' | null;
  readonly key: string;
  readonly tone: TwoStepTone;
  /** A wrong code with 1 or 2 left: how many. 3 or more is noise; null otherwise. */
  readonly attemptsLeft: number | null;
  /** When the lock lifts, rounded up to the minute; null when not known. */
  readonly until: Date | null;
  /** Nothing left to do here: the buttons become Close. */
  readonly closeOnly: boolean;
}

const unreachable = (err: unknown): boolean =>
  err instanceof HttpErrorResponse && (err.status === 0 || err.status >= 500);

function instant(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

export function describeTurnOffRefusal(err: unknown, now: Date = new Date()): TurnOffRefusal {
  const K = TWO_STEP_KEYS;
  const base = { field: null, tone: 'danger', attemptsLeft: null, until: null, closeOnly: false } as const;
  const body = refusalBody(err);
  switch (refusalCode(err)) {
    case 'INVALID_CREDENTIALS':
      return { ...base, field: 'password', key: K.passwordWrong };
    case 'MFA_INVALID': {
      const left = body?.['attemptsRemaining'];
      return { ...base, field: 'code', key: K.codeWrong, attemptsLeft: left === 1 || left === 2 ? left : null };
    }
    case 'ACCOUNT_LOCKED': {
      const until = instant(body?.['lockedUntil']);
      return until
        ? { ...base, key: K.locked, until: roundUpToMinute(until, now) }
        : { ...base, key: K.lockedNoTime };
    }
    case 'MFA_NOT_ENABLED':
      return { ...base, key: K.alreadyOff, tone: 'info', closeOnly: true };
  }
  return { ...base, key: unreachable(err) ? K.unreachable : K.offFailed };
}

/** Reset: the message in the confirm, and whether only Close is left. */
export interface ResetRefusal {
  readonly key: string;
  readonly tone: TwoStepTone;
  readonly closeOnly: boolean;
  /** The account owner: the message takes the paragraph's place. */
  readonly replacesBody: boolean;
}

export function describeResetRefusal(err: unknown): ResetRefusal {
  const K = TWO_STEP_KEYS;
  const say = (key: string, extra: Partial<ResetRefusal> = {}): ResetRefusal => ({
    key,
    tone: 'danger',
    closeOnly: false,
    replacesBody: false,
    ...extra,
  });
  switch (refusalCode(err)) {
    case 'ACCOUNT_OWNER_PROTECTED':
      return say(K.resetOwner, { closeOnly: true, replacesBody: true });
    case 'MFA_NOT_ENABLED':
      return say(K.resetAlreadyOff, { tone: 'info', closeOnly: true });
    case 'MFA_RESET_IMPERSONATING':
      return say(K.resetActingAs, { closeOnly: true });
    // Not drawn: the panel hides Reset for both. Said, in case a stale page asks.
    case 'MFA_RESET_HIGHER_ACCOUNT':
      return say(K.resetHigher, { closeOnly: true });
    case 'MFA_RESET_SELF':
      return say(K.resetSelf, { closeOnly: true });
  }
  return say(unreachable(err) ? K.unreachable : K.resetFailed);
}
