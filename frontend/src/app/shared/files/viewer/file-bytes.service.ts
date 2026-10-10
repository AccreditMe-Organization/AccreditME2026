import { HttpBackend, HttpClient, HttpErrorResponse, HttpEvent, HttpEventType, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, catchError, filter, map, switchMap, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { IFileDownload } from '../files.service';
import { FileViewError, FileViewProblem, IViewableFile } from './file-viewer.model';

export type FileBytesEvent =
  | { type: 'progress'; loaded: number; total: number | null }
  | { type: 'loaded'; bytes: ArrayBuffer };

/** A minted URL as the browser fetches it: a stream URL is relative to the API. */
export function resolveFileUrl(download: IFileDownload): string {
  return download.viaApi ? `${environment.apiUrl}/${download.url}` : download.url;
}

/**
 * ACC-189 — fetches a file's bytes for the in-app viewer.
 *
 * THE STORAGE FETCH NEVER CARRIES CREDENTIALS, and that is load-bearing, not
 * tidiness. AccreditMe cloud (Supabase S3) answers a pre-signed GET with
 * `Access-Control-Allow-Origin: *`, and a browser REJECTS a wildcard answer to
 * a credentialed request. The app's auth interceptor makes every HttpClient
 * request credentialed, with no opt-out — so the fetch goes through a client
 * built on HttpBackend, which no interceptor sees, and `withCredentials` stays
 * false. A stream URL (local folder, SharePoint) needs no session either: its
 * token is the whole entitlement for fifteen minutes. The MINT itself goes
 * through the host's `access()`, on the ordinary client, because it needs the
 * session. Pinned by spec, with the real interceptor installed.
 *
 * Nothing here holds bytes: the caller keeps one file at a time and drops it.
 * Unsubscribing aborts the request (HttpClient aborts the XHR).
 */
@Injectable({ providedIn: 'root' })
export class FileBytesService {
  private readonly storage = new HttpClient(inject(HttpBackend));

  load(file: IViewableFile, access: (file: IViewableFile) => Observable<IFileDownload>): Observable<FileBytesEvent> {
    return this.attempt(file, access, true);
  }

  private attempt(
    file: IViewableFile,
    access: (file: IViewableFile) => Observable<IFileDownload>,
    mayRetry: boolean,
  ): Observable<FileBytesEvent> {
    return access(file).pipe(
      catchError((error: unknown) => throwError(() => new FileViewError(mintProblem(error), statusOf(error)))),
      switchMap((download) =>
        this.fetch(download).pipe(
          catchError((error: unknown) => {
            if (error instanceof FileViewError) return throwError(() => error);
            // A link that ran out (fifteen minutes) is minted again, once.
            if (mayRetry && linkExpired(error, download)) return this.attempt(file, access, false);
            return throwError(() => new FileViewError(fetchProblem(error, download), statusOf(error)));
          }),
        ),
      ),
    );
  }

  private fetch(download: IFileDownload): Observable<FileBytesEvent> {
    return this.storage
      .request('GET', resolveFileUrl(download), {
        responseType: 'arraybuffer',
        observe: 'events',
        reportProgress: true,
        withCredentials: false,
      })
      .pipe(
        filter(
          (event: HttpEvent<ArrayBuffer>) =>
            event.type === HttpEventType.DownloadProgress || event.type === HttpEventType.Response,
        ),
        map((event): FileBytesEvent => {
          if (event.type === HttpEventType.DownloadProgress) {
            return { type: 'progress', loaded: event.loaded, total: event.total ?? null };
          }
          return { type: 'loaded', bytes: (event as HttpResponse<ArrayBuffer>).body ?? new ArrayBuffer(0) };
        }),
      );
  }
}

function statusOf(error: unknown): number | null {
  return error instanceof HttpErrorResponse ? error.status : null;
}

/**
 * The refusal code in an error body. A storage fetch asks for an ArrayBuffer,
 * so a stream route's JSON refusal (a SharePoint withdrawal) arrives as bytes.
 */
export function refusalCodeOf(error: unknown): string | null {
  if (!(error instanceof HttpErrorResponse)) return null;
  let body: unknown = error.error;
  if (body instanceof ArrayBuffer) {
    try {
      body = JSON.parse(new TextDecoder().decode(body));
    } catch {
      return null;
    }
  }
  const code = (body as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

function mintProblem(error: unknown): FileViewProblem {
  const code = refusalCodeOf(error);
  if (code === 'STORAGE_ACCESS_WITHDRAWN') return 'withdrawn';
  if (code === 'PREVIEW_NOT_AVAILABLE') return 'noPreview';
  // The host's identical 404 ("Evidence not found") is what a deleted file or
  // deleted evidence answers; FILE_UNAVAILABLE is a stored file deleted under it.
  if (code === 'FILE_UNAVAILABLE' || statusOf(error) === 404) return 'deleted';
  return 'failed';
}

function fetchProblem(error: unknown, download: IFileDownload): FileViewProblem {
  const code = refusalCodeOf(error);
  if (code === 'STORAGE_ACCESS_WITHDRAWN') return 'withdrawn';
  if (code === 'FILE_UNAVAILABLE') return 'deleted';
  // Status 0 on a cross-origin storage URL: the browser refused the answer —
  // a customer's MinIO whose CORS policy does not admit this origin (D3).
  if (!download.viaApi && statusOf(error) === 0) return 'storageBlocked';
  return 'failed';
}

/** S3 answers an expired pre-signed GET with 403; the stream route an expired token with 404. */
function linkExpired(error: unknown, download: IFileDownload): boolean {
  const status = statusOf(error);
  return download.viaApi ? status === 404 : status === 403;
}
