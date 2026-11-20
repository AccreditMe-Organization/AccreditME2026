import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { MyWorkEvents } from '../../../core/my-work/my-work-events';
import { environment } from '../../../../environments/environment';
import type { IFileDownload } from '../../../shared/files/files.service';

function fileBody(file: File): FormData {
  const body = new FormData();
  body.append('file', file, file.name);
  return body;
}

/**
 * ACC-316 PR 6 — the meeting API, as the backend answers it (PR 3a, 3b:
 * SYSTEM-REFERENCE §18). Names are tenant data in both languages; who may do
 * what is the server's (`may`, the stage's flags, the moves list), never
 * worked out here.
 */

export type MeetingListView = 'mine' | 'upcoming' | 'past' | 'minutes' | 'all' | 'subunits';
export type MeetingAttendeeKind = 'MEMBER' | 'ORG_GUEST' | 'OUTSIDE_GUEST';
export type MeetingAnswer = 'ATTENDING' | 'CANT_ATTEND';

/** The stage flags a meeting's stages carry (record-registry.ts). */
export const MEETING_STAGE_FLAG = {
  AGENDA_ISSUED: 'AGENDA_ISSUED',
  MEETING_CANCELLED: 'MEETING_CANCELLED',
  MINUTES_FINAL: 'MINUTES_FINAL',
} as const;

export interface MeetingOwnerDto {
  kind: 'COMMITTEE' | 'UNIT';
  id: string;
  nameEn: string;
  nameAr: string | null;
}

export interface MeetingStageDto {
  id: string | null;
  nameEn: string | null;
  nameAr: string | null;
  flags: string[];
}

export interface MeetingListItemDto {
  id: string;
  title: string;
  scheduledAt: string;
  durationMinutes: number | null;
  location: string | null;
  meetingUrl: string | null;
  owner: MeetingOwnerDto;
  stage: MeetingStageDto;
}

export interface MeetingListDto {
  items: MeetingListItemDto[];
  total: number;
  /** Whether this person may list All meetings: the screen offers it from this, never a permission of its own. */
  canSeeAll: boolean;
}

/** "6 attending · 2 can't · quorum 5": MEMBER answers, for whoever may edit the meeting. */
export interface MeetingAnswerSummaryDto {
  members: number;
  attending: number;
  cantAttend: number;
  noAnswer: number;
  quorum: number | null;
  belowQuorum: boolean;
}

/** ACC-316 PR 5 — a series' pattern, as the server stores it (SERIES_EVERY, SERIES_ON, SERIES_ORDINAL in meeting.dto.ts). */
export type MeetingSeriesEvery = 'WEEK_1' | 'WEEK_2' | 'MONTH_1' | 'MONTH_3' | 'MONTH_6' | 'MONTH_12';
export type MeetingSeriesOnKind = 'WEEKDAY' | 'DAY_OF_MONTH' | 'ORDINAL_WEEKDAY';
export type MeetingSeriesOrdinal = 'FIRST' | 'SECOND' | 'THIRD' | 'FOURTH' | 'LAST';

/** What the readback is built from: how often, and on which day (weekday 1 Monday … 7 Sunday). */
export interface MeetingSeriesPattern {
  every: MeetingSeriesEvery;
  on: { kind: MeetingSeriesOnKind; weekday: number | null; dayOfMonth: number | null; ordinal: MeetingSeriesOrdinal | null };
}

/**
 * The series a meeting belongs to (GET /meetings/:id, PR 5, 8-be, 8b). The
 * neighbours are the server's: the nearest meetings either side that aren't
 * cancelled and that this viewer may open, else null; never worked out here.
 */
export interface MeetingSeriesDto extends MeetingSeriesPattern {
  id: string;
  index: number;
  total: number;
  ended: boolean;
  firstDate: string;
  endsOn: string | null;
  count: number | null;
  previousId: string | null;
  previousAt: string | null;
  nextId: string | null;
  nextAt: string | null;
  /** An ended series: the place of its last meeting not cancelled (0 if none); null while it runs. */
  endedAfter: number | null;
}

