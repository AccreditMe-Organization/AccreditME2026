import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { environment } from '../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { AuthService } from '../../../core/services/auth.service';
import { AmConfirmOptions, AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { InlineCalendarComponent } from '../../../shared/components/inline-calendar/inline-calendar.component';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { IStorageSettings, SharePointAccessLostReason } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { SHAREPOINT_CODES } from './storage-setup';
import {
  HESSA,
  SP_CLIENT_ID,
  SP_LIBRARY,
  SP_SITE_NAME,
  SP_SITE_URL,
  SP_TENANT,
  TODAY,
  TYPED_SP_SECRET,
  cloud,
  localConfirmed,
  minio,
  sharepoint,
  sharepointDraft,
  spTestFailed,
  spTestPassed,
  unconfirmed,
} from './storage-fixtures';

// ACC-260, PR C — SharePoint through the page (Ahmad's D1, D2, D3, D5, D12):
// setup with the six fields, the test's seven rows and a sentence per code,
// Confirm, and once confirmed Replace secret, Change client ID, a new expiry
// date, the withdrawn banner, the 30-day line and Disconnect. Every write is
// answered here; nothing reaches a server, and no value is a real Microsoft one.

const URL = `${environment.apiUrl}/tenant/storage`;
const LIMITS_URL = `${environment.apiUrl}/files/upload-limits`;
const LIMITS = { maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf'] };
const NEW_CLIENT_ID = '00000000-0000-4000-8000-0000000000c2';

describe('StorageSettings — SharePoint (ACC-260, PR C)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<StorageSettingsComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];

  async function open(settings: IStorageSettings, lang: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    asked = [];
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
        // The confirm helper is the one way to ask (check:confirm-through-helper);
        // here it records what it was asked, and the test accepts.
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
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
  async function fillSharePoint(over: Partial<Record<'tenant' | 'client' | 'secret' | 'site' | 'library', string>> = {}): Promise<void> {
    (q('[data-testid="choose-SHAREPOINT"]') as HTMLInputElement).click();
    await settle();
    await type('#storage-sp-tenant', over.tenant ?? SP_TENANT);
    await type('#storage-sp-client', over.client ?? SP_CLIENT_ID);
    await type('#storage-sp-secret', over.secret ?? TYPED_SP_SECRET);
    await type('#storage-sp-site', over.site ?? SP_SITE_URL);
    await type('#storage-sp-library', over.library ?? SP_LIBRARY);
  }
  const isTest = (r: { method: string; url: string }) => r.method === 'POST' && r.url === `${URL}/test`;
  async function runTest(answer: object | 'timeout'): Promise<TestRequest> {
    await click('test-run');
    const req = http.expectOne(isTest);
    if (answer === 'timeout') req.flush(null, { status: 504, statusText: 'Gateway Timeout' });
    else req.flush(answer);
    await settle();
    return req;
  }
  const rows = () => Array.from(el().querySelectorAll('[data-step]')).map((s) => `${s.getAttribute('data-step')}:${s.getAttribute('data-state')}`);
  const dialog = () => document.body.querySelector<HTMLElement>('.p-dialog')!;
  /** Sets the expiry field by picking a day on its calendar, as a person does. */
  async function pickExpiry(year: number, month: number, day: number): Promise<void> {
    await click('expiry-toggle');
    const cal = fixture.debugElement.query(By.directive(InlineCalendarComponent));
    expect(cal).withContext('the calendar opened').not.toBeNull();
    cal.triggerEventHandler('valueChange', new Date(year, month - 1, day));
    await settle();
  }

  // ── before Confirm (D1, D12) ───────────────────────────────────────────────

  it('SharePoint can be chosen: the six fields, the sentence about the Microsoft admin, and no guide link yet (D12)', async () => {
    await open(unconfirmed());
    await fillSharePoint();
    expect(q('[data-setup="SHAREPOINT"]')).not.toBeNull();
    expect(text('[data-testid="sp-prepare"]')).toBe(
      "Before you start, your organisation's Microsoft administrator registers an app with access to the site, and gives you the values below.",
    );
    expect(q('[data-setup="SHAREPOINT"] a')).withContext('no link until the guide is published').toBeNull();
    for (const id of ['storage-sp-tenant', 'storage-sp-client', 'storage-sp-secret', 'storage-sp-site', 'storage-sp-library', 'storage-sp-expiry']) {
      expect(q(`#${id}`)).withContext(id).not.toBeNull();
    }
    // GUIDs and addresses read left to right in both languages (rule 6).
    for (const id of ['storage-sp-tenant', 'storage-sp-client', 'storage-sp-secret', 'storage-sp-site']) {
      expect(q(`#${id}`)!.getAttribute('dir')).withContext(id).toBe('ltr');
    }
    expect((q('#storage-sp-secret') as HTMLInputElement).type).toBe('password');
    expect(btn('confirm-open')!.textContent!.trim()).toBe('Confirm SharePoint…');
    expect(text('[data-testid="save-why"]')).toBe('Test the connection first');
  });

  it('Test with invalid fields says what is wrong and sends nothing; the button is never disabled (rule 5.2)', async () => {
    await open(unconfirmed());
    await fillSharePoint({ tenant: 'alnakheel', client: 'not-a-guid', secret: 'short', site: 'http://example-test.sharepoint.com/sites/quality', library: '   ' });
    expect(btn('test-run')!.disabled).toBeFalse();
    await click('test-run');
    http.expectNone(isTest);
    const errors = text('[data-setup="SHAREPOINT"]')!;
    expect(errors).toContain('A tenant ID (five groups of letters and digits, joined by hyphens) or a domain.');
    expect(errors).toContain('The Application (client) ID: five groups of letters and digits, joined by hyphens.');
    expect(errors).toContain('At least 8 characters.');
    expect(errors).toContain("A SharePoint site address: https:// on sharepoint.com, then /sites/ or /teams/ and the site's name.");
    expect(errors).toContain('Enter the library name.');
  });

  it('with no secret stored, the secret is required: Test says so and sends nothing', async () => {
    await open(unconfirmed());
    await fillSharePoint({ secret: '' });
    await click('test-run');
    http.expectNone(isTest);
    expect(text('[data-setup="SHAREPOINT"]')).toContain('Enter the client secret.');
  });

  it('a pass: seven rows done, the "site › library" it reached (left to right), then Confirm records it, with the expiry date', async () => {
    await open(unconfirmed());
    await fillSharePoint();
    await pickExpiry(2027, 6, 30);
    const req = await runTest(spTestPassed());
    expect(req.request.body).toEqual({
      provider: 'SHAREPOINT',
      sharepoint: { tenant: SP_TENANT, clientId: SP_CLIENT_ID, clientSecret: TYPED_SP_SECRET, siteUrl: SP_SITE_URL, libraryName: SP_LIBRARY },
    });
    expect(rows()).toEqual(['configure', 'token', 'site', 'library', 'write', 'read', 'delete'].map((s) => `${s}:done`));
    expect(text('[data-testid="test-found"]')).toBe(`Found: ${SP_SITE_NAME} › ${SP_LIBRARY}`);
    expect(q('[data-testid="test-found-value"]')!.getAttribute('dir')).toBe('ltr');
    expect(text('[data-testid="save-why"]')).toBe('Tested with exactly these values');

    await click('confirm-open');
    expect(dialog().textContent).toContain('Confirm SharePoint?');
    const location = q('[data-testid="confirm-location"]', dialog())!;
    expect(location.textContent!.trim()).toBe(`${SP_SITE_NAME} › ${SP_LIBRARY}`);
    expect(location.getAttribute('dir')).toBe('ltr');

    await click('confirm-send', dialog());
    const confirm = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/confirm`);
    expect(confirm.request.body).toEqual({
      provider: 'SHAREPOINT',
      sharepoint: { tenant: SP_TENANT, clientId: SP_CLIENT_ID, clientSecret: TYPED_SP_SECRET, siteUrl: SP_SITE_URL, libraryName: SP_LIBRARY, secretExpiresOn: '2027-06-30' },
    });
    confirm.flush(sharepoint());
    await settle();
    http.expectOne(URL).flush(sharepoint());
    await settle();
    // Rule 2: the typed secret is nowhere on the page once confirmed.
    expect(el().textContent).not.toContain(TYPED_SP_SECRET);
    expect(Array.from(el().querySelectorAll('input')).some((i) => i.value === TYPED_SP_SECRET)).toBeFalse();
    expect(q('[data-testid="sp-manage"]')).not.toBeNull();
  });

  it('picking an expiry date after a pass does not make the pass stale', async () => {
    await open(unconfirmed());
    await fillSharePoint();
    await runTest(spTestPassed());
    await pickExpiry(2027, 6, 30);
    expect(text('[data-testid="test-head"]')).toContain('Connection works');
    expect(btn('confirm-open')!.disabled).toBeFalse();
  });

  for (const code of SHAREPOINT_CODES) {
    it(`a test refused ${code}: its own sentence under the step, never the server's message`, async () => {
      await open(unconfirmed());
      await fillSharePoint();
      const step = code === 'SHAREPOINT_SITE_URL_INVALID' ? 'configure' : code === 'SHAREPOINT_SITE_NOT_FOUND' ? 'site' : code === 'SHAREPOINT_LIBRARY_NOT_FOUND' ? 'library' : code === 'SHAREPOINT_NO_WRITE_ACCESS' ? 'write' : 'token';
      await runTest(spTestFailed(step, code));
      const detail = text('[data-testid="test-detail"]');
      expect(detail).toBe((en.storage.test.fail.SHAREPOINT as Record<string, string>)[code]!);
      expect(el().textContent).not.toContain('AADSTS');
      expect(btn('confirm-open')!.disabled).toBeTrue();
    });
  }

  it('Microsoft unavailable, and a timeout, each say so', async () => {
    await open(unconfirmed());
    await fillSharePoint();
    await runTest(spTestFailed('site', 'STORAGE_UNAVAILABLE'));
    expect(text('[data-testid="test-detail"]')).toBe("Microsoft didn't answer in time, or answered with an error. This is usually temporary: try again in a few minutes.");
    await runTest('timeout');
    expect(text('[data-testid="test-head"]')).toBe('The test took too long and was stopped. Microsoft may be busy: try again in a few minutes.');
  });

  it('a refused Confirm keeps the values and says what to fix in Microsoft', async () => {
    await open(unconfirmed());
    await fillSharePoint();
    await runTest(spTestPassed());
    await click('confirm-open');
    await click('confirm-send', dialog());
    http
      .expectOne((r) => r.url === `${URL}/confirm`)
      .flush({ code: 'STORAGE_TEST_FAILED', failedStep: 'token', cause: 'SHAREPOINT_SECRET_INVALID' }, { status: 400, statusText: 'x' });
    await settle();
    const error = text('[data-testid="confirm-error"]', dialog())!;
    expect(error).toContain(en.storage.test.fail.SHAREPOINT.SHAREPOINT_SECRET_INVALID);
    expect(error).toContain('Nothing changed. Uploads are still blocked.');
    // A SharePoint code refused at Confirm itself says what to fix, too.
    await click('confirm-send', dialog());
    http.expectOne((r) => r.url === `${URL}/confirm`).flush({ code: 'SHAREPOINT_SITE_URL_INVALID', message: 'Server words' }, { status: 400, statusText: 'x' });
    await settle();
    const said = text('[data-testid="confirm-error"] p', dialog());
    expect(said).toBe(en.storage.test.fail.SHAREPOINT.SHAREPOINT_SITE_URL_INVALID);
    expect(said).not.toContain('Server words');
  });

  it('a SharePoint draft saved through the API is picked up, and its stored secret makes typing one optional', async () => {
    await open(sharepointDraft());
    expect((q('[data-testid="choose-SHAREPOINT"]') as HTMLInputElement).checked).toBeTrue();
    expect((q('#storage-sp-tenant') as HTMLInputElement).value).toBe(SP_TENANT);
    expect(q('[data-setup="SHAREPOINT"] [data-secret-state="set"]')).not.toBeNull();
    const req = await runTest(spTestPassed());
    expect(Object.keys(req.request.body.sharepoint ?? {})).not.toContain('clientSecret');
  });

  // ── after Confirm (D1, D3, D5) ─────────────────────────────────────────────

  it('confirmed: tenant, site and library locked; client ID in clear (LTR); the secret only "set"; the expiry date; Test on demand', async () => {
    await open(sharepoint());
    for (const id of ['spTenant', 'spSiteUrl', 'spLibrary']) {
      expect(q(`[data-field="${id}"] .am-sl__box--locked`)).withContext(id).not.toBeNull();
    }
    expect(q('[data-field="spTenant"] [data-testid="field-value"]')!.getAttribute('dir')).toBe('ltr');
    expect(q('[data-field="spSiteUrl"] [data-testid="field-value"]')!.getAttribute('dir')).toBe('ltr');
    expect(text('[data-testid="sp-client-id"]')).toBe(SP_CLIENT_ID);
    expect(q('[data-testid="sp-client-id"]')!.getAttribute('dir')).toBe('ltr');
    expect(q('[data-field="spClientSecret"] [data-secret-state="set"]')).not.toBeNull();
    expect(q('[data-field="spClientSecret"] input')).toBeNull();
    expect(text('[data-testid="sp-expiry"]')).toBe('30 Jun 2027');
    // The credentials are live controls, each drawn once — never also a
    // locked box beside the tenant, site and library.
    for (const id of ['spClientId', 'spClientSecret', 'spSecretExpires']) {
      expect(el().querySelectorAll(`[data-field="${id}"]`).length).withContext(id).toBe(1);
      expect(q(`[data-field="${id}"] [data-testid="field-value"]`)).withContext(`${id} locked box`).toBeNull();
    }
    expect(text('[data-testid="test-head"]')).toBe('Not tested yet');
  });

  it('Replace secret: Test sends only the new secret, Save opens on a pass, PATCH sends it (and a new date), and it is gone afterwards', async () => {
    await open(sharepoint());
    q('[data-field="spClientSecret"] p-button button')!.click();
    await settle();
    expect(q('[data-testid="sp-manage"]')!.getAttribute('data-edit')).toBe('secret');
    expect(btn('sp-save')!.disabled).toBeTrue();
    expect(text('[data-testid="sp-save-why"]')).toBe('Test the connection first');
    await type('#storage-sp-new-secret', TYPED_SP_SECRET);
    await pickExpiry(2028, 1, 15);
    const test = await runTest(spTestPassed());
    expect(test.request.body).toEqual({ provider: 'SHAREPOINT', sharepoint: { clientSecret: TYPED_SP_SECRET } });
    expect(text('[data-testid="test-head"]')).toContain('New credentials work');
    expect(btn('sp-save')!.disabled).toBeFalse();
    await click('sp-save');
    const patch = http.expectOne((r) => r.method === 'PATCH' && r.url === URL);
    expect(patch.request.body).toEqual({ provider: 'SHAREPOINT', sharepoint: { clientSecret: TYPED_SP_SECRET, secretExpiresOn: '2028-01-15' } });
    patch.flush(sharepoint({ secretExpiresOn: '2028-01-15' }));
    await settle();
    http.expectOne(URL).flush(sharepoint({ secretExpiresOn: '2028-01-15' }));
    await settle();
    expect(q('[data-testid="sp-manage"]')!.getAttribute('data-edit')).toBe('view');
    expect(Array.from(el().querySelectorAll('input')).some((i) => i.value === TYPED_SP_SECRET)).toBeFalse();
    expect(el().textContent).not.toContain(TYPED_SP_SECRET);
  });

  it('Change client ID: both the new ID and its secret, tested, then saved', async () => {
    await open(sharepoint());
    await click('sp-change-client');
    expect((q('#storage-sp-new-client') as HTMLInputElement).value).toBe(SP_CLIENT_ID);
    // The secret belongs to an app, so a new app needs its secret.
    await click('test-run');
    http.expectNone(isTest);
    expect(text('[data-testid="sp-manage"]')).toContain('Enter the client secret.');
    await type('#storage-sp-new-client', NEW_CLIENT_ID);
    await type('#storage-sp-new-secret', TYPED_SP_SECRET);
    const test = await runTest(spTestPassed());
    expect(test.request.body).toEqual({ provider: 'SHAREPOINT', sharepoint: { clientId: NEW_CLIENT_ID, clientSecret: TYPED_SP_SECRET } });
    expect(btn('sp-save')!.textContent!.trim()).toBe('Save new app');
    await click('sp-save');
    http.expectOne((r) => r.method === 'PATCH').flush(sharepoint({ clientId: NEW_CLIENT_ID }));
    await settle();
    http.expectOne(URL).flush(sharepoint({ clientId: NEW_CLIENT_ID }));
    await settle();
    expect(text('[data-testid="sp-client-id"]')).toBe(NEW_CLIENT_ID);
  });

  it('a save refused STORAGE_CHANGE_BY_PLATFORM gets its own sentence; a failed test at save says what to fix', async () => {
    await open(sharepoint());
    q('[data-field="spClientSecret"] p-button button')!.click();
    await settle();
    await type('#storage-sp-new-secret', TYPED_SP_SECRET);
    await runTest(spTestPassed());
    await click('sp-save');
    http.expectOne((r) => r.method === 'PATCH').flush({ code: 'STORAGE_CHANGE_BY_PLATFORM', message: 'Changing where files are stored is done by AccreditMe.' }, { status: 403, statusText: 'x' });
    await settle();
    expect(text('[data-testid="sp-save-error"]')).toBe(
      'These credentials reach a different tenant, site or library from the confirmed one, so nothing was saved. Use an app with access to “Quality Documents”, or ask AccreditMe to move your files.',
    );
    await click('sp-save');
    http.expectOne((r) => r.method === 'PATCH').flush({ code: 'STORAGE_TEST_FAILED', failedStep: 'write', cause: 'SHAREPOINT_NO_WRITE_ACCESS' }, { status: 400, statusText: 'x' });
    await settle();
    expect(text('[data-testid="sp-save-error"]')).toContain(en.storage.test.fail.SHAREPOINT.SHAREPOINT_NO_WRITE_ACCESS);
  });

  it('a new expiry date alone: no test, PATCH sends only the date; an empty date is refused on screen (rule 5.2)', async () => {
    await open(sharepoint());
    await click('sp-change-expiry');
    expect(q('[data-testid="sp-manage"] [data-testid="test-box"]')).toBeNull();
    expect(text('[data-testid="sp-save-why"]')).toBe('No test needed: the date is a reminder only');
    await click('expiry-clear');
    expect(btn('sp-save')!.disabled).toBeFalse();
    await click('sp-save');
    http.expectNone((r) => r.method === 'PATCH');
    expect(text('[data-testid="sp-manage"]')).toContain('Choose a date.');
    await pickExpiry(2028, 1, 15);
    await click('sp-save');
    const patch = http.expectOne((r) => r.method === 'PATCH');
    expect(patch.request.body).toEqual({ provider: 'SHAREPOINT', sharepoint: { secretExpiresOn: '2028-01-15' } });
    http.expectNone(isTest);
    patch.flush(sharepoint({ secretExpiresOn: '2028-01-15' }));
    await settle();
    http.expectOne(URL).flush(sharepoint({ secretExpiresOn: '2028-01-15' }));
    await settle();
  });

  const REASONS: Record<SharePointAccessLostReason, string> = {
    SECRET_INVALID: 'Create a new client secret for the app in Microsoft Entra.',
    CONSENT_REVOKED: 'Ask your Microsoft administrator to restore it.',
    GRANT_REMOVED: 'give it write access to the library again.',
    LIBRARY_GONE: 'Contact AccreditMe to agree where files go next.',
  };
  for (const [reason, fix] of Object.entries(REASONS) as Array<[SharePointAccessLostReason, string]>) {
    it(`access withdrawn (${reason}): the banner says what to fix, and that a passing test ends it`, async () => {
      await open(sharepoint({ accessLostAt: '2026-10-20T08:00:00.000Z', accessLostReason: reason }));
      const banner = text('[data-testid="sp-withdrawn"]')!;
      expect(banner).toContain(fix);
      expect(banner).toContain('Fixed it in Microsoft? Test the connection below: a pass ends this warning at once.');
    });
  }

  it('D5: Test of the stored settings sends no SharePoint value; a pass while withdrawn reads the page again; a fail does not', async () => {
    await open(sharepoint({ accessLostAt: '2026-10-20T08:00:00.000Z', accessLostReason: 'SECRET_INVALID' }));
    const failed = await runTest(spTestFailed('token', 'SHAREPOINT_SECRET_INVALID'));
    expect(failed.request.body).toEqual({ provider: 'SHAREPOINT' });
    http.expectNone(URL);
    await runTest(spTestPassed());
    http.expectOne(URL).flush(sharepoint());
    await settle();
    expect(q('[data-testid="sp-withdrawn"]')).toBeNull();
    expect(text('[data-testid="strip-chip"]')).toBe('✓ Confirmed');
  });

  it('a passing test of a healthy location changes nothing and reads nothing again', async () => {
    await open(sharepoint());
    const req = await runTest(spTestPassed());
    expect(req.request.body).toEqual({ provider: 'SHAREPOINT' });
    expect(text('[data-testid="test-head"]')).toContain('Connection works');
    http.expectNone(URL);
  });

  // ── the 30-day line (D3) ───────────────────────────────────────────────────

  it('the expiry line shows from 30 days before, and not at 31', async () => {
    // TODAY is 24 Oct 2026.
    await open(sharepoint({ secretExpiresOn: '2026-11-23' }));
    expect(text('[data-testid="sp-expiring"]')).toBe('The client secret expires on 23 Nov 2026. Create a new one in Microsoft and replace it here.');
    TestBed.resetTestingModule();
    await open(sharepoint({ secretExpiresOn: '2026-11-24' }));
    expect(q('[data-testid="sp-expiring"]')).toBeNull();
    TestBed.resetTestingModule();
    await open(sharepoint({ secretExpiresOn: '2026-10-24' }));
    expect(text('[data-testid="sp-expiring"]')).toContain('expires on 24 Oct 2026');
    TestBed.resetTestingModule();
    await open(sharepoint({ secretExpiresOn: '2026-10-23' }));
    expect(text('[data-testid="sp-expiring"]')).toContain('expired on 23 Oct 2026');
  });

  // ── Disconnect (D2) ────────────────────────────────────────────────────────

  it('Disconnect is refused before the click while files are stored there, with the count and the reason', async () => {
    await open(sharepoint({ filesStored: 3, disconnectAllowed: false }));
    expect(btn('sp-disconnect')!.disabled).toBeTrue();
    expect(text('[data-testid="sp-disconnect-why"]')).toBe(
      "Can't disconnect: 3 files are stored in SharePoint, counting the recycle bin. AccreditMe moves them first: request a change.",
    );
    btn('sp-disconnect')!.click();
    await settle();
    expect(asked).toEqual([]);
  });

  it('Disconnect with nothing stored: the destructive confirm, then POST /disconnect, then the page again', async () => {
    await open(sharepoint({ filesStored: 0, disconnectAllowed: true }));
    expect(text('[data-testid="sp-disconnect-why"]')).toBe('No files are stored in SharePoint. Disconnecting blocks uploads until a location is confirmed again.');
    await click('sp-disconnect');
    expect(asked.length).toBe(1);
    expect(asked[0]!.tone).toBe('destructive');
    expect(asked[0]!.header).toBe('Disconnect SharePoint?');
    expect(asked[0]!.acceptLabel).toBe('Disconnect');
    http.expectNone((r) => r.url === `${URL}/disconnect`);
    asked[0]!.accept();
    await settle();
    const req = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/disconnect`);
    expect(req.request.body).toEqual({});
    req.flush(unconfirmed());
    await settle();
    http.expectOne(URL).flush(unconfirmed());
    await settle();
    expect(text('[data-testid="strip-chip"]')).toBe('✕ Uploads blocked');
  });

  it('a Disconnect refused STORAGE_LOCKED_BY_FILES says how many, and reads the page again', async () => {
    await open(sharepoint({ filesStored: 0, disconnectAllowed: true }));
    await click('sp-disconnect');
    asked[0]!.accept();
    await settle();
    http.expectOne((r) => r.url === `${URL}/disconnect`).flush({ code: 'STORAGE_LOCKED_BY_FILES', filesStored: 1 }, { status: 409, statusText: 'x' });
    await settle();
    expect(text('[data-testid="sp-disconnect-error"]')).toBe('Nothing changed: 1 file is stored in SharePoint now. AccreditMe moves it first: request a change.');
    http.expectOne(URL).flush(sharepoint({ filesStored: 1, disconnectAllowed: false }));
    await settle();
    expect(btn('sp-disconnect')!.disabled).toBeTrue();
  });

  it('the other locations have no Disconnect', async () => {
    for (const s of [cloud(), minio(), localConfirmed(), unconfirmed()]) {
      await open(s);
      expect(q('[data-testid="sp-disconnect"]')).toBeNull();
      TestBed.resetTestingModule();
    }
    await open(sharepoint());
    expect(q('[data-testid="sp-disconnect"]')).not.toBeNull();
  });

  // ── Arabic ─────────────────────────────────────────────────────────────────

  it('Arabic: the sentences in Arabic, GUIDs, addresses and the site › library left to right', async () => {
    await open(unconfirmed(), 'ar');
    await fillSharePoint();
    await runTest(spTestFailed('token', 'SHAREPOINT_CLIENT_NOT_FOUND'));
    expect(text('[data-testid="test-detail"]')).toBe(ar.storage.test.fail.SHAREPOINT.SHAREPOINT_CLIENT_NOT_FOUND);
    await runTest(spTestPassed());
    expect(text('[data-testid="test-found"]')).toContain(`${SP_SITE_NAME} › ${SP_LIBRARY}`);
    expect(q('[data-testid="test-found-value"]')!.getAttribute('dir')).toBe('ltr');
    expect(q('#storage-sp-client')!.getAttribute('dir')).toBe('ltr');
    // The picked date reads "14 Oct 2026" in an Arabic page too (the app's date inputs).
    await pickExpiry(2027, 6, 30);
    expect((q('#storage-sp-expiry') as HTMLInputElement).value).toBe('30 Jun 2027');
    expect(q('#storage-sp-expiry')!.getAttribute('dir')).toBe('ltr');
    TestBed.resetTestingModule();
    await open(sharepoint({ filesStored: 2, disconnectAllowed: false }), 'ar');
    // The dual form, addressing the reader in the singular as the app does.
    expect(text('[data-testid="sp-disconnect-why"]')).toBe(
      'لا يمكن الفصل: ملفان محفوظان في SharePoint، بما فيها سلة المحذوفات. تنقلهما AccreditMe أولًا: اطلب تغييرًا.',
    );
    expect(text('[data-testid="strip-detail"]')).toContain(`\u2066${SP_SITE_NAME} › ${SP_LIBRARY}\u2069`);
    expect(q('[data-testid="sp-client-id"]')!.getAttribute('dir')).toBe('ltr');
  });
});
