import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/**
 * ACC-316 PR 6 — the meeting API, as the backend answers it (PR 3a, 3b:
 * SYSTEM-REFERENCE §18). Names are tenant data in both languages; who may do
 * what is the server's (`may`, the stage's flags, the moves list), never
 * worked out here.
 */

export type MeetingListView = 'mine' | 'past' | 'minutes' | 'all' | 'subunits';
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

export interface MeetingDto extends MeetingListItemDto {
  type: { id: string; labelEn: string; labelAr: string | null } | null;
  unitQuorum: number | null;
  organizer: { id: string; name: string };
  rescheduledFrom: { fromAt: string; reason: string; at: string } | null;
  updatedAt: string;
  may: { edit: boolean; reschedule: boolean; manageGuests: boolean; manageAgenda: boolean; answer: boolean };
  answers: MeetingAnswerSummaryDto | null;
  myAnswer: { answer: MeetingAnswer | null; note: string | null } | null;
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
  review: { meetingId: string; title: string; reviewBy: string | null }[];
  answer: { meetingId: string; title: string; scheduledAt: string }[];
}

@Injectable({ providedIn: 'root' })
export class MeetingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/meetings`;

  list(query: { view?: MeetingListView; q?: string; committeeId?: string; orgUnitId?: string; skip?: number; take?: number }): Observable<MeetingListDto> {
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

  updateAgendaItem(id: string, itemId: string, body: Partial<AgendaItemRequest>): Observable<MeetingAgendaItemDto[]> {
    return this.http.patch<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/${itemId}`, body);
  }

  removeAgendaItem(id: string, itemId: string): Observable<MeetingAgendaItemDto[]> {
    return this.http.delete<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/${itemId}`);
  }

  orderAgenda(id: string, itemIds: string[]): Observable<MeetingAgendaItemDto[]> {
    return this.http.put<MeetingAgendaItemDto[]>(`${this.base}/${id}/agenda/order`, { itemIds });
  }

  files(id: string): Observable<MeetingFilesDto> {
    return this.http.get<MeetingFilesDto>(`${this.base}/${id}/files`);
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
}
