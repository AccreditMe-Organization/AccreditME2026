import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// ACC-198 — mirrors backend/src/foundation/ai-briefing/interfaces/ai-briefing.interface.ts.

export type BriefingGroupKind = 'overdue' | 'dueToday' | 'decision' | 'pool' | 'notification';

export interface BriefingItemDto {
  key: string;
  type: 'TASK' | 'TASK_REQUEST' | 'NOTIFICATION';
  id: string;
  title: string;
  titleAr?: string | null;
  dueAt?: string | null;
  requestType?: string;
  requestedFor?: string | null;
  createdAt?: string;
  /** Built by the server's code, never the model: where the item leads. */
  link: { target: 'task' | 'request' | 'committee'; id: string } | null;
  done: boolean;
}

export interface BriefingViewDto {
  available: boolean;
  creditCost: number | null;
  greeting: 'morning' | 'afternoon' | 'evening';
  briefing: {
    language: 'en' | 'ar';
    lead: string;
    generatedAt: string;
    creditCost: number;
    focus: { item: BriefingItemDto; reason: string }[];
    groups: { kind: BriefingGroupKind; items: BriefingItemDto[] }[];
  } | null;
}

@Injectable({ providedIn: 'root' })
export class AiBriefingService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/ai/briefing`;

  /** The caller's own briefing (today's) and whether they may make one. Self-scoped. */
  get(): Observable<BriefingViewDto> {
    return this.http.get<BriefingViewDto>(this.baseUrl);
  }

  /** Make a new one in the language the caller is reading in (D4). 5 credits, through the AI gateway. */
  make(language: 'en' | 'ar'): Observable<BriefingViewDto> {
    return this.http.post<BriefingViewDto>(this.baseUrl, { language });
  }
}
