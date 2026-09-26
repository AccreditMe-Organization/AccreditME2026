import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface WorkingCalendarDto {
  id: string;
  organizationId: string;
  timezone: string;
  workingDays: number[];       // 0=Sun … 6=Sat
  workingHoursStart: string;   // "HH:mm"
  workingHoursEnd: string;     // "HH:mm"
  createdAt: string;
  updatedAt: string;
}

export interface UpdateWorkingCalendarDto {
  timezone?: string;
  workingDays?: number[];
  workingHoursStart?: string;
  workingHoursEnd?: string;
}

export interface PublicHolidayDto {
  id: string;
  workingCalendarId: string;
  nameEn: string;
  nameAr: string | null;
  date: string;           // ISO 8601 date string "YYYY-MM-DD"
  isRecurring: boolean;
  createdAt: string;
}

export interface CreatePublicHolidayDto {
  nameEn: string;
  nameAr?: string;
  date: string;
  isRecurring?: boolean;
}

/**
 * One recorded change to the calendar — ACC-120 slice 1.
 *
 * `before` / `after` are the whole `IWorkingCalendar` as it stood, which is what
 * the backend records. Read them through `diffCalendarChange()` rather than
 * key-by-key: only four of those fields are mutable, and `updatedAt` differs on
 * every edit by definition.
 */
export interface WorkingCalendarChangeDto {
  id: string;
  changedAt: string;
  /** Null is a real answer — a change made by the system has no actor. */
  actorName: string | null;
  before: unknown;
  after: unknown;
}

export interface AiHolidaySuggestion {
  nameEn: string;
  nameAr: string | null;
  date: string;
  isRecurring: boolean;
}

@Injectable({ providedIn: 'root' })
export class WorkingCalendarService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/working-calendar`;

  getCalendar(): Observable<WorkingCalendarDto> {
    return this.http.get<WorkingCalendarDto>(this.base);
  }

  updateCalendar(dto: UpdateWorkingCalendarDto): Observable<WorkingCalendarDto> {
    return this.http.patch<WorkingCalendarDto>(this.base, dto);
  }

  /**
   * Who changed the calendar, when, and what it was before.
   *
   * `org:manage`, unlike `getCalendar()` which needs nothing: this names the
   * people who changed the configuration and carries the values they replaced.
   * A caller with only `org:view` gets a 403, and the page treats that as an
   * absent annotation rather than a failure.
   */
  getChangeHistory(): Observable<WorkingCalendarChangeDto[]> {
    return this.http.get<WorkingCalendarChangeDto[]>(`${this.base}/history`);
  }

  getHolidays(year?: number): Observable<PublicHolidayDto[]> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<PublicHolidayDto[]>(`${this.base}/holidays`, { params });
  }

  addHoliday(dto: CreatePublicHolidayDto): Observable<PublicHolidayDto> {
    return this.http.post<PublicHolidayDto>(`${this.base}/holidays`, dto);
  }

  updateHoliday(id: string, dto: Partial<CreatePublicHolidayDto>): Observable<PublicHolidayDto> {
    return this.http.patch<PublicHolidayDto>(`${this.base}/holidays/${id}`, dto);
  }

  removeHoliday(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/holidays/${id}`);
  }

  /**
   * UNREFERENCED TODAY, AND PARKED ON PURPOSE — not forgotten.
   *
   * There is no handler for this route anywhere in the backend: the
   * working-calendar controller exposes six endpoints and none under `ai/`, so
   * calling it is a 404. The old settings screen had a button wired straight to
   * it, which is why pressing "Suggest holidays" failed rather than explaining
   * itself.
   *
   * The UI block is KEPT (Ahmad: "we need to keep it until we bring AI
   * capabilities to the application") and now states that it is not available
   * yet, offering no control that could only fail. This method and
   * `AiHolidaySuggestion` stay as the client and the response shape for when the
   * endpoint is built — deleting them would lose the contract, and leaving them
   * unmarked would let a reader think the feature works.
   */
  suggestHolidays(country: string, year: number): Observable<AiHolidaySuggestion[]> {
    return this.http.post<AiHolidaySuggestion[]>(`${this.base}/ai/suggest-holidays`, {
      country,
      year,
      language: 'en',
    });
  }
}
