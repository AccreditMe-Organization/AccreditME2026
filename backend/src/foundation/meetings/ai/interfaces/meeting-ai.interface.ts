import type { IMeetingMinutes } from '../../interfaces/meeting.interface';

/** ACC-322 — what each Meetings AI feature offers this viewer (PR 1 builds Draft minutes). */
export interface IMeetingAiFeature {
  /** Whether this viewer may press it here: the person, the stage, the phase. */
  may: boolean;
  /** Whether the organisation may use the feature now (the gateway's switch and allowance; never the balance). */
  available: boolean;
  /** The credits a press costs, when the feature is open to the organisation. */
  creditCost: number | null;
  /** A run of it on this meeting is in progress (someone pressed, the answer isn't saved yet). */
  running: boolean;
}

export interface IMeetingAiVotes {
  for: number;
  against: number;
  abstain: number;
}

/** An undecided minutes suggestion for one agenda item. */
export interface IMeetingAiMinutesSuggestion {
  id: string;
  agendaItemId: string;
  language: 'en' | 'ar';
  /** The notes say nothing about this item: "Nothing in your notes for this item." Discard only. */
  nothing: boolean;
  discussion: string | null;
  decisions: {
    text: string;
    /** Null: "Vote: not in your notes · left empty". */
    votes: IMeetingAiVotes | null;
    /** M6 — the counts add up to more than the members recorded present (the minutes' own flag, before Accept). */
    abovePresent: boolean;
  }[];
  /** What Accept replaces of what is typed (M5), so the line can say so. */
  replaces: { discussion: boolean; decisions: boolean };
}

/** Why an action suggestion has no owner: our code writes the sentence, from this. */
export type IMeetingAiOwnerReason = { code: 'OUTSIDE_GUEST'; name: string } | { code: 'NO_MATCH'; name: string } | null;

/** An undecided action-item suggestion. Accept only once both the owner and the due date are set. */
export interface IMeetingAiActionSuggestion {
  id: string;
  agendaItemId: string;
  language: 'en' | 'ar';
  title: string;
  owner: { userId: string; name: string } | null;
  ownerReason: IMeetingAiOwnerReason;
  dueAt: string | null;
  /** The day in the notes has passed: "The date in your notes, 15 Sep, has passed. Choose a due date." */
  dueReason: { code: 'DATE_PASSED'; day: string } | null;
}

/**
 * ACC-322 — GET /meetings/:id/ai, one read for the page. A viewer who neither
 * writes the agenda nor records the minutes gets every flag false and no
 * content (P206: no error). The suggestions, the notes and the undecided count
 * are for whoever records the minutes, while they are a draft.
 */
export interface IMeetingAi {
  minutes: IMeetingAiFeature;
  /** The viewer's own rough notes (M3); null when none, or not theirs to see. */
  notes: string | null;
  /** The members recorded present, against which each vote's flag is read. */
  presentMembers: number;
  suggestions: {
    minutes: IMeetingAiMinutesSuggestion[];
    actions: IMeetingAiActionSuggestion[];
  };
  /** Undecided minutes and action suggestions: the header's count, and Distribute's (M2). */
  undecided: number;
  /**
   * PR 2 — the agenda items a Draft minutes press would still draft (M8,
   * `draftPartsOf()`), all of them, before the six-a-call limit. At 0 the
   * screen shows no trigger (the press would be MEETING_AI_NOTHING_TO_DRAFT).
   */
  leftToDraft: number;
}

/** Accept answers both reads: the minutes as written, and what is left to decide. */
export interface IMeetingAiAccepted {
  minutes: IMeetingMinutes;
  ai: IMeetingAi;
}
