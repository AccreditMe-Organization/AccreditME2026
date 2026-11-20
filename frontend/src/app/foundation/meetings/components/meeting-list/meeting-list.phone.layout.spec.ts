import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { MeetingService } from '../../services/meeting.service';
import { MeetingListComponent } from './meeting-list.component';

// ACC-316 PR 7d-2 — /meetings on a 390 phone (artboard 14), MEASURED in both
// languages, against 1280: each row is a card (the title and owner, when with
// Hijri, the stage chip, one under another), at least 44px tall, the column
// headers gone, and nothing wider than the screen. A container query on the
// page's own width, so a 390-wide host is a 390 phone here.
// NON-VACUITY FIRST (ACC-120): rows are really drawn, with distinct boxes.

@Component({
  standalone: true,
  imports: [MeetingListComponent],
  template: `<div class="am-test-frame"><app-meeting-list /></div>`,
  styles: [':host { display: block; } .am-test-frame { inline-size: var(--frame); block-size: 900px; background: #fff; }'],
})
class Host {}

const ROWS = [1, 2, 3].map((n) => ({
  id: `m-${n}`,
  title: `Infection Prevention & Control · September 2026 · meeting ${n} with a long title`,
  scheduledAt: `2026-09-2${n}T07:00:00.000Z`,
  durationMinutes: 90,
  location: null,
  meetingUrl: null,
  stage: { id: 's', nameEn: 'Minutes Review', nameAr: 'مراجعة المحضر', flags: [] },
  owner: { kind: 'COMMITTEE', id: 'c-1', nameEn: 'Infection Prevention and Control Committee', nameAr: 'لجنة مكافحة العدوى' },
}));

describe('Meetings list — phone 390, measured (ACC-316 PR 7d-2)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  let current: ComponentFixture<Host> | null = null;
  afterAll(() => console.log(`ACC-316 meetings list on a phone:\n  ${measured.join('\n  ')}`));
  afterEach(() => {
    const el = current?.nativeElement as HTMLElement | undefined;
    current?.destroy();
    el?.remove();
    current = null;
  });

  async function open(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: MeetingService, useValue: { list: () => of({ items: ROWS, total: ROWS.length, canSeeAll: false }) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => false, isModuleEnabled: () => true } },
        { provide: ActivatedRoute, useValue: { queryParamMap: of(convertToParamMap({})), snapshot: { queryParams: {}, queryParamMap: convertToParamMap({}) } } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    const fixture = TestBed.createComponent(Host);
    current = fixture;
    const host = fixture.nativeElement as HTMLElement;
    host.style.setProperty('--frame', `${width}px`);
    document.body.appendChild(host);
    for (let i = 0; i < 6; i++) {
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    await document.fonts.ready;
    fixture.detectChanges();
    return host;
  }

  const box = (el: Element | null) => el!.getBoundingClientRect();

  for (const language of ['en', 'ar'] as const) {
    it(`[${language}, 390]: each row a card, its parts one under another, 44px or taller, no column headers, nothing wider than the phone`, async () => {
      const host = await open(language, 390);
      const page = host.querySelector('[data-testid="meeting-list-page"]')!;
      const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-meeting-row]'));
      expect(rows.length).withContext('rows drawn').toBe(3);
      const row = rows[0]!;
      const title = row.firstElementChild as HTMLElement;
      const when = row.querySelector<HTMLElement>('[data-meeting-when]')!;
      const stage = row.querySelector<HTMLElement>('[data-meeting-stage]')!;
      for (const [name, el] of [['row', row], ['title', title], ['when', when], ['stage', stage]] as const) {
        expect(el).withContext(name).toBeTruthy();
        expect(box(el!).height).withContext(`${name} height`).toBeGreaterThan(0);
      }
      expect(box(title!).bottom).withContext('when under the title').toBeLessThanOrEqual(box(when!).top + 0.5);
      expect(box(when!).bottom).withContext('the stage under when').toBeLessThanOrEqual(box(stage!).top + 0.5);
      expect(box(row).height).withContext('a 44px target').toBeGreaterThanOrEqual(44);
      const heads = Array.from(host.querySelectorAll<HTMLElement>('.am-ml__head')).filter((h) => h.offsetParent !== null);
      expect(heads.length).withContext('no column headers').toBe(0);
      // P233 — the header row goes with them: no padding or border left behind.
      const headerRow = host.querySelector<HTMLElement>('.am-dl__head');
      expect(headerRow).withContext('the header row exists').not.toBeNull();
      expect(getComputedStyle(headerRow!).display).withContext('the header row hidden').toBe('none');
      // P233 — each card's When and Stage still carry their column's name.
      const label = (key: 'when' | 'stage') => (language === 'en' ? en : ar).meeting.list.col[key];
      const whenCell = row.querySelector('[data-meeting-when]')!;
      expect(whenCell.textContent).withContext('When named').toContain(label('when'));
      expect(row.querySelector('[data-meeting-stage-name]')?.textContent?.trim()).withContext('Stage named').toBe(label('stage'));
      expect(page.scrollWidth).withContext('nothing wider than the phone').toBeLessThanOrEqual(box(page).width + 0.5);
      expect(box(page).width).toBeLessThanOrEqual(390);
      measured.push(`[${language}, 390] row ${Math.round(box(row).height)}px tall; title, when, stage stacked`);
    }, 60_000);

    it(`[${language}, 1280]: columns side by side, with their headers`, async () => {
      const host = await open(language, 1280);
      const row = host.querySelector<HTMLElement>('[data-meeting-row]')!;
      const [title, when] = Array.from(row.children) as HTMLElement[];
      expect(Math.abs(box(title!).top - box(when!).top)).withContext('one line').toBeLessThan(12);
      const heads = Array.from(host.querySelectorAll<HTMLElement>('.am-ml__head')).filter((h) => h.offsetParent !== null);
      expect(heads.length).withContext('the column headers').toBeGreaterThan(0);
      measured.push(`[${language}, 1280] columns, ${heads.length} headers`);
    }, 60_000);
  }
});
