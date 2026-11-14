import { BadRequestException } from '@nestjs/common';

/**
 * Why a reset link can't be used — ACC-188. A 400, never a 401: the app's
 * interceptor answers a 401 by renewing the session and retrying the request.
 *
 * Each code is its own screen. INVALID covers every case that must not say
 * more: no such link, a malformed token or body, a link voided after Better
 * Auth consumed it, an inactive account, a closed organisation, and a link
 * opened at another organisation's address. Its body is byte-identical for all.
 * The other three are told only to the holder of a 256-bit token, so they
 * disclose nothing that could be used.
 */
export type ResetLinkRefusalCode =
  | 'RESET_LINK_INVALID'
  | 'RESET_LINK_EXPIRED'
  | 'RESET_LINK_USED'
  | 'RESET_LINK_REPLACED';

const MESSAGES: Readonly<Record<ResetLinkRefusalCode, string>> = Object.freeze({
  RESET_LINK_INVALID: 'This reset link cannot be used',
  RESET_LINK_EXPIRED: 'This reset link has expired',
  RESET_LINK_USED: 'This reset link has already been used',
  RESET_LINK_REPLACED: 'A newer reset link was sent',
});

export class ResetLinkRefusalException extends BadRequestException {
  constructor(readonly code: ResetLinkRefusalCode) {
    super({
      statusCode: 400,
      message: MESSAGES[code],
      error: 'Bad Request',
      code,
    });
  }
}
