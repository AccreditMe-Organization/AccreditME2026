import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { CommitteeMembershipEventDto } from '../../services/committee.service';
import { COMMITTEE_PANEL_GRID } from '../committee-detail/committee-panel-grid';
import { CommitteeMembershipHistoryPanelComponent } from './committee-membership-history-panel.component';

// ACC-301 — a LEFT row with a long reason, MEASURED at 1280 in both languages,
// in the real theme and font. The committee page's content column at 1280 is
// 988px (committee-detail.panels.layout.spec.ts), drawn with the page's own
// panel grid, so the history panel is one of three columns there.
//
//   - the body stays EXACTLY 294px English / 328px Arabic, every row 52 / 58,
//     and nothing overflows: the reason shares line 2, never a third line;
//   - the reason is on ONE line, cut with an ellipsis (its text is wider than
//     its box), and still gets real room beside a long change;
//   - line 2 never scrolls sideways.
//
// NON-VACUITY FIRST (ACC-120): the panel is laid out, five rows are drawn, and
// the reason is on screen with a width, before any height is believed.

const EXPECT = { en: { body: 294, row: 52, l2: 18 }, ar: { body: 328, row: 58, l2: 22 } };
const LONG_REASON = {
  en: 'Moved to the Pharmacy and Therapeutics unit after the hospital-wide restructure approved by the board in October, and can no longer attend',
  ar: 'انتقل إلى وحدة الصيدلة والعلاجات بعد إعادة الهيكلة الشاملة للمستشفى التي اعتمدها المجلس في أكتوبر، ولم يعد بإمكانه الحضور',
};
const LONG_SEAT = { en: 'Deputy Chair for Infection Prevention and Antimicrobial Stewardship', ar: 'نائب الرئيس لشؤون الوقاية من العدوى والإشراف على مضادات الميكروبات' };

function events(lang: 'en' | 'ar'): CommitteeMembershipEventDto[] {
  return Array.from({ length: 8 }, (_, i) => ({
    id: `e-${i + 1}`,
    organizationId: 'org-a',
    committeeId: 'c-1',
    userId: `u-${i + 1}`,
    roleValueId: 'r-1',
    action: i === 0 ? 'LEFT' : i === 1 ? 'LEFT' : 'JOINED',
    effectiveDate: `2026-11-${String(19 - i).padStart(2, '0')}T08:00:00.000Z`,
    // Row 1: a long reason beside a long seat. Row 2: a removal from before ACC-298.
    reason: i === 0 ? LONG_REASON[lang] : null,
    approvedBy: 'u-admin',
    createdAt: '2026-11-19T08:00:00.000Z',
    userName: i === 0 ? 'Dr. Abdulrahman bin Abdulaziz Al-Qahtani Al-Shahrani' : `Person ${i + 1}`,
    approvedByName: 'Sara Admin',
    roleLabelEn: i === 0 ? LONG_SEAT.en : 'Member',
    roleLabelAr: i === 0 ? LONG_SEAT.ar : 'عضو',
    cause: null,
  }));
}

@Component({
  standalone: true,
  imports: [CommitteeMembershipHistoryPanelComponent],
  template: `<div class="grid gap-3" [style.width.px]="988" [style.grid-template-columns]="grid">
    <app-committee-membership-history-panel [events]="events()" committeeName="Quality Council" />
    <div></div>
    <div></div>
  </div>`,
})
class Host {
  readonly events = input<CommitteeMembershipEventDto[]>([]);
  /** The page's own grid, never a copy of it (ACC-232). */
  protected readonly grid = COMMITTEE_PANEL_GRID;
}

describe('Committee Membership history — a long removal reason, measured at 1280 (ACC-301)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-301 measurements:\n  ${measured.join('\n  ')}`));

  function configure(language: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  for (const language of ['en', 'ar'] as const) {
    it(`[${language}] the panel stays ${EXPECT[language].body}px, rows ${EXPECT[language].row}, the reason on one cut line`, async () => {
      const want = EXPECT[language];
      configure(language);
      const fixture = TestBed.createComponent(Host);
      fixture.componentRef.setInput('events', events(language));
      fixture.autoDetectChanges(true);
      document.body.appendChild(fixture.nativeElement);
      await settle(fixture);

      const el = fixture.nativeElement as HTMLElement;
      const head = el.querySelector<HTMLElement>('[data-testid="committee-history-head"]')!;
      const body = el.querySelector<HTMLElement>('[data-testid="committee-history-body"]')!;
      const rows = Array.from(body.querySelectorAll<HTMLElement>('li.am-cp-row'));
      const first = rows[0]!;
      const l2 = first.querySelector<HTMLElement>('.am-cp-l2')!;
      const reason = first.querySelector<HTMLElement>('[data-history-reason]')!;
      const detail = first.querySelector<HTMLElement>('[data-history-detail]')!;

      // Non-vacuity: laid out, one of three columns at 1280, five rows, the reason drawn.
      expect(head.getBoundingClientRect().height).withContext('not laid out').toBeGreaterThan(0);
      const panelWidth = el.querySelector<HTMLElement>('app-committee-membership-history-panel')!.getBoundingClientRect().width;
      expect(panelWidth).withContext('one of three columns at 1280').toBeLessThan(988 / 2);
      expect(rows.length).withContext('rows rendered').toBe(5);
      expect(reason).withContext('reason rendered').not.toBeNull();
      const reasonBox = reason.getBoundingClientRect();
      measured.push(
        `${language}: panel ${Math.round(panelWidth)}, body ${body.getBoundingClientRect().height}, row ${first.getBoundingClientRect().height}, ` +
          `line 2 ${l2.getBoundingClientRect().height}, change ${Math.round(detail.getBoundingClientRect().width)}, reason ${Math.round(reasonBox.width)} of ${reason.scrollWidth}`,
      );
      expect(reasonBox.width).withContext('the reason gets real room beside a long change').toBeGreaterThanOrEqual(80);

      // The panel's fixed height holds.
      expect(body.getBoundingClientRect().height).withContext('body').toBe(want.body);
      expect(body.scrollHeight).withContext('body overflows').toBeLessThanOrEqual(body.clientHeight);
      for (const row of rows) expect(row.getBoundingClientRect().height).withContext('row').toBe(want.row);

      // The reason is ONE line, on line 2, cut with an ellipsis.
      expect(l2.getBoundingClientRect().height).withContext('line 2').toBe(want.l2);
      expect(reasonBox.height).withContext('the reason wraps').toBeLessThanOrEqual(want.l2);
      expect(Math.round(reasonBox.top)).withContext('the reason is not on line 2').toBeGreaterThanOrEqual(Math.round(l2.getBoundingClientRect().top));
      expect(Math.round(reasonBox.bottom)).withContext('the reason is not on line 2').toBeLessThanOrEqual(Math.round(l2.getBoundingClientRect().bottom));
      expect(reason.scrollWidth).withContext('a long reason is cut').toBeGreaterThan(reason.clientWidth);
      expect(getComputedStyle(reason).textOverflow).toBe('ellipsis');
      expect(getComputedStyle(reason).whiteSpace).toBe('nowrap');
      expect(l2.scrollWidth).withContext('line 2 scrolls sideways').toBeLessThanOrEqual(l2.clientWidth);

      // The removal from before ACC-298 shows nothing extra.
      expect(rows[1]!.querySelector('[data-history-reason], .am-cmh__sep')).toBeNull();
      fixture.nativeElement.remove();
    });
  }
});