export interface MeetingDto extends MeetingListItemDto {
  type: { id: string; labelEn: string; labelAr: string | null } | null;
  unitQuorum: number | null;
  organizer: { id: string; name: string };
  rescheduledFrom: { fromAt: string; reason: string; at: string } | null;
  updatedAt: string;
  may: { edit: boolean; reschedule: boolean; manageGuests: boolean; manageAgenda: boolean; answer: boolean };
  answers: MeetingAnswerSummaryDto | null;
  myAnswer: { answer: MeetingAnswer | null; note: string | null } | null;
  /** Null for a meeting outside a series. */
  series: MeetingSeriesDto | null;
}

export interface MeetingAttendeeDto {
  id: string;
  kind: MeetingAttendeeKind;
  userId: string | null;
  name: string;
  seat: { id: string; labelEn: string; labelAr: string | null } | null;
  outsideOrganisation: string | null;
  outsideRole: string | null;
  outsideEmail: string | null;
  answer: MeetingAnswer | null;
  answerNote: string | null;
  invited: boolean;
  addedAsPresenter: boolean;
}

export interface MeetingAgendaItemDto {
  id: string;
  order: number;
  title: string;
  description: string | null;
  durationMinutes: number | null;
  standing: boolean;
  presenter: { attendeeId: string; name: string; kind: MeetingAttendeeKind } | null;
}

