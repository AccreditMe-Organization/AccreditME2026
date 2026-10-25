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
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { IStorageSettings } from './storage-settings.service';
import { StorageSettingsComponent } from './storage-settings.component';
import { TODAY, cloud, minio, requested, sharepoint, unconfirmed } from './storage-fixtures';

// ACC-260, PR A — the File storage page's layout, with the real theme, in both
// languages, at the CONTENT widths the shell leaves at 1280, 390 and 360 (988,
// 358 and 328px):
//   - nothing is wider than the frame (no sideways page scroll);
//   - the usage and rules cards sit side by side at 988 and stack on a phone;
//   - the current location's fields wrap rather than run out of their column.
//
// NON-VACUITY FIRST (ACC-120): a page that never laid out passes "nothing is
// wider than the frame" with every number zero, so each case first proves the
// cards rendered, with width and height.

const WIDTHS = [988, 358, 328] as const;
const STATES: [string, () => IStorageSettings][] = [
  ['unconfirmed', unconfirmed],
  ['cloud', () => cloud(9.1)],
  ['minio requested', requested],
  ['sharepoint withdrawn', () => sharepoint({ accessLostAt: '2026-10-05T10:00:00.000Z', accessLostReason: 'CONSENT_REVOKED' })],
  ['sharepoint expiring', () => sharepoint({ secretExpiresOn: '2026-11-10' })],
];

@Component({
  standalone: true,
  imports: [StorageSettingsComponent],
  template: `<div data-testid="frame" [style.width.px]="width()" style="box-sizing: content-box"><app-storage-settings /></div>`,
})
class FrameComponent {
  readonly width = input(988);
}

describe('StorageSettings — layout (ACC-260, PR A)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<FrameComponent>;
  const measured: string[] = [];

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
    http.expectOne(`${environment.apiUrl}/files/upload-limits`).flush({ maxUploadBytes: 25 * 1024 * 1024, allowedExtensions: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt', 'csv', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'heif'] });
    http.expectOne(`${environment.apiUrl}/tenant/storage`).flush(settings);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement;
  }

  afterEach(() => fixture?.nativeElement.remove());
  afterAll(() => console.log(`ACC-260 PR A storage layout\n${measured.join('\n')}`));

  const box = (el: Element) => el.getBoundingClientRect();

  for (const lang of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      for (const [name, state] of STATES) {
        it(`${lang}, ${width}: ${name} — nothing wider than the frame, cards laid out`, async () => {
          const frame = await render(lang, width, state());
          const strip = frame.querySelector('[data-testid="storage-strip"]')!;
          const location = frame.querySelector('[data-testid="storage-location"]')!;
          const usage = frame.querySelector('[data-testid="storage-usage"]')!;
          const rules = frame.querySelector('[data-testid="storage-rules"]')!;
          // Non-vacuity: every card laid out, with width and height.
          for (const [label, el] of [['strip', strip], ['location', location], ['usage', usage], ['rules', rules]] as const) {
            expect(box(el).width).withContext(label).toBeGreaterThan(200);
            expect(box(el).height).withContext(label).toBeGreaterThan(40);
          }
          // Nothing paints past the frame, at any depth.
          expect(frame.scrollWidth).withContext('frame').toBeLessThanOrEqual(frame.clientWidth);
          const f = box(frame);
          const over = Array.from(frame.querySelectorAll<HTMLElement>('*')).filter((e) => {
            const r = box(e);
            return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
          });
          expect(over.map((e) => e.getAttribute('data-testid') ?? e.className ?? e.tagName)).withContext('elements past the frame').toEqual([]);
          // Side by side at desktop width; stacked on a phone.
          const sideBySide = Math.abs(box(usage).top - box(rules).top) < 1;
          expect(sideBySide).withContext('usage and rules side by side').toBe(width === 988);
          measured.push(
            `  ${lang} ${width} ${name}: strip ${Math.round(box(strip).height)}, location ${Math.round(box(location).height)}, usage ${Math.round(box(usage).height)}, rules ${Math.round(box(rules).height)}, page ${Math.round(frame.scrollHeight)}; sideways ${frame.scrollWidth - frame.clientWidth}`,
          );
        });
      }
    }
  }

  it('a long MinIO endpoint and bucket wrap inside their field at 328', async () => {
    const s = minio({ minio: { endpoint: 'https://minio-primary-storage.quality-directorate.alnakheel-specialist-hospital.local:9000', region: 'me-central-1', bucket: 'accreditme-quality-evidence-archive-2026', accessKeyId: 'set', secretAccessKey: 'set' } });
    const frame = await render('en', 328, s);
    const value = frame.querySelector('[data-field="endpoint"] [data-testid="field-value"]')!;
    const field = frame.querySelector('[data-field="endpoint"]')!;
    expect(box(value).height).toBeGreaterThan(20); // wrapped onto more than one line
    expect(box(value).right).toBeLessThanOrEqual(box(field).right + 1);
    expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
  });
});
