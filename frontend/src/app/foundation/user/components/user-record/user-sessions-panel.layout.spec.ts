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
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { IUserSessionsDto, UserService } from '../../services/user.service';
import { USER_PANEL_GRID } from './user-panel-grid';
import { SessionsPanelMode, UserSessionsPanelComponent } from './user-sessions-panel.component';

// ACC-216 Sessions, PR 2 — the "Signed-in devices" panel in the record page's own
// panel grid (USER_PANEL_GRID, read from the page), with the real theme and
// fonts, in both languages, at the CONTENT widths the shell leaves at 1280 and
// 390 (988 and 358px), in both modes (your own, with its header and row actions;
// an administrator's, with Sign out everywhere). A stand-in shares the row at 988.
//   - the panel stays inside its column, and nothing scrolls sideways;
//   - the header holds its title, count and action without spilling out;
//   - every row keeps the capped panel's one height, its action inside it.
//
// NON-VACUITY FIRST (ACC-120): each case first proves the panel, its rows and
// its action rendered with size.

const WIDTHS = [988, 358] as const;

const DATA: IUserSessionsDto = {
  total: 3,
  rows: [
    {
      id: 's-this',
      startedAt: '2026-11-17T06:00:00.000Z',
      lastActiveAt: '2026-11-17T09:50:00.000Z',
      expiresAt: '2026-11-17T18:00:00.000Z',
      device: { browser: 'Samsung Internet', os: 'Android' },
      address: '203.0.113.7',
      current: true,
    },
    {
      id: 's-laptop',
      startedAt: '2026-11-17T05:00:00.000Z',
      lastActiveAt: '2026-11-17T08:10:00.000Z',
      expiresAt: '2026-11-17T17:00:00.000Z',
      device: { browser: 'Edge', os: 'Windows' },
      address: '2001:db8:85a3::8a2e:370:7334',
      current: false,
    },
    {
      id: 's-old',
      startedAt: '2026-11-16T23:00:00.000Z',
      lastActiveAt: '2026-11-17T02:00:00.000Z',
      expiresAt: '2026-11-17T11:00:00.000Z',
      device: { browser: null, os: null },
      address: null,
      current: false,
    },
  ],
};

@Component({
  standalone: true,
  imports: [UserSessionsPanelComponent],
  template: `
    <div class="grid gap-3" [style.width.px]="width()" [style.grid-template-columns]="grid" data-user-panels>
      <div class="min-w-0" data-stand-in><div style="block-size: 260px"></div></div>
      <app-user-sessions-panel userId="user-1" [mode]="mode()" personName="Huda Al-Qahtani" />
    </div>
  `,
})
class HostComponent {
  readonly width = input<number>(988);
  readonly mode = input<SessionsPanelMode>('own');
  protected readonly grid = USER_PANEL_GRID;
}

