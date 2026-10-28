import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { IStorageSettings } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { TODAY, cloud, local, minio, requested, sharepoint, unconfirmed } from './storage-fixtures';

// ACC-260, PR A — the File storage page in each read state, answered from
// fixtures. Nothing here writes. PR B added the write controls (first-time
// setup, Request a change, Replace on MinIO's keys); each state below names
// exactly the ones it may show, so an unexpected one still fails.

const STORAGE_URL = `${environment.apiUrl}/tenant/storage`;
const LIMITS_URL = `${environment.apiUrl}/files/upload-limits`;
const LIMITS = { maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx', 'png'] };

describe('StorageSettingsComponent (ACC-260, PR A)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<StorageSettingsComponent>;
  let http: HttpTestingController;

  function render(lang: 'en' | 'ar' = 'en'): HTMLElement {
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
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StorageSettingsComponent);
    fixture.componentInstance.today.set(TODAY);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function answer(settings: IStorageSettings, lang: 'en' | 'ar' = 'en', limits: object | 'fail' = LIMITS): HTMLElement {
    const el = render(lang);
    const l = http.expectOne(LIMITS_URL);
    if (limits === 'fail') l.flush(null, { status: 500, statusText: 'x' });
    else l.flush(limits);
    http.expectOne(STORAGE_URL).flush(settings);
    fixture.detectChanges();
    return el;
  }

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  const text = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const field = (el: HTMLElement, id: string) => el.querySelector(`[data-field="${id}"] [data-testid="field-value"]`)?.textContent?.trim() ?? null;
  /** Every control outside the upload-rules card, by what it is: a test id, an input's name, or a button's words. */
  const writes = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('button, a[href], input, select, textarea, [role="radio"], [role="checkbox"]'))
      .filter((n) => !n.closest('[data-testid="rule-types"]'))
      .map((n) => n.closest('[data-testid]')?.getAttribute('data-testid') ?? (n as HTMLInputElement).name ?? n.textContent!.trim());

  it('not confirmed: uploads blocked, the four options listed, nothing open, no write control', () => {
    const el = answer(unconfirmed());
    expect(text(el, 'strip-name')).toBe('Not confirmed yet');
    expect(text(el, 'strip-chip')).toBe('✕ Uploads blocked');
    expect(el.querySelector('[data-testid="storage-strip"]')!.classList).toContain('am-ss__card--danger');
    expect(Array.from(el.querySelectorAll('[data-testid="option-title"]')).map((o) => o.textContent!.trim())).toEqual([
      'AccreditMe cloud',
      'MinIO on your own servers',
      'Local folder or network drive',
      'SharePoint Online',
    ]);
    expect(el.querySelector('[data-option="LOCAL_FILESYSTEM"]')!.textContent).toContain('Available on an on-premises installation.');
    expect(el.querySelector('[data-testid="current-body"]')).toBeNull();
    expect(el.querySelector('[data-testid="option-current"]')).toBeNull();
    // PR B: the four choices and Confirm, nothing else.
    expect(writes(el)).toEqual(['choose-S3', 'choose-MINIO', 'choose-LOCAL_FILESYSTEM', 'choose-SHAREPOINT', 'confirm-open']);
  });

  it('AccreditMe cloud: managed by AccreditMe, confirmed by whom, the Current chip, no fields', () => {
    const el = answer(cloud());
    expect(text(el, 'strip-name')).toBe('AccreditMe cloud');
    expect(text(el, 'strip-detail')).toBe('Managed by AccreditMe · Confirmed 3 Oct 2026 by Hessa Al-Dosari');
    expect(text(el, 'strip-chip')).toBe('✓ Confirmed');
    expect(el.querySelector('[data-option="S3"] [data-testid="option-current"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="cloud-managed"] > :first-child')!.textContent!.trim()).toBe('Managed by AccreditMe');
    expect(el.querySelector('[data-testid="cloud-managed"] > :last-child')!.textContent!.trim()).toBe('Nothing to manage here. Uploads are open.');
    expect(el.querySelector('[data-testid="current-fields"]')).toBeNull();
    expect(writes(el)).toEqual(['request-open']);
  });

  it("rule 1: AccreditMe's own region, bucket or endpoint never reach the page", () => {
    const s = cloud();
    // As if the response carried them: the page must not render any of it for AccreditMe cloud.
    s.minio = { endpoint: 'https://s3.eu-central-1.amazonaws.com', region: 'eu-central-1', bucket: 'accreditme-files-prod', accessKeyId: 'set', secretAccessKey: 'set' };
    const page = answer(s).textContent!;
    for (const leak of ['eu-central-1', 'accreditme-files-prod', 'amazonaws']) expect(page).withContext(leak).not.toContain(leak);
  });

  it('MinIO: host · bucket on the strip; where files are locked; the keys only "set", with Replace', () => {
    const el = answer(minio());
    expect(text(el, 'strip-detail')).toBe('minio.alnakheel.local · accreditme-files · Confirmed 3 Oct 2026 by Hessa Al-Dosari');
    expect(field(el, 'endpoint')).toBe('https://minio.alnakheel.local:9000');
    expect(field(el, 'bucket')).toBe('accreditme-files');
    expect(field(el, 'regionHttps')).toBe('None · On');
    // PR B: the keys are write-once secrets (am-secret-field), replaceable together.
    expect(el.querySelector('[data-field="accessKey"] [data-secret-state="set"]')).not.toBeNull();
    expect(el.querySelector('[data-field="secretKey"] [data-secret-state="set"]')).not.toBeNull();
    expect(el.querySelector('[data-field="endpoint"] [data-testid="field-help"]')!.textContent!.trim()).toBe('Changing where files are stored is done by AccreditMe.');
    expect(el.querySelector('[data-field="bucket"] [data-testid="field-help"]')!.textContent!.trim()).toBe('Locked');
    // Every option but the current one is greyed, and only it is open.
    expect(el.querySelectorAll('[data-testid="current-body"]').length).toBe(1);
    expect(writes(el)).toEqual(['request-open', 'minio-keys', 'minio-keys']);
  });

  it('rule 2 (SharePoint): the client secret shows no value and no input, only that one is set (PR C: the shared secret field)', () => {
    const el = answer(sharepoint());
    expect(el.querySelector('[data-field="spClientSecret"] input')).toBeNull();
    expect(el.querySelector('[data-field="spClientSecret"] [data-secret-set-on]')!.textContent!.trim()).toBe('set');
    // Never a locked box holding the API's marker.
    const values = Array.from(el.querySelectorAll('[data-testid="field-value"]')).map((v) => v.textContent!.trim());
    expect(values).not.toContain('set');
  });

  it('rule 2 (MinIO): the keys show no value and no input, only that one is set', () => {
    const el = answer(minio());
    for (const id of ['accessKey', 'secretKey']) {
      expect(el.querySelector(`[data-field="${id}"] input`)).withContext(id).toBeNull();
      expect(el.querySelector(`[data-field="${id}"] [data-secret-set-on]`)!.textContent!.trim()).withContext(id).toBe('set');
    }
  });

  it('local folder: the folder, locked', () => {
    const el = answer(local());
    expect(text(el, 'strip-name')).toBe('Local folder or network drive');
    expect(field(el, 'folderPath')).toBe('quality/files');
  });

  it('SharePoint, healthy: site › library; tenant, site and library locked; client secret "Set"; the expiry date', () => {
    const el = answer(sharepoint());
    // The site › library is isolated left to right (PR C, U+2066 … U+2069).
    expect(text(el, 'strip-detail')).toBe('\u2066Quality Department › Quality Documents\u2069 · Confirmed 3 Oct 2026 by Hessa Al-Dosari');
    expect(field(el, 'spTenant')).toBe('alnakheel.example.test');
    expect(field(el, 'spLibrary')).toBe('Quality Documents');
    expect(el.querySelector('[data-field="spClientSecret"] [data-secret-state="set"]')).not.toBeNull();
    expect(text(el, 'sp-expiry')).toBe('30 Jun 2027');
    expect(el.querySelector('[data-testid="sp-withdrawn"]')).toBeNull();
    expect(el.querySelector('[data-testid="sp-expiring"]')).toBeNull();
  });

  it('SharePoint, access withdrawn: the strip says it can\'t be reached; the banner says why and what to fix', () => {
    const el = answer(sharepoint({ accessLostAt: '2026-10-05T10:00:00.000Z', accessLostReason: 'GRANT_REMOVED' }));
    expect(text(el, 'strip-chip')).toBe("✕ Can't be reached");
    expect(text(el, 'strip-detail')).toBe('\u2066Quality Department › Quality Documents\u2069 · new uploads are refused');
    expect(text(el, 'sp-withdrawn')).toContain("AccreditMe can't reach SharePoint");
    expect(text(el, 'sp-withdrawn')).toContain('The app no longer has access to “Quality Documents”.');
    expect(text(el, 'sp-withdrawn')).toContain('Since 5 Oct 2026.');
  });

  for (const reason of ['SECRET_INVALID', 'CONSENT_REVOKED', 'GRANT_REMOVED', 'LIBRARY_GONE', null] as const) {
    it(`SharePoint withdrawn for ${reason ?? 'no recorded reason'}: a sentence, never a key`, () => {
      const el = answer(sharepoint({ accessLostAt: '2026-10-05T10:00:00.000Z', accessLostReason: reason }));
      expect(text(el, 'sp-withdrawn')).not.toContain('storage.');
    });
  }

  it('SharePoint, secret expiring within 30 days: the warning line', () => {
    const el = answer(sharepoint({ secretExpiresOn: '2026-11-10' }));
    expect(text(el, 'sp-expiring')).toBe('The client secret expires on 10 Nov 2026. Create a new one in Microsoft and replace it here.');
    expect(text(el, 'strip-chip')).toBe('✓ Confirmed');
  });

  it('a pending change request: the line, with who asked and when', () => {
    expect(text(answer(requested()), 'strip-request')).toBe('Change requested 7 Oct 2026 by Hessa Al-Dosari · AccreditMe will contact you');
  });

  describe('usage', () => {
    it('normal: used of the limit, the meter, the line', () => {
      const el = answer(cloud(3.2));
      expect(text(el, 'usage-big')).toBe('3.2 GB of 10 GB');
      expect(text(el, 'usage-pct')).toBe('32%');
      expect(el.querySelector('[data-testid="usage-meter"]')!.getAttribute('aria-valuenow')).toBe('32');
      expect(text(el, 'usage-line')).toBe("At 10 GB new uploads are refused; existing files aren't affected.");
      expect(el.querySelector('[data-testid="usage-contact"]')).toBeNull();
    });

    it('near: almost full, what is left, and to contact AccreditMe', () => {
      const el = answer(cloud(9.1));
      expect(text(el, 'usage-pct')).toBe('Almost full · 91%');
      // Below a gigabyte the size reads in megabytes, as everywhere in the app (FilesService.size).
      expect(text(el, 'usage-line')).toBe('About 921.6 MB left. At 10 GB new uploads are refused; existing files stay available.');
      expect(text(el, 'usage-contact')).toBe('Contact AccreditMe to raise the limit.');
    });

    it('full', () => {
      const el = answer(cloud(10));
      expect(text(el, 'usage-pct')).toBe('Full');
      expect(text(el, 'usage-line')).toContain('New uploads are refused across the organisation.');
    });

    it("nothing stored yet reads 0 KB, not a file's 1 KB floor", () => {
      expect(text(answer(unconfirmed()), 'usage-big')).toBe('0 KB of 10 GB');
    });

    it('own storage: no AccreditMe limit, and no meter', () => {
      const el = answer(minio());
      expect(text(el, 'usage-own')).toBe('Your own storage: no AccreditMe limit applies.');
      expect(el.querySelector('[data-testid="usage-meter"]')).toBeNull();
    });
  });

  describe('upload rules', () => {
    it('the size from the server, and the allowed types', () => {
      const el = answer(cloud());
      expect(text(el, 'rule-max-size')).toBe('25 MB per file');
      expect(text(el, 'rule-types')).toBe('PDF, DOCX, PNG');
    });

    it('if the types fail to load, only that row says so, with its own Retry', () => {
      const el = answer(cloud(), 'en', 'fail');
      expect(text(el, 'rule-types')).toContain("Couldn't load the allowed types.");
      expect(text(el, 'storage-usage')).toContain('3.2 GB of 10 GB');
      el.querySelector<HTMLButtonElement>('[data-testid="rule-types-retry"] button')!.click();
      http.expectOne(LIMITS_URL).flush(LIMITS);
      fixture.detectChanges();
      expect(text(el, 'rule-types')).toBe('PDF, DOCX, PNG');
    });
  });

  describe('the request outcomes', () => {
    beforeEach(() => jasmine.clock().install());
    afterEach(() => jasmine.clock().uninstall());

    it('loading: skeletons after 200ms, never "Not confirmed" before the answer', () => {
      const el = render();
      http.expectOne(LIMITS_URL).flush(LIMITS);
      jasmine.clock().tick(201);
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="storage-skeleton"]')).not.toBeNull();
      expect(el.textContent).not.toContain('Not confirmed yet');
      http.expectOne(STORAGE_URL).flush(unconfirmed());
      fixture.detectChanges();
      expect(el.querySelector('[data-testid="storage-skeleton"]')).toBeNull();
      expect(text(el, 'strip-name')).toBe('Not confirmed yet');
    });

    it('denied: a sentence, never the server\'s text', () => {
      const el = render();
      http.expectOne(LIMITS_URL).flush(LIMITS);
      http.expectOne(STORAGE_URL).flush({ message: 'Required permission: tenant:manage_config' }, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      expect(text(el, 'storage-denied')).toBe('File storage settings are open to tenant administrators.');
      expect(el.textContent).not.toContain('Required permission');
    });

    it('error: says nothing changed, and Retry asks again', () => {
      const el = render();
      http.expectOne(LIMITS_URL).flush(LIMITS);
      http.expectOne(STORAGE_URL).flush(null, { status: 500, statusText: 'x' });
      fixture.detectChanges();
      expect(text(el, 'storage-error')).toContain("Couldn't load the storage settings. Nothing has changed.");
      el.querySelector<HTMLButtonElement>('[data-testid="storage-retry"] button')!.click();
      http.expectOne(STORAGE_URL).flush(cloud());
      fixture.detectChanges();
      expect(text(el, 'strip-name')).toBe('AccreditMe cloud');
    });
  });

  it('reads in Arabic', () => {
    const el = answer(requested(), 'ar');
    expect(text(el, 'strip-name')).toBe('MinIO على خوادمكم');
    expect(text(el, 'strip-chip')).toBe('✓ مؤكَّد');
    expect(text(el, 'strip-request')).toContain('ستتواصل معكم AccreditMe');
    expect(el.querySelector('[data-field="secretKey"] [data-secret-set-on]')!.textContent!.trim()).toBe('مُعيَّن');
    expect(el.querySelector('[data-field="endpoint"] [data-testid="field-value"]')!.getAttribute('dir')).toBe('ltr');
  });
});
