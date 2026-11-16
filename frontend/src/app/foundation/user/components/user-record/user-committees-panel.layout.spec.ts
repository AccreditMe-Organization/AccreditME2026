import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { IUserCommitteeDto, IUserCommitteesDto, UserService } from '../../services/user.service';
import { USER_PANEL_GRID } from './user-panel-grid';
import { UserCommitteesPanelComponent } from './user-committees-panel.component';

// ACC-216 — the Committees panel in the record page's own panel grid
// (USER_PANEL_GRID, read from the page, never a copy), with the real theme, in
// both languages, at the CONTENT widths the shell leaves at 1280 and 390 (988 and
// 358px, as the organisation record's spec measures). A Roles-sized stand-in sits
// beside it, so at 1280 the panel shares the row as it does on the page.
//   - the panel stays inside its grid column, and nothing scrolls sideways;
//   - no text is cut: every name and detail line WRAPS (no ellipsis, nothing
//     wider than its box), and the longest name takes more than one line on a
//     phone rather than being clipped.
//
// NON-VACUITY FIRST (ACC-120): a panel that never laid out passes "inside its
// column" perfectly, so each case first proves the panel and its rows rendered,
// with width.

const WIDTHS = [988, 358] as const;
const LONG_EN = 'Infection Prevention, Control and Antimicrobial Stewardship Committee';
const LONG_AR = 'لجنة الوقاية من العدوى ومكافحتها والإشراف على استخدام مضادات الميكروبات';

const m = (id: string, nameEn: string, nameAr: string, over: Partial<IUserCommitteeDto> = {}): IUserCommitteeDto => ({
  committee: { id, nameEn, nameAr },
  seat: { id: 'seat-member', labelEn: 'Member', labelAr: 'عضو', layer: 'SYSTEM' },
  joinedAt: '2026-03-01T09:00:00.000Z',
  leftAt: null,
  current: true,
  ...over,
});

const DATA: IUserCommitteesDto = {
  total: 5,
  rows: [
    m('c1', LONG_EN, LONG_AR, {
      seat: { id: 'seat-chair', labelEn: 'Chairman of the Committee', labelAr: 'رئيس اللجنة', layer: 'SYSTEM' },
    }),
    m('c2', 'Quality and Patient Safety Committee', 'لجنة الجودة وسلامة المرضى'),
    m('c3', 'Pharmacy and Therapeutics Committee', 'لجنة الصيدلة والعلاجات', {
      seat: { id: 'seat-sec', labelEn: 'Secretary', labelAr: 'أمين السر', layer: 'SYSTEM' },
    }),
    m('c4', 'Medical Records Committee', 'لجنة السجلات الطبية', {
      current: false,
      joinedAt: '2024-11-12T09:00:00.000Z',
      leftAt: '2026-09-28T09:00:00.000Z',
    }),
    m('c5', 'Ethics Committee', 'لجنة الأخلاقيات', { current: false }),
  ],
};

@Component({
  standalone: true,
  imports: [UserCommitteesPanelComponent],
  template: `
    <div class="grid gap-3" [style.width.px]="width()" [style.grid-template-columns]="grid" data-user-panels>
      <div class="min-w-0" data-stand-in><div style="block-size: 260px"></div></div>
      <app-user-committees-panel userId="user-1" />
    </div>
  `,
})
class HostComponent {
  readonly width = input<number>(988);
  protected readonly grid = USER_PANEL_GRID;
}

describe('UserCommitteesPanel — layout in the record page grid (ACC-216)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(language: 'en' | 'ar', width: number): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: UserService, useValue: { getCommittees: () => of(DATA) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
  });

  afterAll(() => {
    console.log(`ACC-216 Committees panel:\n  ${measured.join('\n  ')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`${language} · ${width}px: inside its column, nothing scrolls sideways, no text cut`, async () => {
        const el = await render(language, width);
        const grid = el.querySelector<HTMLElement>('[data-user-panels]')!;
        const host = el.querySelector<HTMLElement>('app-user-committees-panel')!;
        const section = host.querySelector<HTMLElement>('section')!;
        const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-committee-row]'));

        // Non-vacuity: laid out at the width asked for, the panel drawn with its rows.
        const g = grid.getBoundingClientRect();
        expect(Math.round(g.width)).withContext('grid not laid out at the width asked for').toBe(width);
        expect(rows.length).withContext('the five rows rendered').toBe(5);
        const p = section.getBoundingClientRect();
        expect(p.width).withContext('the panel has width').toBeGreaterThan(200);
        expect(p.height).withContext('the panel has height').toBeGreaterThan(100);

        // Inside its column: within the grid, never wider than it, and at 988
        // sharing the row (two columns fit), at 358 alone in it.
        expect(p.left).toBeGreaterThanOrEqual(g.left - 0.5);
        expect(p.right).toBeLessThanOrEqual(g.right + 0.5);
        if (width === 988) expect(p.width).withContext('two columns at 988').toBeLessThan(width / 2 + 1);
        else expect(Math.round(p.width)).withContext('one column at 358').toBe(width);
        expect(grid.scrollWidth).withContext('sideways scroll in the grid').toBeLessThanOrEqual(grid.clientWidth);
        expect(section.scrollWidth).withContext('sideways scroll in the panel').toBeLessThanOrEqual(section.clientWidth);

        // No text cut: every line wraps inside its box, none ends in an ellipsis.
        for (const row of rows) {
          for (const line of Array.from(row.querySelectorAll<HTMLElement>('[data-committee-link], [data-committee-detail]'))) {
            const r = line.getBoundingClientRect();
            expect(line.scrollWidth).withContext(`"${line.textContent}" is wider than its box`).toBeLessThanOrEqual(line.clientWidth + 1);
            expect(getComputedStyle(line).textOverflow).not.toBe('ellipsis');
            expect(r.left).toBeGreaterThanOrEqual(p.left - 0.5);
            expect(r.right).toBeLessThanOrEqual(p.right + 0.5);
          }
        }
        const longName = rows[0]!.querySelector<HTMLElement>('[data-committee-link]')!;
        const lineHeight = parseFloat(getComputedStyle(longName).lineHeight);
        const lines = Math.round(longName.getBoundingClientRect().height / lineHeight);
        if (width === 358) expect(lines).withContext('the long name wraps on a phone').toBeGreaterThan(1);

        measured.push(
          `${language} ${width}: panel ${Math.round(p.width)} x ${Math.round(p.height)}px, long name ${lines} line(s), grid scroll ${grid.scrollWidth}/${grid.clientWidth}`,
        );
      });
    }
  }
});
