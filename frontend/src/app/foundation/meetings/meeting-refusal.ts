import { HttpErrorResponse } from '@angular/common/http';
import { refusalBody, refusalCode } from '../../core/http/refusal';

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
  MEETING_AGENDA_CHANGED: 'meeting.refusal.agendaChanged',
  // PR 7b — the minutes.
  MEETING_MINUTES_NOT_OPEN: 'meeting.refusal.minutesNotOpen',
  MEETING_NOT_RECORDER: 'meeting.refusal.notRecorder',
  MEETING_NOT_STARTED: 'meeting.refusal.notStarted',
  MEETING_VOTES_PARTIAL: 'meeting.refusal.votesPartial',
  MEETING_VOTES_EXCEED_PRESENT: 'meeting.refusal.votesExceedPresent',
  MEETING_DECISION_NOT_FOUND: 'meeting.refusal.decisionNotFound',
  MEETING_DECISION_TEXT_REQUIRED: 'meeting.refusal.decisionTextRequired',
  MEETING_ACTION_NOT_FOUND: 'meeting.refusal.actionNotFound',
  MEETING_ACTION_TITLE_REQUIRED: 'meeting.refusal.actionTitleRequired',
  MEETING_ACTION_DUE_IN_PAST: 'meeting.refusal.actionDueInPast',
  MEETING_OPEN_ACTION_NOT_FOUND: 'meeting.refusal.openActionNotFound',
  MEETING_ATTENDANCE_INCOMPLETE: 'meeting.refusal.attendanceIncomplete',
  MEETING_REVIEW_DATE_INVALID: 'meeting.refusal.reviewDateInvalid',
  // PR 7c-1 — the review.
  MEETING_NOT_REVIEWER: 'meeting.refusal.notReviewer',
  MEETING_REVIEW_SUGGESTED: 'meeting.refusal.reviewSuggested',
  MEETING_SUGGESTION_NOT_FOUND: 'meeting.refusal.suggestionNotFound',
  MEETING_SUGGESTION_DECIDED: 'meeting.refusal.suggestionDecided',
  MEETING_SUGGESTION_TEXT_REQUIRED: 'meeting.refusal.suggestionTextRequired',
  MEETING_SUGGESTION_REPLY_REQUIRED: 'meeting.refusal.suggestionReplyRequired',
  MEETING_PRESENTER_NOT_FOUND: 'meeting.refusal.presenterNotFound',
  // PR 8a — a series (Schedule, step 2).
  MEETING_SERIES_PATTERN_INVALID: 'meeting.refusal.seriesPatternInvalid',
  MEETING_SERIES_END_REQUIRED: 'meeting.refusal.seriesEndRequired',
  MEETING_SERIES_TOO_LONG: 'meeting.refusal.seriesTooLong',
  MEETING_SERIES_EMPTY: 'meeting.refusal.seriesEmpty',
  MEETING_SERIES_TIME_INVALID: 'meeting.refusal.seriesTimeInvalid',
  // PR 8c — the scope confirm (a meeting no longer in its series).
  MEETING_NOT_IN_SERIES: 'meeting.refusal.notInSeries',
  // PR 8d — End series.
  MEETING_SERIES_NOT_FOUND: 'meeting.refusal.seriesNotFound',
  MEETING_SERIES_CANNOT_CANCEL: 'meeting.refusal.seriesCannotCancel',
  // ACC-322 PR 2 — Draft minutes (PR 4 and PR 6 add their own codes with their screens).
  MEETING_AI_NOT_OFFERED: 'meeting.refusal.aiNotOffered',
  MEETING_AI_IN_PROGRESS: 'meeting.refusal.aiInProgress',
  MEETING_AI_NO_NOTES: 'meeting.refusal.aiNoNotes',
  MEETING_AI_NOTHING_TO_DRAFT: 'meeting.refusal.aiNothingToDraft',
  MEETING_AI_NOTHING_SUGGESTED: 'meeting.refusal.aiNothingSuggested',
  MEETING_AI_TOO_LONG: 'meeting.refusal.aiTooLong.minutes',
  MEETING_AI_SUGGESTION_GONE: 'meeting.refusal.aiSuggestionGone',
};

/** MEETING_AI_TOO_LONG names its feature ({ feature }): one sentence each (plan step-322 §1.0). */
const AI_TOO_LONG_KEYS: Readonly<Record<string, string>> = {
  minutes: 'meeting.refusal.aiTooLong.minutes',
};

/** The translation key for a meeting refusal, or null when the error carries no code this file knows. */
export function meetingRefusalKey(err: unknown): string | null {
  const code = refusalCode(err);
  if (code === 'MEETING_AI_TOO_LONG') {
    const feature = refusalBody(err)?.['feature'];
    return (typeof feature === 'string' ? AI_TOO_LONG_KEYS[feature] : undefined) ?? MEETING_REFUSAL_KEYS[code]!;
  }
  return code ? (MEETING_REFUSAL_KEYS[code] ?? null) : null;
}

/**
 * P198 — the refusals that mean what is on screen is no longer the server's:
 * the screen offers Reload (the page reads the meeting again), never Retry,
 * which would send the same stale request. P220 added the meeting's own
 * staleness and the review's: a suggestion gone, or already decided.
 */
const RELOAD_CODES: ReadonlySet<string> = new Set([
  'MEETING_AGENDA_ITEM_NOT_FOUND',
  'MEETING_AGENDA_ORDER_MISMATCH',
  'MEETING_AGENDA_CHANGED',
  'MEETING_CHANGED',
  'MEETING_SUGGESTION_NOT_FOUND',
  'MEETING_SUGGESTION_DECIDED',
  // P227 — "No corrections" pressed on a banner that predates the person's own suggestion.
  'MEETING_REVIEW_SUGGESTED',
  // ACC-322 — an AI suggestion already decided, or replaced by Draft again.
  'MEETING_AI_SUGGESTION_GONE',
  // ACC-322 — Draft minutes is absent where it isn't offered, so this refusal means the page is stale.
  'MEETING_AI_NOT_OFFERED',
]);

export function meetingNeedsReload(err: unknown): boolean {
  const code = refusalCode(err);
  return !!code && RELOAD_CODES.has(code);
}

/** The server could not be reached, or timed out: the one case that offers Retry (Design System rule 5.5). */
const UNREACHABLE: ReadonlySet<number> = new Set([0, 408, 502, 503, 504]);

export function meetingUnreachable(err: unknown): boolean {
  return err instanceof HttpErrorResponse && UNREACHABLE.has(err.status);
}

/** What a failed write says, and the one control it offers. */
export interface MeetingFailure {
  key: string;
  offer: 'retry' | 'reload' | null;
}

/**
 * P220 — a failed write said from its code: a stale refusal offers Reload; an
 * unreachable server or a timeout offers Retry with `unreachableKey`; any other
 * refusal its own sentence, and no code at all `fallbackKey`, with nothing to
 * press (sending it again would be refused again).
 */
export function meetingFailure(err: unknown, unreachableKey: string, fallbackKey: string): MeetingFailure {
  if (meetingNeedsReload(err)) return { key: meetingRefusalKey(err) ?? fallbackKey, offer: 'reload' };
  if (meetingUnreachable(err)) return { key: unreachableKey, offer: 'retry' };
  return { key: meetingRefusalKey(err) ?? fallbackKey, offer: null };
}
