import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpEventType, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { authInterceptor } from '../../../core/interceptors/auth.interceptor';
import { AuthService } from '../../../core/services/auth.service';
import { IFileDownload } from '../files.service';
import { FileBytesEvent, FileBytesService } from './file-bytes.service';
import { FileViewError, IViewableFile } from './file-viewer.model';

const FILE: IViewableFile = { id: 'ev-1', name: 'محضر.pdf', mimeType: 'application/pdf', sizeBytes: 9 };
const MINT_URL = `${environment.apiUrl}/tasks/task-1/evidence/ev-1/view`;
const SIGNED = 'https://project.storage.supabase.co/storage/v1/s3/bucket/key?X-Amz-Signature=x';
const s3: IFileDownload = { url: SIGNED, viaApi: false };
const stream: IFileDownload = { url: 'files/stream/a-token', viaApi: true };

const json = (body: unknown): ArrayBuffer => new TextEncoder().encode(JSON.stringify(body)).buffer as ArrayBuffer;

describe('FileBytesService (ACC-189)', () => {
  let service: FileBytesService;
  let http: HttpClient;
  let httpMock: HttpTestingController;
  // The host's mint: the ORDINARY client, which the interceptor makes credentialed.
  const access = () => http.get<IFileDownload>(MINT_URL);

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // The REAL interceptor: it clones every request with withCredentials.
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate'), url: '/my-tasks' } },
        { provide: AuthService, useValue: { clearSession: jasmine.createSpy('clearSession') } },
      ],
    });
    service = TestBed.inject(FileBytesService);
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function collect(): { events: FileBytesEvent[]; error: unknown } {
    const result: { events: FileBytesEvent[]; error: unknown } = { events: [], error: null };
    service.load(FILE, access).subscribe({ next: (e) => result.events.push(e), error: (e: unknown) => (result.error = e) });
    return result;
  }

  it('fetches from storage WITHOUT credentials, while the mint itself is credentialed', () => {
    const result = collect();

    const mint = httpMock.expectOne(MINT_URL);
    // Non-vacuity guard first: the interceptor IS installed, and does make a
    // request credentialed. Without this, "false" below could mean "nothing ran".
    expect(mint.request.withCredentials).toBeTrue();
    mint.flush(s3);

    const fetch = httpMock.expectOne(SIGNED);
    // A browser rejects Supabase's `Access-Control-Allow-Origin: *` for a
    // credentialed request. Switching the fetch to the intercepted client
    // turns this red (mutation-tested).
    expect(fetch.request.withCredentials).toBeFalse();
    expect(fetch.request.method).toBe('GET');
    expect(fetch.request.responseType).toBe('arraybuffer');
    fetch.flush(new ArrayBuffer(9));

    expect(result.error).toBeNull();
    expect(result.events.at(-1)).toEqual({ type: 'loaded', bytes: jasmine.any(ArrayBuffer) });
  });

  it('a stream URL (local folder, SharePoint) resolves against the API base, also without credentials', () => {
    collect();
    httpMock.expectOne(MINT_URL).flush(stream);
    const fetch = httpMock.expectOne(`${environment.apiUrl}/files/stream/a-token`);
    expect(fetch.request.withCredentials).toBeFalse();
    fetch.flush(new ArrayBuffer(1));
  });

  it('reports progress before the bytes', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush(s3);
    const fetch = httpMock.expectOne(SIGNED);
    fetch.event({ type: HttpEventType.DownloadProgress, loaded: 4, total: 9 });
    fetch.flush(new ArrayBuffer(9));
    expect(result.events[0]).toEqual({ type: 'progress', loaded: 4, total: 9 });
    expect(result.events.at(-1)!.type).toBe('loaded');
  });

  describe('a refused mint becomes its own state', () => {
    const cases: [string, { status: number; body: object }, string][] = [
      ['the host\'s identical 404', { status: 404, body: { message: 'Evidence not found' } }, 'deleted'],
      ['FILE_UNAVAILABLE', { status: 409, body: { code: 'FILE_UNAVAILABLE' } }, 'deleted'],
      ['STORAGE_ACCESS_WITHDRAWN', { status: 409, body: { code: 'STORAGE_ACCESS_WITHDRAWN' } }, 'withdrawn'],
      ['PREVIEW_NOT_AVAILABLE', { status: 409, body: { code: 'PREVIEW_NOT_AVAILABLE' } }, 'noPreview'],
      ['anything else', { status: 500, body: { message: 'boom' } }, 'failed'],
    ];
    for (const [label, refusal, problem] of cases) {
      it(`${label} → ${problem}, and storage is never fetched`, () => {
        const result = collect();
        httpMock.expectOne(MINT_URL).flush(refusal.body, { status: refusal.status, statusText: 'x' });
        expect(result.error).toEqual(jasmine.any(FileViewError));
        expect((result.error as FileViewError).problem).toBe(problem as FileViewError['problem']);
      });
    }
  });

  it('storage refusing the browser (status 0) on a cross-origin URL is "storageBlocked" (D3)', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush({ url: 'https://minio.customer.example/b/k?sig', viaApi: false });
    httpMock.expectOne('https://minio.customer.example/b/k?sig').error(new ProgressEvent('error'), { status: 0 });
    expect((result.error as FileViewError).problem).toBe('storageBlocked');
  });

  it('a network failure on our own API is "failed", not a storage CORS problem', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush(stream);
    httpMock.expectOne(`${environment.apiUrl}/files/stream/a-token`).error(new ProgressEvent('error'), { status: 0 });
    expect((result.error as FileViewError).problem).toBe('failed');
  });

  it('a SharePoint withdrawal met while streaming is read from the byte body', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush(stream);
    httpMock
      .expectOne(`${environment.apiUrl}/files/stream/a-token`)
      .flush(json({ statusCode: 409, code: 'STORAGE_ACCESS_WITHDRAWN' }), { status: 409, statusText: 'Conflict' });
    expect((result.error as FileViewError).problem).toBe('withdrawn');
  });

  it('an expired link is minted again ONCE, then succeeds', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush(s3);
    httpMock.expectOne(SIGNED).flush(new ArrayBuffer(0), { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne(MINT_URL).flush(s3);
    httpMock.expectOne(SIGNED).flush(new ArrayBuffer(9));
    expect(result.error).toBeNull();
    expect(result.events.at(-1)!.type).toBe('loaded');
  });

  it('an expired link that fails again is "failed", with no third mint', () => {
    const result = collect();
    httpMock.expectOne(MINT_URL).flush(s3);
    httpMock.expectOne(SIGNED).flush(new ArrayBuffer(0), { status: 403, statusText: 'Forbidden' });
    httpMock.expectOne(MINT_URL).flush(s3);
    httpMock.expectOne(SIGNED).flush(new ArrayBuffer(0), { status: 403, statusText: 'Forbidden' });
    expect((result.error as FileViewError).problem).toBe('failed');
    httpMock.expectNone(MINT_URL);
  });

  it('unsubscribing aborts the storage fetch in flight', () => {
    const subscription = service.load(FILE, access).subscribe();
    httpMock.expectOne(MINT_URL).flush(s3);
    const fetch = httpMock.expectOne(SIGNED);
    subscription.unsubscribe();
    expect(fetch.cancelled).toBeTrue();
  });
});
