import { HttpStatus, UnauthorizedException } from '@nestjs/common';

/**
 * Stable codes for every way a sign-in is refused — ACC-120 slice 9b.
 *
 * The code travels in the body, inside the error shape HttpExceptionFilter
 * already sends: `{ statusCode, message, error, code, ...details }`. The filter
 * passes an HttpException's response through untouched, so nothing there
 * changes. Every refusal stays a 401 — what each of these returned before —
 * so a client that ignores the body keeps working.
 *
 * A client maps the CODE to its own words. The message is English for a person
 * reading a log, and is fixed per code.
 *
 * What each code may and may not reveal is the table in SYSTEM-REFERENCE.md
 * (§1.12, "Sign-in outcomes").
 */
export type AuthRefusalCode =
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'ACCOUNT_INACTIVE'
  | 'MFA_INVALID'
  | 'MFA_EXPIRED';

/**
 * ONE message per code, and the only place a refusal's wording is written.
 *
 * `INVALID_CREDENTIALS` covers an unknown organisation, no such user and a
 * wrong password alike, and its wording names none of them. Because the code,
 * the message and the absence of details are all fixed, those three cases send
 * byte-identical bodies by construction: there is no call site that could word
 * one of them differently.
 */
export const AUTH_REFUSAL_MESSAGES: Readonly<Record<AuthRefusalCode, string>> =
  {
    INVALID_CREDENTIALS: 'Invalid organization or credentials',
    ACCOUNT_LOCKED:
      'Account temporarily locked due to repeated failed attempts',
    ACCOUNT_INACTIVE: 'This account is not active',
    MFA_INVALID: 'Invalid verification code',
    MFA_EXPIRED: 'The verification step has expired. Sign in again.',
  };

export interface AuthRefusalBody {
  statusCode: 401;
  message: string;
  error: 'Unauthorized';
  code: AuthRefusalCode;
  /** ACCOUNT_LOCKED only: when the lock lifts, as an ISO-8601 instant. */
  lockedUntil?: string;
  /** MFA_INVALID only: codes left before this challenge is spent. */
  attemptsRemaining?: number;
}

export class AuthRefusalException extends UnauthorizedException {
  readonly code: AuthRefusalCode;

  constructor(code: 'INVALID_CREDENTIALS' | 'ACCOUNT_INACTIVE' | 'MFA_EXPIRED');
  constructor(code: 'ACCOUNT_LOCKED', details: { lockedUntil: Date });
  constructor(code: 'MFA_INVALID', details: { attemptsRemaining: number });
  constructor(
    code: AuthRefusalCode,
    details?: { lockedUntil?: Date; attemptsRemaining?: number },
  ) {
    const body: AuthRefusalBody = {
      statusCode: HttpStatus.UNAUTHORIZED,
      message: AUTH_REFUSAL_MESSAGES[code],
      error: 'Unauthorized',
      code,
    };
    if (details?.lockedUntil)
      body.lockedUntil = details.lockedUntil.toISOString();
    if (details?.attemptsRemaining !== undefined) {
      body.attemptsRemaining = details.attemptsRemaining;
    }
    super(body);
    this.code = code;
  }
}
