import { Component, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { LanguageService } from '../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../testing/document-language';
import { COMMITTEE_PANEL_GRID } from '../components/committee-detail/committee-panel-grid';
import { CommitteeChangeRequestsPanelComponent } from './committee-change-requests-panel.component';
import { ChangeRequestDto, ChangeRequestListQuery, ChangeRequestService } from './change-request.service';
import { fakePhone } from './change-request.testing';
import { requestRow } from './committee-change-requests-panel.component.spec';

// ACC-240 — the Change requests panel and its See all, MEASURED in both
// languages, in the real theme and font (ACC-230 / ACC-234's shape):
//
//   - at the page widths 1280, 1440 and 1920 (less the 260px rail and the
//     page's 2 × 16px padding), in the page's own grid beside five other
//     panels, the body is EXACTLY 294 / 328 with 0, 3, 5 and 12 requests, its
//     rows 52 / 58, and nothing overflows; the longest row (nine fields named)
//     is cut by an ellipsis inside its track;
//   - See all at 720 × 560: only the list scrolls, nothing sideways, rows at
//     least 44, and the Fields cell stays inside its track.
//
// NON-VACUITY FIRST (ACC-120).

const ALL_FIELDS: ChangeRequestDto['changes'] = {
  nameEn: 'x',
  nameAr: 'x',
  typeValueId: 't',
  purpose: 'p',
  quorumCount: 6,
  meetingFrequency: 'WEEKLY',
  orgUnitId: 'u',
  parentCommitteeId: null,
  reportingToCommitteeId: 'c-9',
};
const PAGE_WIDTHS = [1280, 1440, 1920];
const RAIL = 260;
const PAGE_PADDING = 2 * 16;
const EXPECT = { en: { body: 294, row: 52, dialogHead: 64 }, ar: { body: 328, row: 58, dialogHead: 68 } };

/**
 * See all's body — the panel's own template, never a copy — in a box the size
 * of the 720 × 560 dialog less its header. The Karma frame is smaller than
 * 720 × 560, so a real dialog would be shrunk to fit it and measure nothing.
 */
@Component({
  standalone: true,
  imports: [CommitteeChangeRequestsPanelComponent, NgTemplateOutlet],
  template: `<am-committee-change-requests-panel #p committeeId="c-1" committeeName="Q" class="hidden" />
    <div class="flex flex-col" [style.width.px]="720" [style.height.px]="height()">
      <ng-container [ngTemplateOutlet]="p.popupBody()" />
    </div>`,
})
class PopupHost {
  readonly height = input(560 - 64);
}

@Component({
  standalone: true,
  imports: [CommitteeChangeRequestsPanelComponent],
  template: `<div class="grid gap-3" [style.width.px]="width()" [style.grid-template-columns]="grid">
    @for (i of others; track i) {
      <div></div>
    }
    <am-committee-change-requests-panel committeeId="c-1" committeeName="Quality and Patient Safety Council" />
  </div>`,
})
class PanelHost {
  readonly width = input(988);
  protected readonly grid = COMMITTEE_PANEL_GRID;
  /** The page's other panels (Members, Sub-committees, Tasks, Membership history, and one more). */
  protected readonly others = [1, 2, 3, 4, 5];
}

describe('Committee change requests panel — layout, measured (ACC-240)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let rows: ChangeRequestDto[] = [];
  let total = 0;

  afterAll(() => console.log(`ACC-240 change requests panel:\n  ${measured.join('\n  ')}`));

  function configure(language: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    fakePhone(false);
    TestBed.configureTestingModule({
      imports: [PanelHost, PopupHost],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        {
          provide: ChangeRequestService,
          useValue: {
            list: (_id: string, q: ChangeRequestListQuery) => {
              const skip = q.skip ?? 0;
              return of({ items: rows.slice(skip, skip + (q.take ?? 50)), total, matching: total });
            },
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  function data(count: number): void {
    total = count;
    rows = Array.from({ length: count }, (_, i) => requestRow(count - i, i === 0 ? { changes: ALL_FIELDS, requestedBy: { id: 'u', name: 'Dr. Abdulrahman bin Abdulaziz Al-Qahtani' } } : {}));
  }

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      const want = EXPECT[language];

      for (const page of PAGE_WIDTHS) {
        for (const count of [0, 3, 5, 12]) {
          it(`at ${page}: the body is exactly ${want.body}px with ${count} requests, and nothing overflows`, async () => {
            configure(language);
            data(count);
            const fixture = TestBed.createComponent(PanelHost);
            fixture.componentRef.setInput('width', page - RAIL - PAGE_PADDING);
            fixture.autoDetectChanges(true);
            document.body.appendChild(fixture.nativeElement);
            await settle(fixture);

            const el = fixture.nativeElement as HTMLElement;
            expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
            const panel = el.querySelector<HTMLElement>('am-committee-change-requests-panel')!;
            const body = el.querySelector<HTMLElement>('[data-testid="committee-crs-body"]')!;
            // Non-vacuity: laid out, and as many rows as asked for.
            expect(panel.getBoundingClientRect().width).withContext('panel not laid out').toBeGreaterThan(300);
            const items = Array.from(body.querySelectorAll<HTMLElement>('li.am-cp-row'));
            expect(items.length).withContext('rows rendered').toBe(Math.min(count, 5));
            measured.push(`${language} at ${page} (panel ${Math.round(panel.getBoundingClientRect().width)}), ${count}: body ${body.getBoundingClientRect().height}`);
            expect(body.getBoundingClientRect().height).toBe(want.body);
            expect(body.scrollHeight).withContext('body overflows').toBeLessThanOrEqual(body.clientHeight);
            for (const row of items) {
              expect(row.getBoundingClientRect().height).withContext('row').toBe(want.row);
              expect(row.scrollWidth).withContext('row paints outside its track').toBeLessThanOrEqual(row.clientWidth);
              const status = row.querySelector<HTMLElement>('.am-ccr__status')!;
              expect(status.getBoundingClientRect().width).withContext('status squeezed out').toBeGreaterThan(20);
            }
            if (count) {
              const longest = items[0].querySelector<HTMLElement>('.am-ccr__name')!;
              expect(getComputedStyle(longest).textOverflow).toBe('ellipsis');
              expect(longest.getBoundingClientRect().right).toBeLessThanOrEqual(panel.getBoundingClientRect().right);
              expect(longest.getBoundingClientRect().left).toBeGreaterThanOrEqual(panel.getBoundingClientRect().left);
            }
            fixture.nativeElement.remove();
          });
        }
      }

      it('See all at 720 × 560: only the list scrolls, nothing sideways, rows at least 44', async () => {
        configure(language);
        data(60);
        const fixture = TestBed.createComponent(PopupHost);
        fixture.componentRef.setInput('height', 560 - want.dialogHead);
        fixture.autoDetectChanges(true);
        document.body.appendChild(fixture.nativeElement);
        for (let i = 0; i < 50 && document.querySelectorAll('[data-testid="simple-list-row"]').length < 50; i++) await settle(fixture);

        const list = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="simple-list"]')!;
        expect(list).withContext('the list').not.toBeNull();
        const scroll = list.querySelector<HTMLElement>('[data-testid="simple-list-scroll"]')!;
        const box = list.parentElement!;
        expect(Math.round(box.getBoundingClientRect().width)).withContext('box not laid out at 720').toBe(720);
        const rendered = Array.from(list.querySelectorAll<HTMLElement>('[data-testid="simple-list-row"]'));
        expect(rendered.length).withContext('rows rendered').toBe(50);
        measured.push(`${language} See all at 720 × ${560 - want.dialogHead}: list ${Math.round(scroll.getBoundingClientRect().height)}, row ${Math.round(rendered[0].getBoundingClientRect().height)}`);
        const scrollers = Array.from(box.querySelectorAll<HTMLElement>('*')).filter(
          (n) => n.scrollHeight > n.clientHeight + 1 && !['visible', 'hidden'].includes(getComputedStyle(n).overflowY),
        );
        expect(scrollers).toEqual([scroll]);
        expect(scroll.scrollWidth).withContext('sideways').toBeLessThanOrEqual(scroll.clientWidth);
        for (const row of rendered.slice(0, 5)) {
          expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
          const rr = row.getBoundingClientRect();
          for (const cell of Array.from(row.children) as HTMLElement[]) {
            const what = `cell "${cell.textContent?.trim().slice(0, 30)}"`;
            const c = cell.getBoundingClientRect();
            expect(c.left).withContext(`${what} starts outside the row`).toBeGreaterThanOrEqual(rr.left - 0.5);
            expect(c.right).withContext(`${what} ends outside the row`).toBeLessThanOrEqual(rr.right + 0.5);
            if (cell.scrollWidth > cell.clientWidth + 1) {
              // Longer than its track: cut by an ellipsis, the whole text in a tooltip.
              const style = getComputedStyle(cell);
              expect(style.overflowX).withContext(`${what} overflows visibly`).toBe('hidden');
              expect(style.textOverflow).withContext(`${what} has no ellipsis`).toBe('ellipsis');
              expect(cell.getAttribute('title')).withContext(`${what} has no tooltip`).toBe(cell.textContent!.trim());
            }
          }
        }
        fixture.nativeElement.remove();
      });
    });
  }
});