describe('UserSessionsPanel — layout in the record page grid (ACC-216 Sessions)', () => {
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

  async function render(language: 'en' | 'ar', width: number, mode: SessionsPanelMode): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: UserService, useValue: { getSessions: () => of(DATA) } },
        { provide: AmConfirmService, useValue: { ask: () => undefined } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('width', width);
    fixture.componentRef.setInput('mode', mode);
    document.body.appendChild(fixture.nativeElement);
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
  });

  afterAll(() => {
    console.log(`ACC-216 Sessions panel:\n  ${measured.join('\n  ')}`);
  });

  const inside = (inner: DOMRect, outer: DOMRect) =>
    inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5 && inner.top >= outer.top - 0.5 && inner.bottom <= outer.bottom + 0.5;

  for (const mode of ['own', 'admin'] as const) {
    for (const language of ['en', 'ar'] as const) {
      for (const width of WIDTHS) {
        it(`${mode} · ${language} · ${width}px: inside its column, the header whole, every row one height`, async () => {
          const el = await render(language, width, mode);
          const grid = el.querySelector<HTMLElement>('[data-user-panels]')!;
          const section = el.querySelector<HTMLElement>('[data-testid="sessions-panel"]')!;
          const head = el.querySelector<HTMLElement>('[data-testid="sessions-head"]')!;
          const title = head.querySelector<HTMLElement>('h2')!;
          const action = el.querySelector<HTMLElement>(mode === 'own' ? '[data-testid="sessions-end-others"]' : '[data-testid="sessions-end-all"]');
          const rows = Array.from(el.querySelectorAll<HTMLElement>('[data-session-row]'));

          // Non-vacuity: laid out at the width asked for, with its rows and action.
          const g = grid.getBoundingClientRect();
          expect(Math.round(g.width)).withContext('grid not laid out at the width asked for').toBe(width);
          expect(rows.length).withContext('the three rows rendered').toBe(3);
          expect(action).withContext('the header action rendered').not.toBeNull();
          const p = section.getBoundingClientRect();
          expect(p.width).withContext('the panel has width').toBeGreaterThan(200);
          const a = action!.getBoundingClientRect();
          expect(a.width).withContext('the action has width').toBeGreaterThan(40);

          // Inside its column, nothing sideways.
          expect(p.left).toBeGreaterThanOrEqual(g.left - 0.5);
          expect(p.right).toBeLessThanOrEqual(g.right + 0.5);
          if (width === 988) expect(p.width).withContext('two columns at 988').toBeLessThan(width / 2 + 1);
          else expect(Math.round(p.width)).withContext('one column at 358').toBe(width);
          expect(grid.scrollWidth).withContext('sideways scroll in the grid').toBeLessThanOrEqual(grid.clientWidth);
          expect(section.scrollWidth).withContext('sideways scroll in the panel').toBeLessThanOrEqual(section.clientWidth);

          // The header whole: the action inside the header, clear of the title.
          const h = head.getBoundingClientRect();
          expect(inside(a, h)).withContext(`the action spills out of the header (${Math.round(a.left)}–${Math.round(a.right)} in ${Math.round(h.left)}–${Math.round(h.right)})`).toBeTrue();
          const t = title.getBoundingClientRect();
          const clear = language === 'ar' ? a.right <= t.left + 0.5 : a.left >= t.right - 0.5;
          expect(clear).withContext('the action overlaps the title').toBeTrue();
          expect(head.scrollWidth).withContext('the header scrolls sideways').toBeLessThanOrEqual(head.clientWidth);
          // The title whole: never cut short by the action beside it (CC-306's
          // first screenshots showed the long Arabic title ending in "…" at 358).
          expect(title.scrollWidth).withContext(`the title "${title.textContent}" is cut`).toBeLessThanOrEqual(title.clientWidth + 1);

          // Every row the capped panel's one height; a row action inside its row.
          const heights = new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)));
          expect(heights.size).withContext(`rows of different heights: ${[...heights].join(', ')}`).toBe(1);
          for (const row of rows) {
            const r = row.getBoundingClientRect();
            expect(r.left).toBeGreaterThanOrEqual(p.left - 0.5);
            expect(r.right).toBeLessThanOrEqual(p.right + 0.5);
            expect(row.scrollWidth).withContext('a row scrolls sideways').toBeLessThanOrEqual(row.clientWidth + 1);
            const act = row.querySelector<HTMLElement>('[data-testid="sessions-end-one"]');
            if (act) expect(inside(act.getBoundingClientRect(), r)).withContext('a row action spills out of its row').toBeTrue();
          }
          if (mode === 'own') {
            expect(rows.filter((r) => r.querySelector('[data-testid="sessions-end-one"]')).length).withContext('Sign out on the two other devices').toBe(2);
          }

          measured.push(
            `${mode} ${language} ${width}: panel ${Math.round(p.width)} x ${Math.round(p.height)}px, header action ${Math.round(a.width)}px, row ${[...heights][0]}px`,
          );
        });
      }
    }
  }
});
