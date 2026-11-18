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
}

export interface IMeetingList {
  items: IMeetingListItem[];
  total: number;
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
