import { BadRequestException } from '@nestjs/common';

/**
 * ACC-221 — the account owner can only be moved to someone who can run the
 * organisation: an ACTIVE member of THAT tenant holding its Organization
 * Administrator role. A user of another tenant gets the same refusal as an
 * invented id, so the response says nothing about who exists elsewhere.
 */
export const OWNER_MUST_BE_ACTIVE_ADMINISTRATOR = 'OWNER_MUST_BE_ACTIVE_ADMINISTRATOR';

export class OwnerMustBeActiveAdministratorException extends BadRequestException {
  constructor() {
    super({
      statusCode: 400,
      message: "The account owner must be an active Organization Administrator of this organization.",
      error: 'Bad Request',
      code: OWNER_MUST_BE_ACTIVE_ADMINISTRATOR,
    });
  }
}
