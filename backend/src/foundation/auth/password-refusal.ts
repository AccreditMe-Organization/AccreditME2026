import { HttpException, HttpStatus } from '@nestjs/common';
import {
  BETTER_AUTH_API_ERROR_NAME,
  BETTER_AUTH_PASSWORD_CHECK_FAILED,
  BETTER_AUTH_PASSWORD_CODES,
} from './better-auth.contract';

/**
 * Stable codes for a password accept-invitation cannot use — ACC-120 slice 9e.
 *
 * Better Auth refuses these with its own codes, and the global
 * HttpExceptionFilter drops `code` from every Better Auth error, so the screen
 * received only English text and could not put the message on the field. They
 * are mapped HERE, in accept only, rather than by forwarding codes in the
 * filter: forwarding would make Better Auth's codes part of every endpoint's
 * contract. Same shape as InvitationRefusalException: one fixed body per code.
 */
export type PasswordRefusalCode =
  | 'PASSWORD_COMPROMISED'
  | 'PASSWORD_TOO_SHORT'
  | 'PASSWORD_TOO_LONG'
  | 'PASSWORD_CHECK_UNAVAILABLE';

const PASSWORD_REFUSALS: Readonly<
  Record<PasswordRefusalCode, { status: HttpStatus; message: string }>
> = Object.freeze({
  PASSWORD_COMPROMISED: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This password has appeared in a data breach',
  },
  PASSWORD_TOO_SHORT: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This password is too short',
  },
  PASSWORD_TOO_LONG: {
    status: HttpStatus.BAD_REQUEST,
    message: 'This password is too long',
  },
  // Not the person's fault and not a verdict on the password: the check
  // itself could not run, so the honest status is "try again".
  PASSWORD_CHECK_UNAVAILABLE: {
    status: HttpStatus.SERVICE_UNAVAILABLE,
    message: 'The password could not be checked',
  },
});

const ERROR_NAMES: Partial<Record<HttpStatus, string>> = {
  [HttpStatus.BAD_REQUEST]: 'Bad Request',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'Service Unavailable',
};

export class PasswordRefusalException extends HttpException {
  constructor(readonly code: PasswordRefusalCode) {
    const { status, message } = PASSWORD_REFUSALS[code];
    super(
      { statusCode: status, message, error: ERROR_NAMES[status], code },
      status,
    );
  }
}

/**
 * Which password refusal a thrown signUpEmail() error is, or null for anything
 * else — which then propagates exactly as before.
 *
 * Identifies Better Auth's error by its `name`, as Better Auth's own
 * isAPIError() does, because importing `better-auth/api` here breaks Jest (it
 * is ESM-only — see CLAUDE.md, ACC-22 through ACC-27).
 */
export function passwordRefusalCode(
  error: unknown,
): PasswordRefusalCode | null {
  if (!(error instanceof Error) || error.name !== BETTER_AUTH_API_ERROR_NAME) {
    return null;
  }
  const { statusCode, body } = error as Error & {
    statusCode?: unknown;
    body?: { code?: unknown; message?: unknown };
  };
  switch (body?.code) {
    case BETTER_AUTH_PASSWORD_CODES.COMPROMISED:
      return 'PASSWORD_COMPROMISED';
    case BETTER_AUTH_PASSWORD_CODES.TOO_SHORT:
      return 'PASSWORD_TOO_SHORT';
    case BETTER_AUTH_PASSWORD_CODES.TOO_LONG:
      return 'PASSWORD_TOO_LONG';
  }
  if (
    statusCode === HttpStatus.INTERNAL_SERVER_ERROR &&
    body?.code === undefined &&
    typeof body?.message === 'string' &&
    body.message.startsWith(BETTER_AUTH_PASSWORD_CHECK_FAILED)
  ) {
    return 'PASSWORD_CHECK_UNAVAILABLE';
  }
  return null;
}
