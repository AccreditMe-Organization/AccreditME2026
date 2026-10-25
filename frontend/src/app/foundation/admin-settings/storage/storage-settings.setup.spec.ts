import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { AuthService } from '../../../core/services/auth.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { IStorageSettings, StorageTestStep } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { StorageLocationComponent } from './storage-location.component';
import { By } from '@angular/platform-browser';
import {
  HESSA,
  TODAY,
  TYPED_ACCESS_KEY,
  TYPED_SECRET,
  cloud,
  localConfirmed,
  minio,
  requested,
  testFailed,
  testPassed,
  unconfirmed,
  unconfirmedOnPrem,
} from './storage-fixtures';

// ACC-260, PR B — first-time setup, Request a change and replacing the MinIO
// keys, through the page, against the design's states (L613–694): 1–10, 15–19
// and 23. Every write is answered here; nothing reaches a server.

const URL = `${environment.apiUrl}/tenant/storage`;
const LIMITS_URL = `${environment.apiUrl}/files/upload-limits`;
const LIMITS = { maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf'] };
const ENDPOINT = 'https://minio.alnakheel.local:9000';

describe('StorageSettings — first-time setup and Request a change (ACC-260, PR B)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<StorageSettingsComponent>;
  let http: HttpTestingController;

  async function open(settings: IStorageSettings, lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [StorageSettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: AuthService, useValue: { currentUser: () => ({ id: HESSA.id, email: 'hessa@x.test', name: HESSA.name }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StorageSettingsComponent);
    fixture.componentInstance.today.set(TODAY);
    fixture.detectChanges();
    http.expectOne(LIMITS_URL).flush(LIMITS);
    http.expectOne(URL).flush(settings);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
    }
    fixture.detectChanges();
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (sel: string, root: ParentNode = el()) => root.querySelector<HTMLElement>(sel);
  const text = (sel: string, root: ParentNode = el()) => q(sel, root)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  /** A p-button's native button. */
  const btn = (testId: string, root: ParentNode = el()) => q(`[data-testid="${testId}"] button`, root) as HTMLButtonElement | null;
  async function click(testId: string, root: ParentNode = el()): Promise<void> {
    btn(testId, root)!.click();
    await settle();
  }
  async function type(selector: string, value: string): Promise<void> {
    const input = q(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }
  async function choose(kind: string): Promise<void> {
    (q(`[data-testid="choose-${kind}"]`) as HTMLInputElement).click();
    await settle();
  }
  async function fillMinio(): Promise<void> {
    await choose('MINIO');
    await type('#storage-minio-endpoint', ENDPOINT);
    await type('#storage-minio-bucket', 'accreditme-files');
    await type('#storage-minio-access', TYPED_ACCESS_KEY);
    await type('#storage-minio-secret', TYPED_SECRET);
  }
  function expectTest(): TestRequest {
    return http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/test`);
  }
  async function runTest(answer: object): Promise<TestRequest> {
    await click('test-run');
    const req = expectTest();
    req.flush(answer);
    await settle();
    return req;
  }
  const steps = () => Array.from(el().querySelectorAll('[data-step]')).map((s) => `${s.getAttribute('data-step')}:${s.getAttribute('data-state')}`);
  const dialog = () => document.body.querySelector<HTMLElement>('.p-dialog')!;

  // ── states 1–10: before confirming ─────────────────────────────────────────

  it('1 · first visit, AccreditMe cloud selected: "Nothing to set up", Confirm open, no test, no fields', async () => {
    await open(unconfirmed());
    expect((q('[data-testid="choose-S3"]') as HTMLInputElement).checked).toBeTrue();
    expect(text('[data-testid="cloud-setup"]')).toContain('Nothing to set up');
    expect(q('[data-testid="test-box"]')).toBeNull();
    expect(q('input[type="text"], input[type="password"]')).toBeNull();
    expect(text('[data-testid="save-why"]')).toBe('Uploads are blocked until a location is confirmed');
    expect(btn('confirm-open')!.textContent!.trim()).toBe('Confirm AccreditMe cloud…');
    expect(btn('confirm-open')!.disabled).toBeFalse();
  });

  it('1 · rule 1: choosing AccreditMe cloud shows no region, bucket or endpoint, whatever GET holds', async () => {
    const s = unconfirmed();
    s.minio = { endpoint: 'https://s3.eu-central-1.amazonaws.com', region: 'eu-central-1', bucket: 'accreditme-files-prod', accessKeyId: null, secretAccessKey: null };
    await open(s);
    await click('confirm-open');
    const page = el().textContent! + dialog().textContent!;
    for (const leak of ['eu-central-1', 'accreditme-files-prod', 'amazonaws']) expect(page).withContext(leak).not.toContain(leak);
    expect(text('[data-testid="confirm-location"]', dialog())).toBe('AccreditMe cloud');
  });

  it('2 · MinIO being set up: the fields, "Not tested yet", Confirm closed until a test', async () => {
    await open(unconfirmed());
    await choose('MINIO');
    for (const id of ['storage-minio-endpoint', 'storage-minio-bucket', 'storage-minio-region', 'storage-minio-access', 'storage-minio-secret']) {
      expect(q(`#${id}`)).withContext(id).not.toBeNull();
    }
    expect((q('#storage-minio-endpoint') as HTMLInputElement).dir).toBe('ltr');
    expect((q('#storage-minio-access') as HTMLInputElement).type).toBe('password');
    expect((q('#storage-minio-secret') as HTMLInputElement).type).toBe('password');
    // No "Use HTTPS" control (G9): the scheme is in the URL, and the hint says what http means.
    expect(el().textContent).not.toContain('Use HTTPS');
    expect(text('[data-setup="MINIO"]')).toContain('http:// sends files unencrypted between the servers');
    expect(text('[data-testid="test-head"]')).toBe('Not tested yet');
    expect(text('[data-testid="save-why"]')).toBe('Test the connection first');
    expect(btn('confirm-open')!.disabled).toBeTrue();
  });

  it('2 · Test with empty fields asks for them, and sends nothing', async () => {
    await open(unconfirmed());
    await choose('MINIO');
    await click('test-run');
    expect(text('[data-setup="MINIO"]')).toContain('This field is required.');
    expect(text('[data-setup="MINIO"]')).toContain('Enter the secret key.');
    // http.verify() in afterEach: no test request was made.
  });

  it('3 · test running: "Testing the connection…", the button busy, Confirm waiting', async () => {
    await open(unconfirmed());
    await fillMinio();
    await click('test-run');
    const req = expectTest();
    expect(text('[data-testid="test-head"]')).toBe('Testing the connection…');
    expect(btn('test-run')!.disabled).toBeTrue();
    expect(steps()).toEqual(['configure:wait', 'write:wait', 'read:wait', 'verify:wait', 'delete:wait']);
    expect(text('[data-testid="save-why"]')).toBe('Waiting for the test');
    req.flush(testPassed());
    await settle();
  });

  it('4 · passed: every step ✓, the time, Confirm open "Tested with exactly these values"', async () => {
    await open(unconfirmed());
    await fillMinio();
    await runTest(testPassed());
    expect(text('[data-testid="test-head"]')).toMatch(/^✓ Connection works · tested \d\d:\d\d$/);
    expect(steps()).toEqual(['configure:done', 'write:done', 'read:done', 'verify:done', 'delete:done']);
    expect(text('[data-testid="save-why"]')).toBe('Tested with exactly these values');
    expect(btn('confirm-open')!.disabled).toBeFalse();
  });

  const fails: [string, StorageTestStep, string][] = [
    ['5 · failed at write', 'write', "AccreditMe couldn't write to the bucket."],
    ['6 · failed at read', 'read', "The file was written but couldn't be read back."],
    ['7 · failed at delete', 'delete', "The test file couldn't be deleted."],
    ['· failed at verify', 'verify', "The file read back wasn't the file written."],
    ['· failed at configure', 'configure', "AccreditMe couldn't connect with these settings."],
  ];
  for (const [name, step, sentence] of fails) {
    it(`${name}: the step ✕ with its sentence, later steps skipped, never the server's message, Confirm closed`, async () => {
      await open(unconfirmed());
      await fillMinio();
      await runTest(testFailed(step));
      const i = ['configure', 'write', 'read', 'verify', 'delete'].indexOf(step);
      expect(steps()).toEqual(['configure', 'write', 'read', 'verify', 'delete'].map((s, j) => `${s}:${j < i ? 'done' : j === i ? 'fail' : 'skip'}`));
      expect(text('[data-testid="test-detail"]')).toContain(sentence);
      expect(el().textContent).not.toContain('minio-internal.secret.lan');
      expect(text('[data-testid="save-why"]')).toBe('Fix the problem and test again');
      expect(btn('confirm-open')!.disabled).toBeTrue();
    });
  }

  for (const code of ['STORAGE_SETTINGS_INCOMPLETE', 'STORAGE_ENDPOINT_NOT_ALLOWED', 'STORAGE_PROVIDER_NOT_ALLOWED']) {
    it(`a test refused at configure with ${code}: its shared words`, async () => {
      await open(unconfirmed());
      await fillMinio();
      await runTest(testFailed('configure', code));
      expect(text('[data-testid="test-detail"]')).toBe((en.files.refusal as Record<string, string>)[code]!);
    });
  }

  it("a test that couldn't run at all: says so, and Confirm stays closed", async () => {
    await open(unconfirmed());
    await fillMinio();
    await click('test-run');
    expectTest().flush(null, { status: 502, statusText: 'x' });
    await settle();
    expect(text('[data-testid="test-head"]')).toBe("Couldn't run the test. Check your connection and try again.");
    expect(btn('confirm-open')!.disabled).toBeTrue();
  });

  it('8 · edited after a pass: "Test out of date", "Settings changed since the test · test again", Confirm closed', async () => {
    await open(unconfirmed());
    await fillMinio();
    await runTest(testPassed());
    await type('#storage-minio-bucket', 'accreditme-evidence');
    expect(text('[data-testid="test-head"]')).toBe('Test out of date · the settings changed after it ran');
    expect(text('[data-testid="save-why"]')).toBe('Settings changed since the test · test again');
    expect(btn('confirm-open')!.disabled).toBeTrue();
    // Putting the value back makes the pass count again: a pass never expires with time.
    await type('#storage-minio-bucket', 'accreditme-files');
    expect(btn('confirm-open')!.disabled).toBeFalse();
  });

  it('9 · local folder on an on-premises installation: the path relative to the storage folder, tested, then Confirm', async () => {
    await open(unconfirmedOnPrem());
    await choose('LOCAL_FILESYSTEM');
    expect(text('[data-setup="LOCAL_FILESYSTEM"]')).toContain('Relative to the storage folder AccreditMe was installed with');
    await type('#storage-local-path', 'quality/files');
    const req = await runTest(testPassed('LOCAL_FILESYSTEM'));
    expect(req.request.body).toEqual({ provider: 'LOCAL_FILESYSTEM', local: { rootPath: 'quality/files' } });
    expect(btn('confirm-open')!.textContent!.trim()).toBe('Confirm local folder…');
    expect(btn('confirm-open')!.disabled).toBeFalse();
  });

  it('9 · a UNC path is refused on screen: the API takes a folder inside the storage folder', async () => {
    await open(unconfirmedOnPrem());
    await choose('LOCAL_FILESYSTEM');
    await type('#storage-local-path', '\\\\fileserver01\\AccreditMe\\files');
    await click('test-run');
    expect(text('[data-setup="LOCAL_FILESYSTEM"]')).toContain('A folder inside the storage folder');
  });

  it("10 · local folder on AccreditMe's cloud: listed, disabled, with its reason; it never opens", async () => {
    await open(unconfirmed());
    const radio = q('[data-testid="choose-LOCAL_FILESYSTEM"]') as HTMLInputElement;
    expect(radio.disabled).toBeTrue();
    expect(text('[data-option="LOCAL_FILESYSTEM"]')).toContain('Available on an on-premises installation.');
    radio.click();
    await settle();
    expect(q('[data-setup="LOCAL_FILESYSTEM"]')).toBeNull();
    // SharePoint is listed as PR A shows it, and set up in PR C.
    expect((q('[data-testid="choose-SHAREPOINT"]') as HTMLInputElement).disabled).toBeTrue();
  });

  // ── Confirm ────────────────────────────────────────────────────────────────

  it('Confirm: the dialog as drawn, POST /confirm with the values tested, then GET again and the confirmed state', async () => {
    await open(unconfirmed());
    await fillMinio();
    await runTest(testPassed());
    await click('confirm-open');
    const d = dialog();
    expect(d.textContent).toContain('Confirm MinIO?');
    expect(d.textContent).toContain('File storage · first-time setup');
    expect(d.textContent).toContain('Uploads open for everyone as soon as you confirm. After this, only AccreditMe can change where files are stored.');
    expect(text('[data-testid="confirm-location"]', d)).toBe(ENDPOINT);
    expect(q('[data-testid="confirm-location"]', d)!.getAttribute('dir')).toBe('ltr');
    expect(text('[data-testid="confirm-by"]', d)).toBe(HESSA.name);
    await click('confirm-send', d);
    const req = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/confirm`);
    expect(req.request.body).toEqual({
      provider: 'MINIO',
      minio: { endpoint: ENDPOINT, bucket: 'accreditme-files', accessKeyId: TYPED_ACCESS_KEY, secretAccessKey: TYPED_SECRET },
    });
    req.flush(minio());
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === URL).flush(minio());
    await settle();
    expect(text('[data-testid="strip-chip"]')).toBe('✓ Confirmed');
    // Rule 2: the form itself is emptied, not only hidden.
    const card = fixture.debugElement.query(By.directive(StorageLocationComponent)).componentInstance as StorageLocationComponent;
    expect(card.minioForm.getRawValue()).toEqual({ endpoint: '', bucket: '', region: '', accessKeyId: '', secretAccessKey: '' });
    // Rule 2: nothing typed is left anywhere on the page.
    expect(document.body.textContent).not.toContain(TYPED_SECRET);
    const values = Array.from(document.body.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value);
    expect(values).not.toContain(TYPED_SECRET);
    expect(values).not.toContain(TYPED_ACCESS_KEY);
  });

  it('Confirm AccreditMe cloud sends the provider only', async () => {
    await open(unconfirmed());
    await click('confirm-open');
    expect(dialog().textContent).toContain('Confirm AccreditMe cloud?');
    await click('confirm-send', dialog());
    const req = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/confirm`);
    expect(req.request.body).toEqual({ provider: 'S3' });
    req.flush(cloud());
    await settle();
    http.expectOne(URL).flush(cloud());
    await settle();
  });

  const refusals: [string, Record<string, unknown>, string][] = [
    ['STORAGE_ALREADY_CONFIRMED', {}, 'Where files are stored has already been confirmed.'],
    ['STORAGE_SETTINGS_INCOMPLETE', {}, 'Fill in every setting this storage option needs.'],
    ['STORAGE_PROVIDER_NOT_ALLOWED', {}, "This storage option isn't available on this installation."],
    ['STORAGE_ENDPOINT_NOT_ALLOWED', {}, 'The storage address must be a public HTTPS address.'],
    ['STORAGE_TEST_FAILED', { failedStep: 'write', cause: 'STORAGE_UNAVAILABLE' }, "The storage connection test did not pass. AccreditMe couldn't write to the bucket."],
  ];
  for (const [code, extra, words] of refusals) {
    it(`Confirm refused ${code}: its words, "nothing changed", and the values stay`, async () => {
      await open(unconfirmed());
      await fillMinio();
      await runTest(testPassed());
      await click('confirm-open');
      await click('confirm-send', dialog());
      http
        .expectOne((r) => r.method === 'POST' && r.url === `${URL}/confirm`)
        .flush({ statusCode: 400, code, message: 'server English that must not show', ...extra }, { status: code === 'STORAGE_ALREADY_CONFIRMED' ? 409 : 400, statusText: 'x' });
      await settle();
      const said = text('[data-testid="confirm-error"]', dialog())!;
      expect(said).toContain(words);
      expect(said).toContain('Nothing changed. Uploads are still blocked.');
      expect(said).not.toContain('server English');
      expect((q('#storage-minio-bucket') as HTMLInputElement).value).toBe('accreditme-files');
      if (code === 'STORAGE_ALREADY_CONFIRMED') {
        // Someone confirmed first: closing reads the page again.
        Array.from(dialog().querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent!.trim() === 'Cancel')!.click();
        fixture.detectChanges();
        http.expectOne(URL).flush(minio());
        await settle();
      }
    });
  }

  it("Confirm refused with a code the screen doesn't know: its own sentence, never the server's", async () => {
    await open(unconfirmed());
    await click('confirm-open');
    await click('confirm-send', dialog());
    http.expectOne((r) => r.url === `${URL}/confirm`).flush({ code: 'SOMETHING_NEW', message: 'server English that must not show' }, { status: 500, statusText: 'x' });
    await settle();
    const said = text('[data-testid="confirm-error"]', dialog())!;
    expect(said).toContain("Couldn't confirm the location.");
    expect(said).not.toContain('server English');
  });

  // ── states 15–19 and 23: after confirming ──────────────────────────────────

  it('15 · confirmed AccreditMe cloud: managed by AccreditMe, Request a change on the strip, no save bar', async () => {
    await open(cloud());
    expect(text('[data-testid="cloud-managed"]')).toContain('Managed by AccreditMe');
    expect(btn('request-open')!.textContent!.trim()).toBe('Request a change…');
    expect(q('[data-testid="save-bar"]')).toBeNull();
    expect(q('[data-testid="storage-location"] header')!.textContent).toContain('Fixed for your organisation · to move, request a change');
  });

  it('16 · confirmed MinIO: where files are locked, both keys "set" with Replace, never their value', async () => {
    await open(minio());
    expect(Array.from(el().querySelectorAll('[data-field]')).map((f) => f.getAttribute('data-field'))).toEqual(['endpoint', 'bucket', 'regionHttps', 'accessKey', 'secretKey']);
    expect(q('[data-field="accessKey"] [data-secret-state="set"]')).not.toBeNull();
    expect(q('[data-field="secretKey"] [data-secret-state="set"]')).not.toBeNull();
    expect(q('[data-testid="save-bar"]')).toBeNull();
  });

  it('17 · Replace on either key opens BOTH; Save new key closed until a test', async () => {
    await open(minio());
    q('[data-field="secretKey"] p-button button')!.click();
    await settle();
    expect((q('#storage-keys-access') as HTMLInputElement).type).toBe('password');
    expect((q('#storage-keys-secret') as HTMLInputElement).type).toBe('password');
    expect(text('[data-field="accessKey"]')).toContain('New key for the same endpoint and bucket');
    expect(text('[data-field="secretKey"]')).toContain('The saved key stays in use until you save');
    expect(text('[data-testid="test-head"]')).toBe('Not tested yet');
    expect(btn('keys-save')!.disabled).toBeTrue();
    expect(text('[data-testid="save-why"]')).toBe('Test the connection first');
    // Every other field stays locked.
    expect(q('#storage-minio-endpoint')).toBeNull();
    // Cancel restores "set".
    await click('keys-cancel');
    expect(q('[data-field="accessKey"] [data-secret-state="set"]')).not.toBeNull();
  });

  it('18 · new key passed: Save new key sends PATCH with the two keys only, then nothing typed is left', async () => {
    await open(minio());
    q('[data-field="accessKey"] p-button button')!.click();
    await settle();
    await type('#storage-keys-access', 'AKAM-QUALITY-02');
    await type('#storage-keys-secret', TYPED_SECRET);
    const test = await runTest(testPassed());
    expect(test.request.body).toEqual({ provider: 'MINIO', minio: { accessKeyId: 'AKAM-QUALITY-02', secretAccessKey: TYPED_SECRET } });
    expect(text('[data-testid="test-head"]')).toMatch(/^✓ New key works · tested \d\d:\d\d$/);
    expect(text('[data-testid="save-why"]')).toBe('Tested with the new key, same endpoint and bucket');
    await click('keys-save');
    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url === URL);
    expect(patch.request.body).toEqual({ provider: 'MINIO', minio: { accessKeyId: 'AKAM-QUALITY-02', secretAccessKey: TYPED_SECRET } });
    patch.flush(minio());
    await settle();
    http.expectOne(URL).flush(minio());
    await settle();
    expect(q('[data-field="secretKey"] [data-secret-state="set"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain(TYPED_SECRET);
    expect(Array.from(document.body.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value)).not.toContain(TYPED_SECRET);
  });

  it('18 · Save new key refused: its words, never the server\'s, and the saved key still in use', async () => {
    await open(minio());
    q('[data-field="accessKey"] p-button button')!.click();
    await settle();
    await type('#storage-keys-access', 'AKAM-QUALITY-02');
    await type('#storage-keys-secret', TYPED_SECRET);
    await runTest(testPassed());
    await click('keys-save');
    http
      .expectOne((r) => r.method === 'PATCH')
      .flush({ code: 'STORAGE_CHANGE_BY_PLATFORM', message: 'server English' }, { status: 403, statusText: 'x' });
    await settle();
    expect(text('[data-testid="keys-error"]')).toBe('Changing where files are stored is done by AccreditMe. Contact support.');
  });

  it('19 · confirmed local folder: the folder locked, no keys, Request a change', async () => {
    await open(localConfirmed());
    expect(text('[data-field="folderPath"] [data-testid="field-value"]')).toBe('quality/files');
    expect(q('[data-testid="minio-keys"]')).toBeNull();
    expect(btn('request-open')).not.toBeNull();
  });

  it('23 · change requested: the line, and Request a change is absent (one open request at a time)', async () => {
    await open(requested());
    expect(text('[data-testid="strip-request"]')).toBe('Change requested 7 Oct 2026 by Hessa Al-Dosari · AccreditMe will contact you');
    expect(q('[data-testid="request-open"]')).toBeNull();
  });

  // ── Request a change ───────────────────────────────────────────────────────

  it('Request a change: the dialog as drawn; Send with no note sends {}; then the line takes the button\'s place', async () => {
    await open(minio());
    await click('request-open');
    const d = dialog();
    expect(d.textContent).toContain('Request a change of storage');
    expect(d.textContent).toContain('Current: MinIO on your own servers');
    expect(d.textContent).toContain('AccreditMe will contact you to agree the details. Nothing changes until then.');
    expect(text('[data-testid="request-by"]', d)).toBe(HESSA.name);
    expect(d.textContent).toContain("AccreditMe's platform team");
    expect(d.textContent).toContain('0 / 1000');
    await click('request-send', d);
    const req = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/change-request`);
    expect(req.request.body).toEqual({});
    req.flush(requested());
    await settle();
    http.expectOne(URL).flush(requested());
    await settle();
    expect(q('[data-testid="request-open"]')).toBeNull();
    expect(text('[data-testid="strip-request"]')).toContain('Change requested');
  });

  it('Request a change: a note is sent trimmed, at most 1,000 characters', async () => {
    await open(cloud());
    await click('request-open');
    const area = q('[data-testid="request-message"]', dialog()) as HTMLTextAreaElement;
    expect(area.maxLength).toBe(1000);
    area.value = "  We're moving to SharePoint next quarter.  ";
    area.dispatchEvent(new Event('input'));
    await settle();
    await click('request-send', dialog());
    const req = http.expectOne((r) => r.url === `${URL}/change-request`);
    expect(req.request.body).toEqual({ message: "We're moving to SharePoint next quarter." });
    req.flush(requested());
    await settle();
    http.expectOne(URL).flush(requested());
    await settle();
  });

  it('Request a change refused: its words, never the server\'s', async () => {
    await open(minio());
    await click('request-open');
    await click('request-send', dialog());
    http.expectOne((r) => r.url === `${URL}/change-request`).flush({ code: 'STORAGE_NOT_CONFIRMED', message: 'server English' }, { status: 409, statusText: 'x' });
    await settle();
    expect(text('[data-testid="request-error"]', dialog())).toBe("File storage isn't set up yet. Ask your administrator.");
  });

  // ── secrets (rule 2) ───────────────────────────────────────────────────────

  it('a draft with stored keys: they read "set", and Test and Confirm omit them unless typed', async () => {
    await open(unconfirmed({ draftProvider: 'MINIO', minio: { endpoint: ENDPOINT, region: null, bucket: 'accreditme-files', accessKeyId: 'set', secretAccessKey: 'set' } }));
    expect((q('[data-testid="choose-MINIO"]') as HTMLInputElement).checked).toBeTrue();
    expect((q('#storage-minio-endpoint') as HTMLInputElement).value).toBe(ENDPOINT);
    expect(el().querySelectorAll('[data-setup="MINIO"] [data-secret-state="set"]').length).toBe(2);
    const test = await runTest(testPassed());
    expect(test.request.body).toEqual({ provider: 'MINIO', minio: { endpoint: ENDPOINT, bucket: 'accreditme-files' } });
    expect(JSON.stringify(test.request.body)).not.toContain('null');
    await click('confirm-open');
    await click('confirm-send', dialog());
    const confirm = http.expectOne((r) => r.url === `${URL}/confirm`);
    expect(confirm.request.body).toEqual({ provider: 'MINIO', minio: { endpoint: ENDPOINT, bucket: 'accreditme-files' } });
    confirm.flush(minio());
    await settle();
    http.expectOne(URL).flush(minio());
    await settle();
  });

  it('reads in Arabic', async () => {
    await open(unconfirmed(), 'ar');
    expect(text('[data-testid="cloud-setup"]')).toContain('لا يلزم أي إعداد');
    expect(btn('confirm-open')!.textContent!.trim()).toBe('تأكيد سحابة AccreditMe…');
    await choose('MINIO');
    expect(text('[data-testid="test-head"]')).toBe('لم يُختبر بعد');
    expect((q('#storage-minio-endpoint') as HTMLInputElement).dir).toBe('ltr');
  });
});
