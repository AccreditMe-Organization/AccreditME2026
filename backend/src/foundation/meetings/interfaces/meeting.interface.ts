/** ACC-316 PR 3a — a meeting as the API answers it. Names are tenant data in both languages. */

export interface IMeetingOwner {
  kind: 'COMMITTEE' | 'UNIT';
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface IMeetingStage {
  id: string | null;
  nameEn: string | null;
  nameAr: string | null;
  flags: string[];
}

export interface IMeetingListItem {
  id: string;
  title: string;
  scheduledAt: Date;
  durationMinutes: number | null;
  location: string | null;
  meetingUrl: string | null;
  owner: IMeetingOwner;
  stage: IMeetingStage;
  /**
   * PR 8b (P240) — the whole series view only: where the meeting's latest
   * reschedule moved it from (its own MeetingReschedule row, the one the
   * meeting page reads); null if it never moved. Absent on the other views.
   */
  movedFrom?: Date | null;
}

export interface IMeetingList {
  items: IMeetingListItem[];
  total: number;
  /** ACC-316 PR 6 — whether this viewer may list All meetings (meetings:view), so the screen offers it without a copy of the rule. */
  canSeeAll: boolean;
}

export interface IMeeting extends IMeetingListItem {
  type: { id: string; labelEn: string; labelAr: string | null } | null;
  unitQuorum: number | null;
  organizer: { id: string; name: string };
  /** The newest reschedule: "Rescheduled from …". */
  rescheduledFrom: { fromAt: Date; reason: string; at: Date } | null;
  updatedAt: Date;
  /** What this viewer may do here, from the stage's rules and meeting-authority.ts. */
  may: { edit: boolean; reschedule: boolean; manageGuests: boolean; manageAgenda: boolean; answer: boolean };
  /** ACC-316 PR 3b — the MEMBER answers, for whoever may edit the meeting; null otherwise. */
  answers: IMeetingAnswerSummary | null;
  /** The viewer's own answer when they are an invitee; null otherwise. */
  myAnswer: { answer: 'ATTENDING' | 'CANT_ATTEND' | null; note: string | null } | null;
  /** ACC-316 PR 5 — "Meeting 3 of 12" and the series it belongs to; null for a single meeting. */
  series: {
    id: string;
    index: number;
    total: number;
    every: string;
    ended: boolean;
    /** PR 8-be (Q1) — the pattern's day, for the header's readback ("the 4th Thursday"). */
    on: { kind: string; weekday: number | null; dayOfMonth: number | null; ordinal: string | null };
    /** yyyy-MM-dd. */
    firstDate: string;
    /** yyyy-MM-dd, or null when the series ends after `count` meetings. */
    endsOn: string | null;
    count: number | null;
    /** The nearest meetings either side, not cancelled and open to this viewer; else null. */
    previousId: string | null;
    nextId: string | null;
    /** PR 8b (P239) — when those two meetings start, for the links' labels. */
    previousAt: Date | null;
    nextAt: Date | null;
    /** PR 8b — an ended series: the place of its last meeting not cancelled (0 if none); null while it runs. */
    endedAfter: number | null;
  } | null;
}

/** ACC-316 PR 5 — one date of a series, as it would be (or was) placed. */
export interface IMeetingSeriesDate {
  index: number;
  /** The pattern's day, and the day the meeting is held (moved off a weekend, holiday or a day the owner already meets). */
  patternDay: string;
  day: string;
  startsAt: Date;
  title: string;
  moved: 'NOT_WORKING_DAY' | 'OWNER_MEETS' | null;
}

export interface IMeetingSeriesPreview {
  dates: IMeetingSeriesDate[];
  clashes: IMeetingClash[];
}

/** What "this and all later" changed, and what each meeting kept as its own. */
export interface IMeetingScopeResult {
  changed: string[];
  kept: { meetingId: string; title: string; fields: string[] }[];
}

/**
 * PR 8-be (P236, Q2) — what "this and all later" WOULD do: the meetings it
 * reaches, at their times as they'd be (in time order); those that keep a field
 * as their own, at their own time; and the clashes at the new times.
 */
export interface IMeetingScopePreview {
  meetings: { id: string; title: string; startsAt: Date; durationMinutes: number }[];
  kept: { meetingId: string; title: string; fields: string[]; startsAt: Date }[];
  clashes: IMeetingClash[];
}

/** "6 attending · 2 can't · quorum 5": MEMBER answers only (plan §3.4). */
export interface IMeetingAnswerSummary {
  members: number;
  attending: number;
  cantAttend: number;
  noAnswer: number;
  /** The committee's quorum, or the unit meeting's own; null when it has none. */
  quorum: number | null;
  belowQuorum: boolean;
}

/** ACC-316 PR 6 — who Add a guest may choose: never an email. */
export interface IMeetingGuestCandidates {
  items: { id: string; name: string; unit: { nameEn: string; nameAr: string | null } | null; position: { nameEn: string; nameAr: string | null } | null }[];
  total: number;
  matching: number;
}

/** ACC-316 PR 3b — one invitee: a MEMBER, an organisation guest, or an outside guest. */
export interface IMeetingAttendee {
  id: string;
  kind: 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST';
  userId: string | null;
  name: string;
  seat: { id: string; labelEn: string; labelAr: string | null } | null;
  outsideOrganisation: string | null;
  outsideRole: string | null;
  /** Only for whoever may edit the meeting. */
  outsideEmail: string | null;
  /** Only for whoever may edit the meeting, and the person themselves. */
  answer: 'ATTENDING' | 'CANT_ATTEND' | null;
  answerNote: string | null;
  invited: boolean;
  addedAsPresenter: boolean;
}

/** ACC-316 PR 3b — one of a meeting's files: an attachment (agendaItemId null) or an agenda item's paper. */
export interface IMeetingFile {
  id: string;
  agendaItemId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
}

export interface IMeetingFiles {
  attachments: IMeetingFile[];
  papers: IMeetingFile[];
}

/** ACC-316 PR 3b — one agenda item, in order. */
export interface IMeetingAgendaItem {
  id: string;
  order: number;
  title: string;
  description: string | null;
  durationMinutes: number | null;
  standing: boolean;
  /** The presenter is an invitee: a member, an organisation guest or an outside guest. */
  presenter: { attendeeId: string; name: string; kind: 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST' } | null;
}

/** ACC-316 PR 3b — the clash check's answer: per time, per person, the other meetings that overlap. */
export interface IMeetingClash {
  /** The time checked, as sent. */
  startsAt: string;
  people: {
    userId: string;
    name: string;
    /** id and title only when the asker may open that meeting; otherwise both null ("another meeting"). */
    meetings: { id: string | null; title: string | null; startsAt: Date; durationMinutes: number }[];
  }[];
}

// ── ACC-316 PR 4 — the minutes and the review ────────────────────────────────

/** One invitee's attendance. `suggested` is "Apologies" for someone who answered "Can't attend" and has none recorded yet. */
export interface IMeetingAttendanceRow {
  attendeeId: string;
  kind: 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST';
  userId: string | null;
  name: string;
  seat: { id: string; labelEn: string; labelAr: string | null } | null;
  attendance: 'PRESENT' | 'APOLOGIES' | 'ABSENT' | null;
  suggested: 'APOLOGIES' | null;
}

export interface IMeetingDecision {
  id: string;
  order: number;
  text: string;
  votes: { for: number; against: number; abstain: number } | null;
  /** The meeting's present members were below its quorum (plan §3.5). */
  takenWithoutQuorum: boolean;
}

export interface IMeetingActionItem {
  id: string;
  title: string;
  owner: { id: string; name: string };
  dueAt: Date;
  /** Set once the minutes are approved; the task's live status (R3-8). */
  task: { id: string; status: string } | null;
}

export interface IMeetingMinutesItem {
  id: string;
  order: number;
  title: string;
  standing: boolean;
  discussion: string | null;
  decisions: IMeetingDecision[];
  actionItems: IMeetingActionItem[];
}

/** An action from the last meeting whose task is still open, with this meeting's note on it. */
export interface IMeetingOpenAction {
  taskId: string;
  title: string;
  status: string;
  dueAt: Date | null;
  owner: { id: string; name: string } | null;
  fromMeetingId: string;
  note: string | null;
}

/** An open action as the agenda shows it: linked to its task only where the task page would open it. */
export interface IMeetingOpenActionRow extends IMeetingOpenAction {
  mayOpen: boolean;
}

/**
 * ACC-316 PR 7b — "Open actions from the last meeting" for the agenda. Rows
 * only for whoever may read the LAST meeting's approved minutes. Anyone else
 * who sees this meeting, and everyone when there is no earlier approved
 * meeting, gets `mayRead: false` and no rows.
 */
export interface IMeetingOpenActions {
  mayRead: boolean;
  rows: IMeetingOpenActionRow[];
}

export interface IMeetingSuggestion {
  id: string;
  round: number;
  agendaItemId: string | null;
  author: { id: string; name: string };
  text: string;
  status: 'OPEN' | 'APPLIED' | 'DECLINED';
  reply: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}

export interface IMeetingReview {
  round: number;
  /** yyyy-MM-dd, or null before the first distribution. */
  reviewBy: string | null;
  datePassed: boolean;
  closed: boolean;
  reviewers: { userId: string; name: string; answered: boolean }[];
  suggestions: IMeetingSuggestion[];
  /** "Changed during review: item 2, decision" — one row per item and kind of change. */
  changes: { round: number; agendaItemId: string | null; what: string }[];
  /** The viewer's own answer in the current round, when they are a reviewer. */
  mine: 'NO_CORRECTIONS' | 'SUGGESTED' | null;
}

export interface IMeetingMinutes {
  phase: 'draft' | 'review' | 'approved';
  attendance: IMeetingAttendanceRow[];
  quorum: { quorum: number | null; presentMembers: number; met: boolean | null };
  items: IMeetingMinutesItem[];
  openActions: IMeetingOpenAction[];
  review: IMeetingReview;
  /** Distribute Minutes: ready, or why not (ACC-322 adds its undecided count here). */
  distribute: {
    ready: boolean;
    /** What holds Distribute: attendance first, then votes above the members present (P206). */
    blockedBy:
      | { code: 'MEETING_ATTENDANCE_INCOMPLETE'; missing: { attendeeId: string; name: string }[] }
      | { code: 'MEETING_VOTES_EXCEED_PRESENT'; items: { agendaItemId: string; title: string; total: number; present: number }[] }
      | null;
    /** yyyy-MM-dd: the review date when none is chosen (PR 7b). */
    defaultReviewBy: string;
  } | null;
  approvedAt: Date | null;
  /**
   * PR 7d-1 — who approved the minutes, named even after they leave or are
   * deactivated, with the committee seat they held at approval (the membership
   * ledger; their current seat where the ledger has nothing that early; null
   * for a unit meeting). Null before approval.
   */
  approvedBy: { id: string; name: string; seat: { id: string; labelEn: string; labelAr: string | null } | null } | null;
  may: {
    recordAttendance: boolean;
    recordMinutes: boolean;
    distribute: boolean;
    returnForCorrection: boolean;
    review: boolean;
    applySuggestions: boolean;
    changeActionDates: boolean;
  };
}

/** Home's rows for a meeting (self-scoped): reviews to answer, invitations to answer. */
export interface IMeetingAwaitingMe {
  /** `since`: when the meeting entered its current stage, so Home can order the row by how long it has waited (PR 7c-2). */
  review: { meetingId: string; title: string; reviewBy: string | null; since: Date }[];
  answer: { meetingId: string; title: string; scheduledAt: Date }[];
}
