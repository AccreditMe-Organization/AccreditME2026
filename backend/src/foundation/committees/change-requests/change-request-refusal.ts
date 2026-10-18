import { HttpException, HttpStatus } from '@nestjs/common';

// ACC-239 — the refusals of a committee change request, in the reference
// refusals' shape ({ statusCode, message, error, code }) plus details, so a
// screen says each from its code. The English message is written for a log.

export const CHANGE_REQUEST_REFUSALS = {
  CHANGE_REQUEST_STAGE_NOT_ALLOWED: {
    status: HttpStatus.CONFLICT,
    message:
      'A change request can be raised only for an Active or Suspended committee. In Formation, edit the committee directly.',
  },
  CHANGE_REQUEST_ALREADY_OPEN: {
    status: HttpStatus.CONFLICT,
    message: 'This committee already has an open change request. Finish or withdraw it first.',
  },
  CHANGE_REQUEST_NO_CHANGES: {
    status: HttpStatus.BAD_REQUEST,
    message: 'Change at least one field.',
  },
  CHANGE_REQUEST_QUORUM_MIN: {
    status: HttpStatus.BAD_REQUEST,
    message: 'An approved committee needs a quorum of at least 1.',
  },
  CHANGE_REQUEST_NOT_REQUESTER: {
    status: HttpStatus.FORBIDDEN,
    message: 'Only the person who raised this change request can do this.',
  },
  CHANGE_REQUEST_NOT_ALLOWED: {
    status: HttpStatus.FORBIDDEN,
    message: 'You cannot do this to this change request.',
  },
  CHANGE_REQUEST_OWN_DECISION: {
    status: HttpStatus.CONFLICT,
    message: 'You raised this change request, so someone else must decide it.',
  },
  CHANGE_REQUEST_NOT_EDITABLE: {
    status: HttpStatus.CONFLICT,
    message: 'Only a draft or returned change request can be changed or submitted.',
  },
  CHANGE_REQUEST_NOT_UNDER_REVIEW: {
    status: HttpStatus.CONFLICT,
    message: 'Only a change request under review can be approved, returned or rejected.',
  },
  CHANGE_REQUEST_NOT_OPEN: {
    status: HttpStatus.CONFLICT,
    message: 'This change request is already closed.',
  },
  CHANGE_REQUEST_COMMITTEE_DISSOLVING: {
    status: HttpStatus.CONFLICT,
    message: 'This committee is being dissolved, or has been, so its change request can only be rejected or withdrawn.',
  },
  CHANGE_REQUEST_COMMITTEE_CHANGED: {
    status: HttpStatus.CONFLICT,
    message:
      'The committee has changed since this request was submitted, so it cannot be applied. Return it to the requester. Nothing was changed.',
  },
  CHANGE_REQUEST_CHANGED: {
    status: HttpStatus.CONFLICT,
    message: 'This change request was changed by someone else since it was opened. Nothing was saved.',
  },
} as const;

export type ChangeRequestRefusalCode = keyof typeof CHANGE_REQUEST_REFUSALS;

export class ChangeRequestRefusal extends HttpException {
  constructor(
    readonly code: ChangeRequestRefusalCode,
    details: Record<string, unknown> = {},
  ) {
    const { status, message } = CHANGE_REQUEST_REFUSALS[code];
    // `error` is the status as the global filter writes it ("Conflict", "Bad Request").
    const error = HttpStatus[status]
      .toLowerCase()
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    super({ statusCode: status, message, error, code, ...details }, status);
  }
}
