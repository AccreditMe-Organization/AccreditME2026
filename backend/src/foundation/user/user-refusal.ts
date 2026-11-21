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

/**
 * ACC-159 — the seat limit and the three position rules invite() and resend
 * share, each with a code so the screens say them in the reader's language.
 * The English messages are unchanged.
 */
export const SEAT_LIMIT_REACHED = 'SEAT_LIMIT_REACHED';
export const POSITION_INACTIVE = 'POSITION_INACTIVE';
export const POSITION_ALREADY_HELD = 'POSITION_ALREADY_HELD';
export const UNIT_ALREADY_HAS_HEAD = 'UNIT_ALREADY_HAS_HEAD';

function coded(code: string, message: string): { statusCode: 409; message: string; error: 'Conflict'; code: string } {
  return { statusCode: 409, message, error: 'Conflict', code };
}

export class SeatLimitReachedException extends ConflictException {
  constructor() {
    super(coded(SEAT_LIMIT_REACHED, 'This plan has reached its full-user seat limit'));
  }
}

export class PositionInactiveException extends ConflictException {
  constructor() {
    super(coded(POSITION_INACTIVE, 'This position is inactive and cannot be assigned'));
  }
}

export class PositionAlreadyHeldException extends ConflictException {
  constructor() {
    super(coded(POSITION_ALREADY_HELD, 'This position already has an active holder in this org unit'));
  }
}

export class UnitAlreadyHasHeadException extends ConflictException {
  constructor() {
    super(coded(UNIT_ALREADY_HAS_HEAD, 'This org unit already has an active Head-position holder'));
  }
}
