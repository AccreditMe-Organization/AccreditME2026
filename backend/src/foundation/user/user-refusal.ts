import { ConflictException } from '@nestjs/common';

/**
 * ACC-222 — the refusals a profile edit can answer with. Same body shape as the
 * roles and storage refusals: the code travels in the body HttpExceptionFilter
 * sends, and the frontend words it in both languages. The English `message` is
 * for logs and API readers.
 */

/** A placed, active person's unit or position changes only through Transfer. */
export const USE_TRANSFER = 'USE_TRANSFER';

export type PlacementField = 'positionId' | 'primaryOrgUnitId';

export class UseTransferException extends ConflictException {
  constructor(readonly fields: readonly PlacementField[]) {
    super({
      statusCode: 409,
      message: "This person's unit or position can only be changed with Transfer.",
      error: 'Conflict',
      code: USE_TRANSFER,
      fields,
    });
  }
}

/** ACC-159 — only a pending invitation can be resent. */
export const INVITATION_NOT_PENDING = 'INVITATION_NOT_PENDING';

export class InvitationNotPendingException extends ConflictException {
  constructor(readonly userStatus: string) {
    super({
      statusCode: 409,
      message: `Only a pending invitation can be resent. This user is ${userStatus}.`,
      error: 'Conflict',
      code: INVITATION_NOT_PENDING,
      userStatus,
    });
  }
}
