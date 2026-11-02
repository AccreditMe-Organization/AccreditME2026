import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { SetupConditionDto } from '../../services/setup-health.service';
import { SetupHealthPageComponent } from './setup-health-page.component';

// ACC-271 PR 5a — Setup health's "Workflow stage still on its starting
// assignment" rows (drawing section 11), MEASURED in the real theme, font and
// translations, at the content column of a 1280, 1440 and 1920 window (988,
// 1148, 1628) and on a phone (358), in English and Arabic, and again on the
// phone with a wide fallback font (CI's Linux runner has not got the app's):
//
//   - nothing on the page scrolls sideways;
//   - every row's title, sub-line and actions sit inside the row, and the two
//     actions (Review stage, Keep this assignment) inside it, unclipped;
//   - without workflows:manage, the permission line sits there instead.
//
// NON-VACUITY FIRST: the rows and both actions exist and are laid out.

const CASES = [
  { name: 'at 1280', width: 988 },
  { name: 'at 1440', width: 1148 },
  { name: 'at 1920', width: 1628 },
  { name: 'at 390', width: 358 },
  { name: 'at 390, wide fallback font', width: 358, wideFont: true },
] as const;

const WIDE_FONT_CSS = `*, *::before, *::after { font-family: 'DejaVu Sans', 'Liberation Sans', Verdana, sans-serif !important; }`;

const row = (i: number): SetupConditionDto => ({
  id: `cond-${i}`,
  type: 'STAGE_ON_STARTING_ASSIGNMENT',
  severity: 'AT_RISK',
  objectId: `stage-${i}`,
  subject: {
    nameEn: i === 1 ? 'Executive Committee Terms of Reference Review and Final Sign-off' : `Stage ${i}`,
    nameAr: i === 1 ? 'مراجعة النظام الداخلي للجنة التنفيذية والاعتماد النهائي' : `المرحلة ${i}`,
    templateId: 'tpl-1',
    templateNameEn: 'Clinical Policy and Procedure Review Lifecycle',
    templateNameAr: 'دورة مراجعة السياسات والإجراءات السريرية',
    adminName: 'Dr. Abdulrahman Al-Mutairi Al-Shammari',
  },
  openedAt: '2026-10-28T09:00:00.000Z',
  ageBasis: 'OBJECT',
  lastSeenAt: '2026-11-01T08:50:00.000Z',
  clearedAt: null,
});

@Component({
  standalone: true,
  imports: [SetupHealthPageComponent],
  template: `<div data-host [style.width.px]="width()"><app-setup-health-page /></div>`,
})
class Host {
  readonly width = input(988);
}

describe('SetupHealthPageComponent — the starting-assignment rows fit (ACC-271 PR 5a)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<Host>;
  let http: HttpTestingController;
  let wideFontStyle: HTMLStyleElement | null = null;

  afterEach(() => {
    wideFontStyle?.remove();
    wideFontStyle = null;
    http.verify();
  });

  async function render(width: number, lang: 'en' | 'ar', manage: boolean, wideFont = false): Promise<HTMLElement> {
    if (wideFont) {
      wideFontStyle = document.createElement('style');
      wideFontStyle.textContent = WIDE_FONT_CSS;
      document.head.appendChild(wideFontStyle);
    }
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => manage || p !== 'workflows:manage' } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/setup-health`).flush({
      open: [1, 2, 3].map(row),
      recentlyCleared: [],
      freshness: [{ type: 'STAGE_ON_STARTING_ASSIGNMENT', status: 'CURRENT', computedAt: '2026-11-01T08:50:00.000Z' }],
    });
    fixture.detectChanges();
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  const inside = (child: DOMRect, parent: DOMRect): boolean =>
    child.left >= parent.left - 1 && child.right <= parent.right + 1 && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1;

  for (const lang of ['en', 'ar'] as const) {
    for (const c of CASES) {
      for (const manage of [true, false]) {
        const who = manage ? 'with workflows:manage' : 'without workflows:manage';
        it(`${c.name} [${lang}] ${who}: every row and its actions inside, no sideways page`, async () => {
          const host = await render(c.width, lang, manage, 'wideFont' in c && c.wideFont);
          const items = Array.from(host.querySelectorAll<HTMLElement>('#health-group-STAGE_ON_STARTING_ASSIGNMENT ~ * li, section[aria-labelledby="health-group-STAGE_ON_STARTING_ASSIGNMENT"] li'));

          // ── Non-vacuity ──
          expect(items.length).withContext('three rows').toBe(3);
          for (const item of items) expect(item.getBoundingClientRect().height).withContext('laid out').toBeGreaterThan(30);
          const actions = items.flatMap((item) => Array.from(item.querySelectorAll<HTMLElement>('a.am-health-fix, [data-testid="health-keep"]')));
          expect(actions.length).withContext('Review stage and Keep on each row, or none').toBe(manage ? 6 : 0);

          // ── No sideways page ──
          expect(host.scrollWidth).withContext('the page').toBeLessThanOrEqual(c.width + 1);

          // ── Inside the row, unclipped ──
          for (const item of items) {
            const box = item.getBoundingClientRect();
            const parts = item.querySelectorAll<HTMLElement>('a.am-health-fix, [data-testid="health-keep"], span.block');
            for (const part of Array.from(parts)) {
              expect(inside(part.getBoundingClientRect(), box)).withContext(`${part.className} inside its row`).toBeTrue();
              expect(part.scrollWidth).withContext(`${part.className} not clipped`).toBeLessThanOrEqual(part.clientWidth + 1);
            }
            if (!manage) expect(item.textContent).toContain(lang === 'en' ? 'Fixing this needs permission to manage workflows.' : 'إصلاح هذا يتطلب صلاحية إدارة سير العمل.');
          }
        });
      }
    }
  }
});
