import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { aMeeting } from '../../meeting-fixtures.testing';
import { MeetingService } from '../../services/meeting.service';
import { MeetingsPanelComponent } from './meetings-panel.component';

// ACC-316 PR 7d-2 — a committee's Meetings panel on a 390 phone, MEASURED in
// both languages: rows at least 44px, a long title cut rather than widening the
// panel, and nothing wider than the screen. The panel is the shared capped
// frame (ACC-230), the same one Home's rows use.
// NON-VACUITY FIRST (ACC-120): rows are really drawn, with a real width.

@Component({
  standalone: true,
  imports: [MeetingsPanelComponent],
  template: `<div class="am-test-frame"><app-meetings-panel [owner]="owner" /></div>`,
  styles: [':host { display: block; } .am-test-frame { inline-size: 390px; background: #fff; }'],
})
class Host {
  readonly owner = { kind: 'COMMITTEE' as const, id: 'c-1', name: 'Infection Prevention and Control Committee' };
}

const LONG = 'Infection Prevention & Control · September 2026 · quarterly review of hand-hygiene compliance and line infections';

describe('Meetings panel — phone 390, measured (ACC-316 PR 7d-2)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let current: ComponentFixture<Host> | null = null;
  afterAll(() => console.log(`ACC-316 meetings panel on a phone:\n  ${measured.join('\n  ')}`));
  afterEach(() => {
    const el = current?.nativeElement as HTMLElement | undefined;
    current?.destroy();
    el?.remove();
    current = null;
  });

  for (const language of ['en', 'ar'] as const) {
    it(`[${language}, 390]: rows 44px or taller, a long title cut, nothing wider than the phone`, async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [Host],
        providers: [
          provideRouter([]),
          provideNoopAnimations(),
          provideTranslateService({ lang: 'en' }),
          provideFormatTesting(),
          providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
          ConfirmationService,
          {
            provide: MeetingService,
            useValue: {
              list: (q: { view: string }) =>
                of(q.view === 'upcoming' ? { items: [aMeeting({ id: 'm-1', title: LONG }), aMeeting({ id: 'm-2', title: LONG })], total: 2, canSeeAll: false } : { items: [aMeeting({ id: 'm-3', title: LONG })], total: 1, canSeeAll: false }),
              maySchedule: () => of({ may: true }),
              formChoices: () => of({ types: [] }),
            },
          },
        ],
      });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use(language);
      document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
      const fixture = TestBed.createComponent(Host);
      current = fixture;
      const host = fixture.nativeElement as HTMLElement;
      document.body.appendChild(host);
      for (let i = 0; i < 4; i++) {
        fixture.detectChanges();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
      await document.fonts.ready;
      fixture.detectChanges();

      const panel = host.querySelector<HTMLElement>('am-capped-panel')!;
      const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-meeting-row]'));
      expect(rows.length).withContext('rows drawn').toBe(3);
      const width = panel.getBoundingClientRect().width;
      expect(width).withContext('the panel is drawn').toBeGreaterThan(0);
      expect(width).toBeLessThanOrEqual(390);
      for (const r of rows) expect(r.getBoundingClientRect().height).withContext('a 44px row').toBeGreaterThanOrEqual(44);
      const title = rows[0]!.querySelector<HTMLElement>('a')!;
      expect(title.scrollWidth).withContext('the long title is longer than its line').toBeGreaterThan(title.clientWidth);
      expect(panel.scrollWidth).withContext('nothing wider than the phone').toBeLessThanOrEqual(width + 0.5);
      measured.push(`[${language}, 390] ${rows.length} rows, ${Math.round(rows[0]!.getBoundingClientRect().height)}px each; title cut`);
    }, 60_000);
  }
});
