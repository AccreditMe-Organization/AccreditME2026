import { Component, input } from '@angular/core';
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
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { AuthService } from '../../../core/services/auth.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { IStorageSettings, IStorageTestResult } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { HESSA, SP_CLIENT_ID, SP_LIBRARY, SP_SITE_URL, SP_TENANT, TODAY, TYPED_SP_SECRET, sharepoint, spFound, spTestFailed, spTestPassed, unconfirmed } from './storage-fixtures';

// ACC-260, PR C — SharePoint laid out with the real theme, EN and AR, at the
// page specs' content widths 988, 358 and 328px: nothing wider than the frame,
// at any depth. The confirm dialog's body is measured at desktop width against
// the 420 cap (phones may stack and scroll, Ahmad, 26 Oct).
//
// NON-VACUITY FIRST (ACC-120): each case proves its own part rendered, with
// width and height, before "nothing is wider" may mean anything.

@Component({
  standalone: true,
  imports: [StorageSettingsComponent],
  template: `<div data-testid="frame" [style.width.px]="width()" style="box-sizing: content-box"><app-storage-settings /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

const LONG_SITE = 'Quality, Patient Safety and Accreditation Directorate — Central Region';
const LONG_LIBRARY = 'Controlled Documents and Evidence for the National Accreditation Survey 2027';

type Step = (frame: HTMLElement, http: HttpTestingController, settle: () => Promise<void>) => Promise<void>;

async function setInput(frame: HTMLElement, sel: string, value: string, settle: () => Promise<void>): Promise<void> {
  const i = frame.querySelector<HTMLInputElement>(sel)!;
  i.value = value;
  i.dispatchEvent(new Event('input'));
  await settle();
}
const press = async (frame: HTMLElement, testId: string, settle: () => Promise<void>) => {
  frame.querySelector<HTMLElement>(`[data-testid="${testId}"] button`)!.click();
  await settle();
};
function setupThen(answer: IStorageTestResult): Step {
  return async (frame, http, settle) => {
    frame.querySelector<HTMLInputElement>('[data-testid="choose-SHAREPOINT"]')!.click();
    await settle();
    await setInput(frame, '#storage-sp-tenant', SP_TENANT, settle);
    await setInput(frame, '#storage-sp-client', SP_CLIENT_ID, settle);
    await setInput(frame, '#storage-sp-secret', TYPED_SP_SECRET, settle);
    await setInput(frame, '#storage-sp-site', SP_SITE_URL, settle);
    await setInput(frame, '#storage-sp-library', SP_LIBRARY, settle);
    await press(frame, 'test-run', settle);
    http.expectOne(`${environment.apiUrl}/tenant/storage/test`).flush(answer);
    await settle();
  };
}
const calendarOpen: Step = async (frame, _http, settle) => {
  frame.querySelector<HTMLInputElement>('[data-testid="choose-SHAREPOINT"]')!.click();
  await settle();
  await press(frame, 'expiry-toggle', settle);
};
const replacingSecret: Step = async (frame, http, settle) => {
  frame.querySelector<HTMLElement>('[data-field="spClientSecret"] p-button button')!.click();
  await settle();
  await setInput(frame, '#storage-sp-new-secret', TYPED_SP_SECRET, settle);
  await press(frame, 'test-run', settle);
  http.expectOne(`${environment.apiUrl}/tenant/storage/test`).flush(spTestPassed());
  await settle();
};
const changingClient: Step = async (frame, _http, settle) => {
  await press(frame, 'sp-change-client', settle);
  await press(frame, 'test-run', settle); // invalid: every error shows
};

const STATES: [string, () => IStorageSettings, Step | null, string][] = [
  ['setup, a pass with a long site › library', unconfirmed, setupThen(spTestPassed(spFound({ siteName: LONG_SITE, libraryName: LONG_LIBRARY }))), '[data-testid="test-found"]'],
  ['setup, refused at sign-in', unconfirmed, setupThen(spTestFailed('token', 'SHAREPOINT_CLIENT_NOT_FOUND')), '[data-testid="test-detail"]'],
  ['setup, the expiry calendar open', unconfirmed, calendarOpen, '[data-testid="expiry-calendar"]'],
  ['confirmed, healthy', () => sharepoint({ filesStored: 0, disconnectAllowed: true }), null, '[data-testid="sp-manage"]'],
  ['confirmed, the secret expiring', () => sharepoint({ secretExpiresOn: '2026-11-10' }), null, '[data-testid="sp-expiring"]'],
  ['confirmed, access withdrawn', () => sharepoint({ accessLostAt: '2026-10-20T08:00:00.000Z', accessLostReason: 'GRANT_REMOVED' }), null, '[data-testid="sp-withdrawn"]'],
  ['confirmed, Disconnect locked', () => sharepoint({ filesStored: 1284, disconnectAllowed: false }), null, '[data-testid="sp-disconnect-why"]'],
  ['confirmed, replacing the secret, tested', sharepoint, replacingSecret, '#storage-sp-new-secret'],
  ['confirmed, changing the client ID, with errors', sharepoint, changingClient, '#storage-sp-new-client'],
  ['confirmed, a long site and library', () => sharepoint({ siteName: LONG_SITE, libraryName: LONG_LIBRARY }), null, '[data-field="spLibrary"]'],
];

describe('StorageSettings — SharePoint layout (ACC-260, PR C)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  let http: HttpTestingController;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(lang: 'en' | 'ar', width: number, settings: IStorageSettings): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FrameComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: AuthService, useValue: { currentUser: () => ({ id: HESSA.id, email: 'h@x.test', name: HESSA.name }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(FrameComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    const page = fixture.debugElement.children[0]!.children[0]!.componentInstance as StorageSettingsComponent;
    page.today.set(TODAY);
    http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/files/upload-limits`).flush({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx'] });
    http.expectOne(`${environment.apiUrl}/tenant/storage`).flush(settings);
    await settle();
    return fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });
  afterAll(() => console.log(`ACC-260 PR C SharePoint layout\n${measured.join('\n')}`));

  const box = (el: Element) => el.getBoundingClientRect();

  for (const lang of ['en', 'ar'] as const) {
    for (const width of [988, 358, 328]) {
      for (const [name, state, step, probe] of STATES) {
        it(`${lang}, ${width}: ${name} — laid out, nothing wider than the frame`, async () => {
          const frame = await render(lang, width, state());
          if (step) await step(frame, http, settle);
          const target = frame.querySelector(probe)!;
          const location = frame.querySelector('[data-testid="storage-location"]')!;
          expect(target).withContext(probe).not.toBeNull();
          expect(box(target).width).withContext(probe).toBeGreaterThan(40);
          expect(box(target).height).withContext(probe).toBeGreaterThan(10);
          expect(box(location).width).toBeGreaterThan(200);
          expect(frame.scrollWidth).withContext('frame').toBeLessThanOrEqual(frame.clientWidth);
          const f = box(frame);
          const over = Array.from(frame.querySelectorAll<HTMLElement>('*')).filter((e) => {
            const r = box(e);
            return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
          });
          expect(over.map((e) => e.getAttribute('data-testid') || e.id || e.className.toString().slice(0, 40) || e.tagName)).withContext('elements past the frame').toEqual([]);
          measured.push(`  ${lang} ${width} ${name}: location ${Math.round(box(location).height)}, page ${Math.round(frame.scrollHeight)}; sideways ${frame.scrollWidth - frame.clientWidth}`);
        });
      }
    }
  }

  // Measured (ACC-260 PR C): the SharePoint confirm body at desktop width is the
  // other locations' 94 / 104, with a long "site › library" cut on one line.
  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: Confirm SharePoint with a long site › library — one line, cut, inside the dialog, body ${lang === 'en' ? 94 : 104} (cap 420)`, async () => {
      const frame = await render(lang, 988, unconfirmed());
      await setupThen(spTestPassed(spFound({ siteName: LONG_SITE, libraryName: LONG_LIBRARY })))(frame, http, settle);
      await press(frame, 'confirm-open', settle);
      const value = document.body.querySelector<HTMLElement>('[data-testid="confirm-location"]')!;
      const dialog = document.body.querySelector('.p-dialog')!;
      const body = document.body.querySelector<HTMLElement>('[data-testid="confirm-body"]')!;
      expect(value.textContent!.trim()).toBe(`${LONG_SITE} › ${LONG_LIBRARY}`);
      expect(value.getAttribute('dir')).toBe('ltr');
      expect(box(value).width).toBeGreaterThan(50);
      expect(value.scrollWidth).withContext('cut, not wrapped').toBeGreaterThan(value.clientWidth);
      expect(box(value).right).toBeLessThanOrEqual(box(dialog).right);
      expect(box(value).left).toBeGreaterThanOrEqual(box(dialog).left);
      measured.push(`  ${lang} Confirm SharePoint: body ${body.offsetHeight} (cap 420)`);
      expect(body.offsetHeight).toBeLessThanOrEqual(420);
      expect(body.offsetHeight).toBe(lang === 'en' ? 94 : 104);
    });
  }
});
