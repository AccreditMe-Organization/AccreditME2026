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

  getHolidays(year?: number): Observable<PublicHolidayDto[]> {
    const params = year ? new HttpParams().set('year', year) : undefined;
    return this.http.get<PublicHolidayDto[]>(`${this.base}/holidays`, { params });
  }

  addHoliday(dto: CreatePublicHolidayDto): Observable<PublicHolidayDto> {
    return this.http.post<PublicHolidayDto>(`${this.base}/holidays`, dto);
  }

  removeHoliday(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/holidays/${id}`);
  }

  suggestHolidays(country: string, year: number): Observable<AiHolidaySuggestion[]> {
    return this.http.post<AiHolidaySuggestion[]>(`${this.base}/ai/suggest-holidays`, {
      country,
      year,
      language: 'en',
    });
  }
}
