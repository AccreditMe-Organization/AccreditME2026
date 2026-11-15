import { BadRequestException, HttpStatus } from '@nestjs/common';

/**
 * Refusals on the SIGNED-IN two-step routes — ACC-164.
 *
 * The same codes and details as `AuthRefusalException` (sign-in), so a client
 * words them the same way, but **400, never 401**. These routes sit behind
 * TenantGuard, and the app's interceptor answers any 401 there by renewing the
 * session and retrying the request (ACC-122). A wrong password would then be
 * submitted twice: two failures counted towards the lock, and a code spent
 * twice.
 *
 * `MFA_NOT_ENABLED`: turning off two-step sign-in that is not on. A 400 like
 * the rest, because it is an answer about this form, not a conflict with
 * another write.
 */
export type MfaChangeRefusalCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'MFA_INVALID'
  | 'MFA_NOT_ENABLED';

export const MFA_CHANGE_REFUSAL_MESSAGES: Readonly<Record<MfaChangeRefusalCode, string>> = {
  INVALID_CREDENTIALS: 'Invalid password',
  ACCOUNT_LOCKED: 'Account temporarily locked due to repeated failed attempts',
  MFA_INVALID: 'Invalid verification code',
  MFA_NOT_ENABLED: 'Two-step sign-in is not on',
};

export interface MfaChangeRefusalBody {
  statusCode: 400;
  message: string;
  error: 'Bad Request';
  code: MfaChangeRefusalCode;
  /** ACCOUNT_LOCKED only, when the lift time is known: an ISO-8601 instant. */
  lockedUntil?: string;
  /** MFA_INVALID only: wrong codes left before two-step sign-in locks. */
  attemptsRemaining?: number;
}

export class MfaChangeRefusalException extends BadRequestException {
  readonly code: MfaChangeRefusalCode;

  constructor(code: 'INVALID_CREDENTIALS' | 'MFA_NOT_ENABLED');
  constructor(code: 'ACCOUNT_LOCKED', details: { lockedUntil: Date | null });
  constructor(code: 'MFA_INVALID', details: { attemptsRemaining: number });
  constructor(
    code: MfaChangeRefusalCode,
    details?: { lockedUntil?: Date | null; attemptsRemaining?: number },
  ) {
    const body: MfaChangeRefusalBody = {
      statusCode: HttpStatus.BAD_REQUEST,
      message: MFA_CHANGE_REFUSAL_MESSAGES[code],
      error: 'Bad Request',
      code,
    };
    if (details?.lockedUntil) body.lockedUntil = details.lockedUntil.toISOString();
    if (details?.attemptsRemaining !== undefined) {
      body.attemptsRemaining = details.attemptsRemaining;
    }
    super(body);
    this.code = code;
  }
}
