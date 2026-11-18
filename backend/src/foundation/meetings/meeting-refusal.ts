import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * ACC-316 PR 3a — the meeting writes' refusals, each with its code, so a screen
 * says them from the code (never the English message), as every other module's
 * refusals are said. Body: { statusCode, message, error, code }.
 */
export type MeetingRefusalCode =
  /** A meeting belongs to exactly one committee or one unit. */
  | 'MEETING_OWNER_REQUIRED'
  /** The committee or unit is not this organisation's, or not active. */
  | 'MEETING_OWNER_NOT_FOUND'
  /** The viewer may not schedule or edit meetings for this owner (meeting-authority.ts). */
  | 'MEETING_NOT_ALLOWED'
  /** The type is not an offered meeting_type value. */
  | 'MEETING_TYPE_UNKNOWN'
  /** A meeting starts in the future. */
  | 'MEETING_TIME_IN_PAST'
  /** A location or a link, at least one. */
  | 'MEETING_PLACE_REQUIRED'
  /** Only a unit meeting sets its own quorum; a committee meeting takes the committee's. */
  | 'MEETING_QUORUM_UNIT_ONLY'
  /** The meeting changed since it was loaded (expectedUpdatedAt). */
  | 'MEETING_CHANGED'
  /** A reschedule moves the meeting to a different time. */
  | 'MEETING_RESCHEDULE_SAME_TIME'
  | 'MEETING_TITLE_REQUIRED';

const STATUS: Record<MeetingRefusalCode, HttpStatus> = {
  MEETING_OWNER_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_OWNER_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_NOT_ALLOWED: HttpStatus.FORBIDDEN,
  MEETING_TYPE_UNKNOWN: HttpStatus.BAD_REQUEST,
  MEETING_TIME_IN_PAST: HttpStatus.BAD_REQUEST,
  MEETING_PLACE_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_QUORUM_UNIT_ONLY: HttpStatus.BAD_REQUEST,
  MEETING_CHANGED: HttpStatus.CONFLICT,
  MEETING_RESCHEDULE_SAME_TIME: HttpStatus.BAD_REQUEST,
  MEETING_TITLE_REQUIRED: HttpStatus.BAD_REQUEST,
};

const MESSAGES: Record<MeetingRefusalCode, string> = {
  MEETING_OWNER_REQUIRED: 'A meeting belongs to one committee or one unit.',
  MEETING_OWNER_NOT_FOUND: 'Committee or unit not found.',
  MEETING_NOT_ALLOWED: "You can't schedule or change meetings for this committee or unit.",
  MEETING_TYPE_UNKNOWN: 'Choose a meeting type from the list.',
  MEETING_TIME_IN_PAST: 'A meeting starts in the future.',
  MEETING_PLACE_REQUIRED: 'Give a location, a link, or both.',
  MEETING_QUORUM_UNIT_ONLY: "A committee meeting takes the committee's quorum.",
  MEETING_CHANGED: 'This meeting changed since you opened it. Reload it and try again.',
  MEETING_RESCHEDULE_SAME_TIME: 'Choose a different date or time.',
  MEETING_TITLE_REQUIRED: 'Give the meeting a title.',
};

export class MeetingRefusal extends HttpException {
  constructor(
    readonly code: MeetingRefusalCode,
    extra: Record<string, unknown> = {},
  ) {
    const status = STATUS[code];
    super({ statusCode: status, message: MESSAGES[code], error: HttpStatus[status], code, ...extra }, status);
  }
}
