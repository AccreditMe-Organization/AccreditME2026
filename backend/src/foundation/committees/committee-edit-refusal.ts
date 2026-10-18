import { ConflictException } from '@nestjs/common';

// ACC-238 — the refusals of a committee's own edit, in the reference refusals'
// shape ({ statusCode, message, error, code }), so the dialog says them from
// the code. ACC-241 adds COMMITTEE_EDIT_LOCKED here.

export const COMMITTEE_EDIT_REFUSALS = {
  COMMITTEE_CHANGED: 'This committee was changed by someone else since it was opened. Nothing was saved.',
} as const;

export type CommitteeEditRefusalCode = keyof typeof COMMITTEE_EDIT_REFUSALS;

/**
 * The stale save: the committee's `updatedAt` is not the one the dialog loaded.
 * The role matrix's shape (ACC-120, ROLE_PERMISSIONS_CHANGED): nothing is
 * written, and the dialog offers Reload rather than Retry.
 */
export class CommitteeChangedException extends ConflictException {
  readonly code = 'COMMITTEE_CHANGED' as const;

  constructor() {
    super({
      statusCode: 409,
      message: COMMITTEE_EDIT_REFUSALS.COMMITTEE_CHANGED,
      error: 'Conflict',
      code: 'COMMITTEE_CHANGED',
    });
  }
}
