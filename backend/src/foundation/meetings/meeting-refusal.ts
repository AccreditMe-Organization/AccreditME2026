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
  | 'MEETING_TITLE_REQUIRED'
  | 'MEETING_GUEST_REQUIRED'
  | 'MEETING_PERSON_NOT_FOUND'
  | 'MEETING_ALREADY_INVITED'
  | 'MEETING_ATTENDEE_NOT_FOUND'
  | 'MEETING_MEMBER_NOT_REMOVABLE'
  | 'MEETING_GUEST_PRESENTS'
  | 'MEETING_NOT_INVITED'
  | 'MEETING_STARTED'
  | 'MEETING_AGENDA_ITEM_NOT_FOUND'
  | 'MEETING_AGENDA_ORDER_MISMATCH'
  | 'MEETING_PRESENTER_NOT_FOUND'
  | 'MEETING_CLASH_OWNER_REQUIRED'
  | 'MEETING_CLASH_TOO_MANY_TIMES'
  | 'MEETING_AGENDA_TITLE_REQUIRED'
  | 'MEETING_CLASH_PERSON_NOT_INVITEE';

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
  MEETING_GUEST_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_PERSON_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_ALREADY_INVITED: HttpStatus.CONFLICT,
  MEETING_ATTENDEE_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_MEMBER_NOT_REMOVABLE: HttpStatus.CONFLICT,
  MEETING_GUEST_PRESENTS: HttpStatus.CONFLICT,
  MEETING_NOT_INVITED: HttpStatus.FORBIDDEN,
  MEETING_STARTED: HttpStatus.CONFLICT,
  MEETING_AGENDA_ITEM_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_AGENDA_ORDER_MISMATCH: HttpStatus.BAD_REQUEST,
  MEETING_PRESENTER_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_CLASH_OWNER_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_CLASH_TOO_MANY_TIMES: HttpStatus.BAD_REQUEST,
  MEETING_AGENDA_TITLE_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_CLASH_PERSON_NOT_INVITEE: HttpStatus.BAD_REQUEST,
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
  MEETING_GUEST_REQUIRED: "Choose a person, or give an outside guest's name and email.",
  MEETING_PERSON_NOT_FOUND: 'Person not found.',
  MEETING_ALREADY_INVITED: 'This person is already invited.',
  MEETING_ATTENDEE_NOT_FOUND: 'Invitee not found.',
  MEETING_MEMBER_NOT_REMOVABLE: "A member is invited by their committee or unit and can't be removed here.",
  MEETING_GUEST_PRESENTS: 'This guest presents an agenda item. Choose another presenter first.',
  MEETING_NOT_INVITED: "You aren't invited to this meeting.",
  MEETING_STARTED: 'This meeting has started.',
  MEETING_AGENDA_ITEM_NOT_FOUND: 'Agenda item not found.',
  MEETING_AGENDA_ORDER_MISMATCH: 'The order must list every agenda item once. Reload the agenda and try again.',
  MEETING_PRESENTER_NOT_FOUND: 'Presenter not found.',
  MEETING_CLASH_OWNER_REQUIRED: 'Name the committee, the unit or the meeting to check.',
  MEETING_CLASH_TOO_MANY_TIMES: 'Check at most 52 times at once.',
  MEETING_AGENDA_TITLE_REQUIRED: 'Give the agenda item a title.',
  MEETING_CLASH_PERSON_NOT_INVITEE: "Check only the meeting's invitees, or the committee's or unit's members.",
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
