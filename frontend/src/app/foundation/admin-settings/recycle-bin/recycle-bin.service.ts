import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

/** How long a deleted file waits in the bin (the backend's RECYCLE_BIN_DAYS). */
export const RECYCLE_BIN_DAYS = 30;
/** At most this many files in one purge (the backend's PURGE_MAX_FILES). */
export const PURGE_MAX_FILES = 100;

/**
 * GET /tenant/recycle-bin — one deleted, unpurged file (recycle-bin.interface.ts
 * on the backend). `record.name` is filled for tasks, the one record type
 * today, and is null when that task no longer exists.
 */
export interface IRecycleBinItem {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  record: { type: string; id: string; name: string | null };
  deletedBy: { id: string; name: string } | null;
  deletedAt: string;
  purgesAt: string;
  daysLeft: number;
}

/**
 * ACC-260, PR D — the tenant admin's recycle bin (tenant:manage_config). The
 * whole list, no paging; restore is one file per call and answers with the
 * list; purge is 1 to 100 files, all or nothing, and answers with a count.
 */
@Injectable({ providedIn: 'root' })
export class RecycleBinService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/tenant/recycle-bin`;

  list(): Observable<IRecycleBinItem[]> {
    return this.http.get<IRecycleBinItem[]>(this.baseUrl);
  }

  restore(fileId: string): Observable<IRecycleBinItem[]> {
    return this.http.post<IRecycleBinItem[]>(`${this.baseUrl}/${encodeURIComponent(fileId)}/restore`, {});
  }

  purge(fileIds: readonly string[]): Observable<{ purged: number }> {
    return this.http.post<{ purged: number }>(`${this.baseUrl}/purge`, { fileIds });
  }
}
