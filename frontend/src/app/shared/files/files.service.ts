import { DOCUMENT } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { Observable, shareReplay } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FormatService } from '../../core/formatting';

/** What the upload screen shows before a file is chosen (GET /files/upload-limits). */
export interface IUploadLimitsDto {
  maxUploadBytes: number;
  allowedExtensions: string[];
}

/** Where to fetch a file for the next fifteen minutes — see the backend's IFileDownload. */
export interface IFileDownload {
  url: string;
  viaApi: boolean;
}

// ACC-177 — the refusal codes the storage API sends (storage-refusal.ts on the
// backend). Each has words in both languages under files.refusal.*; anything
// else falls back to the server's English message.
const REFUSAL_CODES = new Set([
  'STORAGE_NOT_CONFIRMED',
  'STORAGE_ALREADY_CONFIRMED',
  'STORAGE_CHANGE_BY_PLATFORM',
  'STORAGE_TEST_FAILED',
  'STORAGE_NOT_CONFIGURED',
  'STORAGE_PROVIDER_NOT_ALLOWED',
  'STORAGE_ENDPOINT_NOT_ALLOWED',
  'STORAGE_UNAVAILABLE',
  'STORAGE_QUOTA_EXCEEDED',
  'STORAGE_SETTINGS_INCOMPLETE',
  'FILE_MISSING',
  'FILE_EMPTY',
  'FILE_TOO_LARGE',
  'FILE_TYPE_NOT_ALLOWED',
  'FILE_UNAVAILABLE',
  'FILE_RECORD_GONE',
  // ACC-189 — ACC-185 shipped the SharePoint withdrawal backend only, so it
  // showed the server's English; and the viewer's type refusal.
  'STORAGE_ACCESS_WITHDRAWN',
  'PREVIEW_NOT_AVAILABLE',
]);

/**
 * ACC-177 — the browser's side of file storage, shared by every screen that
 * uploads or opens a file (task evidence today; meetings and documents later).
 */
@Injectable({ providedIn: 'root' })
export class FilesService {
  private readonly http = inject(HttpClient);
  private readonly document = inject(DOCUMENT);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);

  private limits$?: Observable<IUploadLimitsDto>;

  /** Read once per session: the cap and the types are installation settings. */
  uploadLimits(): Observable<IUploadLimitsDto> {
    this.limits$ ??= this.http
      .get<IUploadLimitsDto>(`${environment.apiUrl}/files/upload-limits`)
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.limits$;
  }

  /**
   * Opens a download. The response is an attachment, so navigating to it saves
   * the file and leaves this page where it is — and, unlike window.open after
   * an async call, it is not a popup a browser may block.
   */
  open(download: IFileDownload): void {
    const url = download.viaApi ? `${environment.apiUrl}/${download.url}` : download.url;
    this.document.location.assign(url);
  }

  /** "10 GB", "2.4 MB", "350 KB" — through the formatting layer, Latin digits in both languages. */
  size(bytes: number): string {
    if (bytes >= 1024 * 1024 * 1024) {
      return this.translate.instant('files.sizeGb', { size: this.format.number(Math.round((bytes / 1024 ** 3) * 10) / 10) });
    }
    if (bytes >= 1024 * 1024) {
      return this.translate.instant('files.sizeMb', { size: this.format.number(Math.round((bytes / (1024 * 1024)) * 10) / 10) });
    }
    return this.translate.instant('files.sizeKb', { size: this.format.number(Math.max(1, Math.round(bytes / 1024))) });
  }

  /**
   * A storage refusal in the reader's language, or null when the error is not
   * one — the caller then shows the server's message as it does elsewhere.
   */
  refusal(err: unknown): string | null {
    const body = (err as { error?: { code?: unknown; maxBytes?: unknown } })?.error;
    const code = typeof body?.code === 'string' ? body.code : null;
    if (!code || !REFUSAL_CODES.has(code)) return null;
    return this.translate.instant(`files.refusal.${code}`, {
      size: typeof body?.maxBytes === 'number' ? this.size(body.maxBytes) : '',
    });
  }
}

/** The `accept` attribute for a file input, from the allowed extensions. */
export function acceptAttribute(extensions: readonly string[]): string {
  return extensions.map((e) => `.${e}`).join(',');
}

/** The lower-case extension of a file name, or ''. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}
