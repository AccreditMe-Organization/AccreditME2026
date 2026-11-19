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
  | 'MEETING_CLASH_PERSON_NOT_INVITEE'
  // ACC-316 PR 4 — attendance, minutes and review.
  | 'MEETING_NOT_RECORDER'
  | 'MEETING_NOT_STARTED'
  | 'MEETING_VOTES_PARTIAL'
  | 'MEETING_VOTES_EXCEED_PRESENT'
  | 'MEETING_DECISION_NOT_FOUND'
  | 'MEETING_DECISION_TEXT_REQUIRED'
  | 'MEETING_ACTION_NOT_FOUND'
  | 'MEETING_ACTION_TITLE_REQUIRED'
  | 'MEETING_ACTION_DUE_IN_PAST'
  | 'MEETING_OPEN_ACTION_NOT_FOUND'
  | 'MEETING_ATTENDANCE_INCOMPLETE'
  | 'MEETING_REVIEW_DATE_INVALID'
  | 'MEETING_NOT_REVIEWER'
  | 'MEETING_REVIEW_SUGGESTED'
  | 'MEETING_SUGGESTION_NOT_FOUND'
  | 'MEETING_SUGGESTION_DECIDED'
  | 'MEETING_SUGGESTION_TEXT_REQUIRED'
  | 'MEETING_MINUTES_NOT_OPEN';

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
  MEETING_NOT_RECORDER: HttpStatus.FORBIDDEN,
  MEETING_NOT_STARTED: HttpStatus.CONFLICT,
  MEETING_VOTES_PARTIAL: HttpStatus.BAD_REQUEST,
  MEETING_VOTES_EXCEED_PRESENT: HttpStatus.BAD_REQUEST,
  MEETING_DECISION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_DECISION_TEXT_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_ACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_ACTION_TITLE_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_ACTION_DUE_IN_PAST: HttpStatus.BAD_REQUEST,
  MEETING_OPEN_ACTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_ATTENDANCE_INCOMPLETE: HttpStatus.CONFLICT,
  MEETING_REVIEW_DATE_INVALID: HttpStatus.BAD_REQUEST,
  MEETING_NOT_REVIEWER: HttpStatus.FORBIDDEN,
  MEETING_REVIEW_SUGGESTED: HttpStatus.CONFLICT,
  MEETING_SUGGESTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MEETING_SUGGESTION_DECIDED: HttpStatus.CONFLICT,
  MEETING_SUGGESTION_TEXT_REQUIRED: HttpStatus.BAD_REQUEST,
  MEETING_MINUTES_NOT_OPEN: HttpStatus.FORBIDDEN,
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
  MEETING_NOT_RECORDER: "You don't record this meeting's minutes.",
  MEETING_NOT_STARTED: "Attendance is recorded from the meeting's start time.",
  MEETING_VOTES_PARTIAL: 'Give all three vote counts, or none.',
  MEETING_VOTES_EXCEED_PRESENT: 'The votes add up to more than the members present.',
  MEETING_DECISION_NOT_FOUND: 'Decision not found.',
  MEETING_DECISION_TEXT_REQUIRED: 'Write the decision.',
  MEETING_ACTION_NOT_FOUND: 'Action item not found.',
  MEETING_ACTION_TITLE_REQUIRED: 'Say what the action is.',
  MEETING_ACTION_DUE_IN_PAST: 'An action item is due in the future.',
  MEETING_OPEN_ACTION_NOT_FOUND: "This isn't an open action from the last meeting.",
  MEETING_ATTENDANCE_INCOMPLETE: 'Record attendance for every member and organisation guest first.',
  MEETING_REVIEW_DATE_INVALID: 'Choose a review date after today.',
  MEETING_NOT_REVIEWER: 'Only members recorded present review the minutes.',
  MEETING_REVIEW_SUGGESTED: 'You suggested a correction in this review.',
  MEETING_SUGGESTION_NOT_FOUND: 'Suggestion not found.',
  MEETING_SUGGESTION_DECIDED: 'This suggestion was already applied or declined.',
  MEETING_SUGGESTION_TEXT_REQUIRED: 'Write the correction.',
  MEETING_MINUTES_NOT_OPEN: "This meeting's minutes aren't open to you yet.",
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