export interface MeetingFileDto {
  id: string;
  agendaItemId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface MeetingFilesDto {
  attachments: MeetingFileDto[];
  papers: MeetingFileDto[];
}

export interface ScheduleMeetingRequest {
  committeeId?: string;
  orgUnitId?: string;
  title: string;
  typeValueId: string;
  scheduledAt: string;
  durationMinutes: number;
  location?: string | null;
  meetingUrl?: string | null;
  unitQuorum?: number | null;
}

export interface RescheduleMeetingRequest {
  scheduledAt: string;
  reason: string;
  expectedUpdatedAt?: string;
}

export type AddGuestRequest =
  | { userId: string }
  | { outsideName: string; outsideEmail: string; outsideOrganisation?: string | null; outsideRole?: string | null };

export interface AgendaItemRequest {
  title: string;
  description?: string | null;
  durationMinutes?: number | null;
  presenter?: { attendeeId: string } | { userId: string } | null;
  standing?: boolean;
}

/**
 * ACC-323 — an edit's view of the fields it changes, as the dialog loaded them:
 * the server refuses the save (MEETING_AGENDA_CHANGED) when one of them holds
 * something else now. The presenter by its attendee id, null for none.
 */
export interface AgendaItemExpected {
  title?: string;
  description?: string | null;
  durationMinutes?: number | null;
  presenterAttendeeId?: string | null;
}

/** An edit: only the changed fields, and what this person saw of them. */
export type AgendaItemUpdate = Partial<AgendaItemRequest> & { expected?: AgendaItemExpected };

export interface MeetingClashDto {
  startsAt: string;
  people: { userId: string; name: string; meetings: { id: string | null; title: string | null; startsAt: string; durationMinutes: number }[] }[];
}

/** Add a guest's person search: never an email. */
export interface MeetingGuestCandidatesDto {
  items: { id: string; name: string; unit: { nameEn: string; nameAr: string | null } | null; position: { nameEn: string; nameAr: string | null } | null }[];
  total: number;
  matching: number;
}

export interface MeetingAwaitingMeDto {
  /** `since`: when the meeting entered its current stage, Home's order (PR 7c-2). */
  review: { meetingId: string; title: string; reviewBy: string | null; since: string }[];
  answer: { meetingId: string; title: string; scheduledAt: string }[];
}

// ── ACC-316 PR 7b — minutes (GET /meetings/:id/minutes and its writes) ─────────

export type MeetingAttendance = 'PRESENT' | 'APOLOGIES' | 'ABSENT';
export type MinutesPhase = 'draft' | 'review' | 'approved';

export interface MeetingAttendanceRowDto {
  attendeeId: string;
  kind: MeetingAttendeeKind;
  userId: string | null;
  name: string;
  seat: { id: string; labelEn: string; labelAr: string | null } | null;
  attendance: MeetingAttendance | null;
  /** "Apologies" for someone who answered "Can't attend" and has nothing recorded yet. */
  suggested: 'APOLOGIES' | null;
}

export interface MeetingVotesDto {
  for: number;
  against: number;
  abstain: number;
}

export interface MeetingDecisionDto {
  id: string;
  order: number;
  text: string;
  votes: MeetingVotesDto | null;
  takenWithoutQuorum: boolean;
}

export interface MeetingActionItemDto {
  id: string;
  title: string;
  owner: { id: string; name: string };
  dueAt: string;
  task: { id: string; status: string } | null;
}

export interface MeetingMinutesItemDto {
  id: string;
  order: number;
  title: string;
  standing: boolean;
  discussion: string | null;
  decisions: MeetingDecisionDto[];
  actionItems: MeetingActionItemDto[];
}

export interface MeetingOpenActionDto {
  taskId: string;
  title: string;
  status: string;
  dueAt: string | null;
  owner: { id: string; name: string } | null;
  fromMeetingId: string;
  note: string | null;
}

export interface MeetingOpenActionRowDto extends MeetingOpenActionDto {
  /** The task page would open it for this viewer: only then is the title a link. */
  mayOpen: boolean;
}

/** "Open actions from the last meeting": rows only for whoever may read that meeting's minutes. */
export interface MeetingOpenActionsDto {
  mayRead: boolean;
  rows: MeetingOpenActionRowDto[];
}

/** A correction a present member suggested in a review round (PR 7c-1). */
export interface MeetingSuggestionDto {
  id: string;
  round: number;
  /** The agenda item it is about, or null for the minutes as a whole. */
  agendaItemId: string | null;
  author: { id: string; name: string };
  text: string;
  status: 'OPEN' | 'APPLIED' | 'DECLINED';
  reply: string | null;
  createdAt: string;
  decidedAt: string | null;
}

export interface MeetingMinutesDto {
  phase: MinutesPhase;
  attendance: MeetingAttendanceRowDto[];
  quorum: { quorum: number | null; presentMembers: number; met: boolean | null };
  items: MeetingMinutesItemDto[];
  openActions: MeetingOpenActionDto[];
  review: {
    round: number;
    reviewBy: string | null;
    datePassed: boolean;
    closed: boolean;
    reviewers: { userId: string; name: string; answered: boolean }[];
    suggestions: MeetingSuggestionDto[];
    changes: { round: number; agendaItemId: string | null; what: string }[];
    mine: 'NO_CORRECTIONS' | 'SUGGESTED' | null;
  };
  distribute: {
    ready: boolean;
    blockedBy:
      | { code: 'MEETING_ATTENDANCE_INCOMPLETE'; missing: { attendeeId: string; name: string }[] }
      | { code: 'MEETING_VOTES_EXCEED_PRESENT'; items: { agendaItemId: string; title: string; total: number; present: number }[] }
      | null;
    defaultReviewBy: string;
  } | null;
  approvedAt: string | null;
  /** PR 7d-1 — who approved, named even after they leave, with the seat they held then (null for a unit meeting's approver). */
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

export interface MeetingDecisionRequest {
  text: string;
  votesFor?: number | null;
  votesAgainst?: number | null;
  votesAbstain?: number | null;
}

export interface MeetingActionRequest {
  title: string;
  ownerUserId: string;
  dueAt: string;
}

@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly http = inject(HttpClient);
  /** PR 7c-2 — a write that changes what waits on someone tells Home and the rail (ACC-279). */
  private readonly myWork = inject(MyWorkEvents);
  private readonly base = `${environment.apiUrl}/meetings`;

  list(query: { view?: MeetingListView; q?: string; committeeId?: string; orgUnitId?: string; seriesId?: string; skip?: number; take?: number }): Observable<MeetingListDto> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    return this.http.get<MeetingListDto>(this.base, { params });
  }

  get(id: string): Observable<MeetingDto> {
    return this.http.get<MeetingDto>(`${this.base}/${id}`);
  }

  schedule(body: ScheduleMeetingRequest): Observable<MeetingDto> {
    return this.http.post<MeetingDto>(this.base, body);
  }

