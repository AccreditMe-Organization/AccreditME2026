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
import { IStorageSettings } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { HESSA, TODAY, cloud, minio, requested, unconfirmed, unconfirmedOnPrem } from './storage-fixtures';

// ACC-260, PR B — layout with the real theme, in both languages:
//   - the setup states at the content widths 988, 358 and 328px: nothing wider
//     than the frame;
//   - the two dialogs' bodies against the drawing: Confirm 94 / 104 (Confirm
//     420) and Request a change (Form 560).
//
// NON-VACUITY FIRST (ACC-120): each case proves the thing it measures rendered,
// with width and height, before "nothing is wider" or a height may mean anything.

@Component({
  standalone: true,
  imports: [StorageSettingsComponent],
  template: `<div data-testid="frame" [style.width.px]="width()" style="box-sizing: content-box"><app-storage-settings /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

type Step = (frame: HTMLElement) => Promise<void> | void;
const choose = (kind: string): Step => (f) => (f.querySelector(`[data-testid="choose-${kind}"]`) as HTMLInputElement).click();
const replaceKeys: Step = (f) => f.querySelector<HTMLElement>('[data-field="accessKey"] p-button button')!.click();

const STATES: [string, () => IStorageSettings, Step | null, string][] = [
  ['first visit, AccreditMe cloud', unconfirmed, null, '[data-testid="cloud-setup"]'],
  ['first visit, MinIO being set up', unconfirmed, choose('MINIO'), '[data-testid="minio-form"]'],
  ['first visit, local folder', unconfirmedOnPrem, choose('LOCAL_FILESYSTEM'), '#storage-local-path'],
  ['MinIO, replacing the keys', minio, replaceKeys, '#storage-keys-secret'],
  ['change requested', requested, null, '[data-testid="strip-request"]'],
];

describe('StorageSettings — setup layout (ACC-260, PR B)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
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
    const http = TestBed.inject(HttpTestingController);
    http.expectOne(`${environment.apiUrl}/files/upload-limits`).flush({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx'] });
    http.expectOne(`${environment.apiUrl}/tenant/storage`).flush(settings);
    await settle();
    return fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });
  afterAll(() => console.log(`ACC-260 PR B storage setup layout\n${measured.join('\n')}`));

  const box = (el: Element) => el.getBoundingClientRect();

  for (const lang of ['en', 'ar'] as const) {
    for (const width of [988, 358, 328]) {
      for (const [name, state, step, probe] of STATES) {
        it(`${lang}, ${width}: ${name} — laid out, nothing wider than the frame`, async () => {
          const frame = await render(lang, width, state());
          if (step) {
            await step(frame);
            await settle();
          }
          const target = frame.querySelector(probe)!;
          const location = frame.querySelector('[data-testid="storage-location"]')!;
          // Non-vacuity: the state's own part rendered, with width and height.
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
          expect(over.map((e) => e.getAttribute('data-testid') ?? e.id ?? e.className ?? e.tagName)).withContext('elements past the frame').toEqual([]);
          measured.push(`  ${lang} ${width} ${name}: location ${Math.round(box(location).height)}, page ${Math.round(frame.scrollHeight)}; sideways ${frame.scrollWidth - frame.clientWidth}`);
        });
      }
    }
  }

  // The dialogs' bodies, as drawn (design L851–872).
  const DIALOGS: [string, () => IStorageSettings, string, string, { en: number; ar: number }][] = [
    ['Confirm (420)', unconfirmed, 'confirm-open', 'confirm-body', { en: 94, ar: 104 }],
    // The note, the pairs, then am-field's label, the textarea at the drawn
    // 76 / 82 and its message row. Drawn 204 / 222: Arabic is 219 because
    // am-field's message row is one 17px line in both languages, where the
    // drawing's Arabic help line is 20px. Changing am-field moves every form.
    ['Request a change (560)', cloud, 'request-open', 'request-body', { en: 204, ar: 219 }],
  ];
  for (const lang of ['en', 'ar'] as const) {
    for (const [name, state, opener, body, height] of DIALOGS) {
      it(`${lang}: ${name} body is ${height[lang]}px`, async () => {
        const frame = await render(lang, 988, state());
        frame.querySelector<HTMLElement>(`[data-testid="${opener}"] button`)!.click();
        await settle();
        const content = document.body.querySelector(`[data-testid="${body}"]`)!;
        const dialog = document.body.querySelector('.p-dialog')!;
        // Non-vacuity: the dialog opened and laid out.
        expect(content).withContext(body).not.toBeNull();
        expect(box(dialog).width).toBeGreaterThan(300);
        expect(box(content).width).toBeGreaterThan(300);
        // Layout height, not the bounding box: the dialog may still be scaling in
        // from its open motion, and a transform shrinks the box, not the layout.
        const h = (content as HTMLElement).offsetHeight;
        measured.push(`  ${lang} ${name}: dialog ${(dialog as HTMLElement).offsetWidth} wide, body ${h}`);
        expect(h).toBe(height[lang]);
      });
    }
  }

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: Confirm MinIO with a long endpoint — one line, cut, inside the dialog, and the body still ${lang === 'en' ? 94 : 104}`, async () => {
      const endpoint = 'https://minio-primary-storage.quality-directorate.alnakheel-specialist-hospital.local:9000';
      const frame = await render(
        lang,
        988,
        unconfirmed({ draftProvider: 'MINIO', minio: { endpoint, region: null, bucket: 'accreditme-files', accessKeyId: 'set', secretAccessKey: 'set' } }),
      );
      frame.querySelector<HTMLElement>('[data-testid="test-run"] button')!.click();
      await settle();
      TestBed.inject(HttpTestingController)
        .expectOne(`${environment.apiUrl}/tenant/storage/test`)
        .flush({ ok: true, provider: 'MINIO', passed: ['configure', 'write', 'read', 'verify', 'delete'], failedStep: null, code: null, message: null, sharepoint: null });
      await settle();
      frame.querySelector<HTMLElement>('[data-testid="confirm-open"] button')!.click();
      await settle();
      const value = document.body.querySelector('[data-testid="confirm-location"]')!;
      const dialog = document.body.querySelector('.p-dialog')!;
      const body = document.body.querySelector('[data-testid="confirm-body"]')!;
      expect(value.textContent!.trim()).toBe(endpoint);
      expect(box(value).width).toBeGreaterThan(50);
      expect(box(value).right).toBeLessThanOrEqual(box(dialog).right);
      expect(box(value).left).toBeGreaterThanOrEqual(box(dialog).left);
      expect((body as HTMLElement).offsetHeight).toBe(lang === 'en' ? 94 : 104);
    });
  }
});
