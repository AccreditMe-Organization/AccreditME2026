import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { providePrimeNG } from 'primeng/config';
import { TranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../core/theme/accreditme-preset';
import { LanguageService } from '../../core/services/language.service';
import { TestFormatContext } from '../../core/formatting/format-context';
import { loadTranslationsForTest } from '../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { HomeComponent } from './home.component';
import { HomeAdminSummaryDto } from './home-summary.service';
import { awaitingMe, awaitingRow, committeeRow, homeProviders, recordList, taskRow } from './home.testing';
import { useLayoutFonts } from '../../../testing/layout-fonts';

// ACC-279 — Home MEASURED in the real theme, font and translations (plan §3.2).
//
// The widths are the shell's content column (viewport − rail − 2 × 16px) at
// 1280, 1440 and 1920 with the rail open (988, 1148, 1628), 1280 with the rail
// collapsed (1176), and a 390 phone less its gutters (358).
//
//   - the panels are 2 / 3 / 3 / 3 / 1 to a row, and the admin tiles 4 to a row
//     on a desktop and 2 on a phone (the design's 170px minimum);
//   - the panels in a row share their top AND bottom edges, each body 294px in
//     English and 328px in Arabic, none scrolling;
//   - nothing is wider than its column: no horizontal scroll at any width, and a
//     long committee name is cut inside its row.
//
// NON-VACUITY FIRST (ACC-120): three real panels and real tiles, with real
// heights and distinct offsets, before "they line up" may mean anything.

const WIDTHS = [
  { name: '1280', width: 988, panels: 2, tiles: 4 },
  { name: '1440', width: 1148, panels: 3, tiles: 4 },
  { name: '1920', width: 1628, panels: 3, tiles: 4 },
  { name: '1280, rail collapsed', width: 1176, panels: 3, tiles: 4 },
  { name: 'phone 390', width: 358, panels: 1, tiles: 2 },
] as const;

const LONG_NAME_EN = 'Antimicrobial Stewardship and Infection Prevention Oversight Committee of the Medical Staff';
const LONG_NAME_AR = 'لجنة الإشراف على الاستخدام الرشيد للمضادات الحيوية والوقاية من العدوى للطاقم الطبي';

const SUMMARY: HomeAdminSummaryDto = {
  setup: {
    open: 8,
    blocksWork: 3,
    top: [
      {
        id: 'sc-1',
        type: 'ORG_UNIT_WITHOUT_HEAD',
        severity: 'BLOCKS_WORK',
        objectId: 'unit-1',
        subject: { nameEn: 'Pharmacy', nameAr: 'الصيدلية', escalationResolves: false },
        openedAt: '2026-10-28T09:00:00.000Z',
        ageBasis: 'OBJECT',
        lastSeenAt: '2026-11-06T08:56:00.000Z',
        clearedAt: null,
      },
    ],
    freshness: [],
  },
  users: { active: 298, invited: 14, invitedExpired: 3, seats: { occupied: 312, maxUsers: 400 } },
  committees: { inForce: 22, belowQuorum: 4 },
};

@Component({
  standalone: true,
  imports: [HomeComponent],
  template: `<div data-host [style.width.px]="width()"><app-home /></div>`,
})
class PageHost {
  readonly width = input(1148);
}

describe('HomeComponent — measured layout (ACC-279)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<PageHost>;

  async function render(width: number, lang: 'en' | 'ar'): Promise<HTMLElement> {
    const setup = homeProviders({
      permissions: ['setup:view', 'users:view', 'committees:view', 'tenant:view', 'admin:access', 'org:view', 'org:manage'],
      myTasks: recordList(
        Array.from({ length: 5 }, (_, i) =>
          taskRow({ id: `t-${i}`, title: `Collect the monthly hand hygiene figures for ward ${i + 1}`, dueAt: `2026-11-${10 + i}T09:00:00.000Z` }),
        ),
        7,
      ),
      myOverdue: 2,
      awaiting: awaitingMe([awaitingRow(), awaitingRow({ instanceStageId: 'e-2', record: { type: 'COMMITTEE', id: 'c-2', nameEn: LONG_NAME_EN, nameAr: LONG_NAME_AR } })]),
      committees: {
        total: 3,
        rows: [
          committeeRow(),
          committeeRow({ committeeId: 'c-2', nameEn: LONG_NAME_EN, nameAr: LONG_NAME_AR, seat: { id: 'secretary', labelEn: 'Secretary', labelAr: 'أمين السر' } }),
          committeeRow({ committeeId: 'c-3', nameEn: 'Medication Safety', nameAr: 'سلامة الأدوية', isInForce: false, stage: { nameEn: 'Terms Review', nameAr: 'مراجعة الشروط' } }),
        ],
      },
      summary: SUMMARY,
    });
    TestBed.configureTestingModule({
      imports: [PageHost],
      providers: [
        ...setup.providers,
        provideNoopAnimations(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(PageHost);
    fixture.componentRef.setInput('width', width);
    fixture.detectChanges();
    for (let i = 0; i < 3; i++) {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      fixture.detectChanges();
    }
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  /** Elements grouped into rows by their top edge (1px tolerance). */
  function rowsOf(elements: HTMLElement[]): HTMLElement[][] {
    const rows = new Map<number, HTMLElement[]>();
    for (const el of elements) {
      const top = Math.round(el.getBoundingClientRect().top);
      const key = [...rows.keys()].find((k) => Math.abs(k - top) <= 1) ?? top;
      rows.set(key, [...(rows.get(key) ?? []), el]);
    }
    return [...rows.values()];
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const w of WIDTHS) {
      it(`at ${w.name} [${lang}]: ${w.panels} panel(s) and ${w.tiles} admin tiles to a row, rows aligned, nothing too wide`, async () => {
        const host = await render(w.width, lang);
        const panels = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="home-panels"] > *'));
        const frames = panels.map((p) => p.querySelector<HTMLElement>('.am-cp')!);
        const adminTiles = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="home-admin-tiles"] > am-home-tile'));
        const myTiles = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="home-tiles"] > am-home-tile'));

        // ── Non-vacuity ──
        expect(panels.length).withContext('three panels').toBe(3);
        frames.forEach((f, i) => {
          expect(f).withContext(`panel ${i} draws an am-capped-panel`).not.toBeNull();
          expect(f.getBoundingClientRect().height).withContext(`panel ${i} has a real height`).toBeGreaterThan(200);
        });
        expect(adminTiles.length).withContext('four admin tiles').toBe(4);
        expect(myTiles.length).withContext('three personal tiles').toBe(3);
        const lefts = new Set(adminTiles.map((t) => Math.round(t.getBoundingClientRect().left)));
        expect(lefts.size).withContext('the admin tiles have distinct offsets').toBe(w.tiles);

        // ── Columns ──
        const panelRows = rowsOf(panels);
        expect(panelRows[0]!.length).withContext('panels in the first row').toBe(w.panels);
        expect(rowsOf(adminTiles)[0]!.length).withContext('admin tiles in the first row').toBe(w.tiles);
        expect(rowsOf(myTiles)[0]!.length).withContext('personal tiles in the first row').toBe(Math.min(3, w.tiles));

        // ── Rows share their top and bottom edges ──
        for (const row of panelRows) {
          const boxes = row.map((p) => p.querySelector<HTMLElement>('.am-cp')!.getBoundingClientRect());
          for (let i = 1; i < boxes.length; i++) {
            expect(Math.abs(boxes[i]!.top - boxes[0]!.top)).withContext(`panel ${i} top`).toBeLessThanOrEqual(1);
            expect(Math.abs(boxes[i]!.bottom - boxes[0]!.bottom)).withContext(`panel ${i} bottom`).toBeLessThanOrEqual(1);
          }
        }
        for (const row of rowsOf(myTiles)) {
          const boxes = row.map((t) => t.getBoundingClientRect());
          for (let i = 1; i < boxes.length; i++) {
            expect(Math.abs(boxes[i]!.bottom - boxes[0]!.bottom)).withContext(`tile ${i} bottom`).toBeLessThanOrEqual(1);
          }
        }

        // ── Each panel body is the fixed height, and none scrolls ──
        for (const frame of frames) {
          const body = frame.querySelector<HTMLElement>('.am-cp__body')!;
          expect(Math.round(body.getBoundingClientRect().height)).withContext('body height').toBe(lang === 'en' ? 294 : 328);
          expect(body.scrollHeight).withContext('body holds its rows').toBeLessThanOrEqual(body.clientHeight + 1);
        }

        // ── Nothing is wider than the column ──
        const hostBox = host.getBoundingClientRect();
        expect(host.scrollWidth).withContext('no horizontal scroll').toBeLessThanOrEqual(host.clientWidth + 1);
        for (const el of [...frames, ...adminTiles, ...myTiles, host.querySelector<HTMLElement>('[data-testid="home-needs-fixing"]')!]) {
          const box = el.getBoundingClientRect();
          expect(box.left).withContext(`${el.tagName} left edge`).toBeGreaterThanOrEqual(hostBox.left - 1);
          expect(box.right).withContext(`${el.tagName} right edge`).toBeLessThanOrEqual(hostBox.right + 1);
        }
        // A long committee name is cut with an ellipsis inside its row.
        const longRow = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="home-committee-row"]'))[1]!;
        expect(longRow.scrollWidth).withContext('the long name stays inside its row').toBeLessThanOrEqual(longRow.clientWidth + 1);
      });
    }

    // The rows above line up because every panel has the same fixed height,
    // which would pass even if none filled its cell. Here one cell is made
    // taller: every panel in that row must still reach the row's bottom, which
    // only data-fill-panels makes true.
    it(`[${lang}] a row taller than its panels: every panel still fills its cell`, async () => {
      const host = await render(1148, lang);
      const panels = Array.from(host.querySelectorAll<HTMLElement>('[data-testid="home-panels"] > *'));
      const first = panels[0]!;
      first.style.minBlockSize = `${Math.round(first.getBoundingClientRect().height) + 120}px`;
      fixture.detectChanges();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const top = first.getBoundingClientRect().top;
      const row = panels.filter((p) => Math.abs(p.getBoundingClientRect().top - top) <= 1);
      expect(row.length).withContext('non-vacuity: the row holds several panels').toBeGreaterThan(1);
      const bottom = first.getBoundingClientRect().bottom;
      for (const p of row) {
        expect(Math.abs(p.querySelector<HTMLElement>('.am-cp')!.getBoundingClientRect().bottom - bottom))
          .withContext(`${p.tagName} reaches the row's bottom`)
          .toBeLessThanOrEqual(1);
      }
    });
  }
});