  reschedule(id: string, body: RescheduleMeetingRequest): Observable<MeetingDto> {
    return this.http.post<MeetingDto>(`${this.base}/${id}/reschedule`, body);
  }

  attendees(id: string): Observable<MeetingAttendeeDto[]> {
    return this.http.get<MeetingAttendeeDto[]>(`${this.base}/${id}/attendees`);
  }

  addGuest(id: string, body: AddGuestRequest): Observable<MeetingAttendeeDto> {
    return this.http.post<MeetingAttendeeDto>(`${this.base}/${id}/guests`, body);
  }

  removeGuest(id: string, attendeeId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/guests/${attendeeId}`);
  }

  answer(id: string, body: { answer: MeetingAnswer; note?: string | null }): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}/answer`, body);
  }

  agenda(id: string): Observable<MeetingAgendaItemDto[]> {
    return this.http.get<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda`);
  }

  addAgendaItem(id: string, body: AgendaItemRequest): Observable<MeetingAgendaItemDto[]> {
    return this.http.post<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda`, body);
  }

  updateAgendaItem(id: string, itemId: string, body: AgendaItemUpdate): Observable<MeetingAgendaItemDto[]> {
    return this.http.patch<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/${itemId}`, body);
  }

  removeAgendaItem(id: string, itemId: string): Observable<MeetingAgendaItemDto[]> {
    return this.http.delete<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/${itemId}`);
  }

  /** The new order, and the order the person saw (`expectedItemIds`): a different agenda now is MEETING_AGENDA_CHANGED. */
  orderAgenda(id: string, itemIds: string[], expectedItemIds: string[]): Observable<MeetingAgendaItemDto[]> {
    return this.http.put<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/order`, { itemIds, expectedItemIds });
  }

  files(id: string): Observable<MeetingFilesDto> {
    return this.http.get<MeetingFilesDto>(`${this.base}/${id}/files`);
  }

  /** ACC-316 PR 7 — a paper of one agenda item (multipart, the field `file`). */
  addPaper(id: string, itemId: string, file: File): Observable<MeetingFileDto> {
    return this.http.post<MeetingFileDto>(`${this.base}/${id}/agenda/${itemId}/files`, fileBody(file));
  }

  /** ACC-316 PR 7 — a general attachment of the meeting. */
  addAttachment(id: string, file: File): Observable<MeetingFileDto> {
    return this.http.post<MeetingFileDto>(`${this.base}/${id}/files`, fileBody(file));
  }

  removeFile(id: string, fileId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}/files/${fileId}`);
  }

  /** The in-app viewer's link (the same entitlement as the download). */
  viewFile(id: string, fileId: string): Observable<IFileDownload> {
    return this.http.get<IFileDownload>(`${this.base}/${id}/files/${fileId}/view`);
  }

  downloadFile(id: string, fileId: string): Observable<IFileDownload> {
    return this.http.get<IFileDownload>(`${this.base}/${id}/files/${fileId}/download`);
  }

  clashes(body: { meetingId?: string; committeeId?: string; orgUnitId?: string; times: { startsAt: string; durationMinutes: number }[] }): Observable<MeetingClashDto[]> {
    return this.http.post<MeetingClashDto[]>(`${this.base}/clashes`, body);
  }

  /** The meeting types Schedule meeting offers (needs no lookups:view). */
  formChoices(): Observable<{ types: { id: string; labelEn: string; labelAr: string | null }[] }> {
    return this.http.get<{ types: { id: string; labelEn: string; labelAr: string | null }[] }>(`${this.base}/form-choices`);
  }

  /** Whether Schedule meeting is offered for this committee or unit (the server's SCHEDULERS rule). */
  maySchedule(owner: { committeeId?: string; orgUnitId?: string }): Observable<{ may: boolean }> {
    let params = new HttpParams();
    if (owner.committeeId) params = params.set('committeeId', owner.committeeId);
    if (owner.orgUnitId) params = params.set('orgUnitId', owner.orgUnitId);
    return this.http.get<{ may: boolean }>(`${this.base}/may-schedule`, { params });
  }

  guestCandidates(id: string, query: { q?: string; skip?: number; take?: number }): Observable<MeetingGuestCandidatesDto> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params = params.set(k, String(v));
    return this.http.get<MeetingGuestCandidatesDto>(`${this.base}/${id}/guest-candidates`, { params });
  }

  awaitingMe(): Observable<MeetingAwaitingMeDto> {
    return this.http.get<MeetingAwaitingMeDto>(`${this.base}/awaiting-me`);
  }

  // ── Minutes (PR 7b): every write answers with the whole minutes ─────────────

  minutes(id: string): Observable<MeetingMinutesDto> {
    return this.http.get<MeetingMinutesDto>(`${this.base}/${id}/minutes`);
  }

  openActions(id: string): Observable<MeetingOpenActionsDto> {
    return this.http.get<MeetingOpenActionsDto>(`${this.base}/${id}/open-actions`);
  }

  recordAttendance(id: string, rows: { attendeeId: string; attendance: MeetingAttendance | null }[]): Observable<MeetingMinutesDto> {
    return this.http.put<MeetingMinutesDto>(`${this.base}/${id}/attendance`, { rows });
  }

  saveDiscussion(id: string, itemId: string, discussion: string | null): Observable<MeetingMinutesDto> {
    return this.http.put<MeetingMinutesDto>(`${this.base}/${id}/agenda/${itemId}/minutes`, { discussion });
  }

  addDecision(id: string, itemId: string, body: MeetingDecisionRequest): Observable<MeetingMinutesDto> {
    return this.http.post<MeetingMinutesDto>(`${this.base}/${id}/agenda/${itemId}/decisions`, body);
  }

  updateDecision(id: string, itemId: string, decisionId: string, body: MeetingDecisionRequest): Observable<MeetingMinutesDto> {
    return this.http.patch<MeetingMinutesDto>(`${this.base}/${id}/agenda/${itemId}/decisions/${decisionId}`, body);
  }

  removeDecision(id: string, itemId: string, decisionId: string): Observable<MeetingMinutesDto> {
    return this.http.delete<MeetingMinutesDto>(`${this.base}/${id}/agenda/${itemId}/decisions/${decisionId}`);
  }

  addAction(id: string, itemId: string, body: MeetingActionRequest): Observable<MeetingMinutesDto> {
    return this.http.post<MeetingMinutesDto>(`${this.base}/${id}/agenda/${itemId}/actions`, body);
  }

  removeAction(id: string, actionId: string): Observable<MeetingMinutesDto> {
    return this.http.delete<MeetingMinutesDto>(`${this.base}/${id}/actions/${actionId}`);
  }

  saveOpenActionNote(id: string, taskId: string, note: string | null): Observable<MeetingMinutesDto> {
    return this.http.put<MeetingMinutesDto>(`${this.base}/${id}/open-actions/${taskId}/note`, { note });
  }

  // ── Review (PR 7c-1): these writes answer with nothing; the page reads the minutes again ──

  noCorrections(id: string): Observable<void> {
    return this.http.put<void>(`${this.base}/${id}/review/no-corrections`, {}).pipe(tap(() => this.myWork.changed()));
  }

  suggest(id: string, body: { agendaItemId: string | null; text: string }): Observable<{ id: string }> {
    return this.http.post<{ id: string }>(`${this.base}/${id}/review/suggestions`, body).pipe(tap(() => this.myWork.changed()));
  }

  applySuggestion(id: string, suggestionId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/review/suggestions/${suggestionId}/apply`, {});
  }

  declineSuggestion(id: string, suggestionId: string, reply: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/review/suggestions/${suggestionId}/decline`, { reply });
  }

  /** Return for Correction: back to Minutes Draft, with an optional reason the present members read. */
  returnMinutes(id: string, reason: string | null): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/return`, { reason }).pipe(tap(() => this.myWork.changed()));
  }

  /** The app's move into Minutes Review; `reviewBy` (yyyy-MM-dd) only when the person changed the default. */
  distribute(id: string, reviewBy?: string): Observable<void> {
    return this.http.post<void>(`${this.base}/${id}/distribute`, reviewBy ? { reviewBy } : {}).pipe(tap(() => this.myWork.changed()));
  }
}
