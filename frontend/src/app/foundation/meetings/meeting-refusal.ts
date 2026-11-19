import { refusalCode } from '../../core/http/refusal';

/**
 * ACC-316 PR 6 — a meeting write's refusal, said from its CODE in the reader's
 * language (meeting-refusal.ts on the server lists them), never the server's
 * English message. A code with no entry here falls back to the screen's own
 * generic error key; the server's own words are never shown.
 */
export const MEETING_REFUSAL_KEYS: Readonly<Record<string, string>> = {
  MEETING_OWNER_REQUIRED: 'meeting.refusal.ownerRequired',
  MEETING_OWNER_NOT_FOUND: 'meeting.refusal.ownerNotFound',
  MEETING_NOT_ALLOWED: 'meeting.refusal.notAllowed',
  MEETING_TYPE_UNKNOWN: 'meeting.refusal.typeUnknown',
  MEETING_TIME_IN_PAST: 'meeting.refusal.timeInPast',
  MEETING_PLACE_REQUIRED: 'meeting.refusal.placeRequired',
  MEETING_QUORUM_UNIT_ONLY: 'meeting.refusal.quorumUnitOnly',
  MEETING_CHANGED: 'meeting.refusal.changed',
  MEETING_RESCHEDULE_SAME_TIME: 'meeting.refusal.sameTime',
  MEETING_TITLE_REQUIRED: 'meeting.refusal.titleRequired',
  MEETING_GUEST_REQUIRED: 'meeting.refusal.guestRequired',
  MEETING_PERSON_NOT_FOUND: 'meeting.refusal.personNotFound',
  MEETING_ALREADY_INVITED: 'meeting.refusal.alreadyInvited',
  MEETING_ATTENDEE_NOT_FOUND: 'meeting.refusal.attendeeNotFound',
  MEETING_MEMBER_NOT_REMOVABLE: 'meeting.refusal.memberNotRemovable',
  MEETING_GUEST_PRESENTS: 'meeting.refusal.guestPresents',
  MEETING_NOT_INVITED: 'meeting.refusal.notInvited',
  MEETING_STARTED: 'meeting.refusal.started',
  STAGE_ACTION_NOT_ALLOWED: 'meeting.refusal.stageActionNotAllowed',
  // ACC-316 PR 7 — the agenda editor's.
  MEETING_AGENDA_TITLE_REQUIRED: 'meeting.refusal.agendaTitleRequired',
  MEETING_AGENDA_ITEM_NOT_FOUND: 'meeting.refusal.agendaItemNotFound',
  MEETING_AGENDA_ORDER_MISMATCH: 'meeting.refusal.agendaOrderMismatch',
  MEETING_PRESENTER_NOT_FOUND: 'meeting.refusal.presenterNotFound',
};

/** The translation key for a meeting refusal, or null when the error carries no code this file knows. */
export function meetingRefusalKey(err: unknown): string | null {
  const code = refusalCode(err);
  return code ? (MEETING_REFUSAL_KEYS[code] ?? null) : null;
}
