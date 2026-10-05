import { BadRequestException } from '@nestjs/common';

/**
 * The one refusal for an invitation that cannot be used — ACC-120 slice 9c.
 *
 * An unknown token, an expired one, one already used, one revoked, one whose
 * invitee has been deactivated, one from a tenant that is not open, and a body
 * that is not a well-formed request: every one of them gets THIS body, byte for
 * byte. A caller holding a token learns whether it works and nothing about why
 * not — the same principle as sign-in's INVALID_CREDENTIALS (SYSTEM-REFERENCE
 * §1.12).
 *
 * Status and message are what accept-invitation has always returned for a bad
 * token, so the current screen sees the same thing plus the code. The body is
 * frozen and copied per throw, so no call site can word it differently.
 */
export const INVITATION_REFUSAL_BODY = Object.freeze({
  statusCode: 400,
  message: 'Invalid or expired invitation',
  error: 'Bad Request',
  code: 'INVITATION_INVALID',
} as const);

export class InvitationRefusalException extends BadRequestException {
  constructor() {
    super({ ...INVITATION_REFUSAL_BODY });
  }
}
