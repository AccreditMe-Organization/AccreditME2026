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
  may: { edit: boolean; reschedule: boolean };
}
