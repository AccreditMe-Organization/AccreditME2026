import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { CAPPED_PANEL_BODY_PX } from '../../../../shared/components/capped-panel/capped-panel.component';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { TaskService } from '../../../tasks/services/task.service';
import { RecordTasksPanelComponent } from '../../../tasks/components/record-tasks-panel/record-tasks-panel.component';
import { rows } from '../../../tasks/components/record-tasks-panel/record-tasks.fixtures';
import { UserService } from '../../services/user.service';
import { USER_PANEL_GRID } from './user-panel-grid';
import { UserSessionsPanelComponent } from './user-sessions-panel.component';

// ACC-216 PR 5 — a person's Tasks panel MEASURED beside the user record page's
// other capped panel (Signed-in devices; Committees and Roles are record panels,
// with a minimum body rather than a fixed one), in the page's own grid
// (USER_PANEL_GRID), the real theme and fonts, in both languages, at the content
// widths the shell leaves at 1280 and 390 (988 and 358):
//   - its body is the capped frame's fixed height, the same as Signed-in devices —
//     294 English, 328 Arabic — with five rows and a footer;
//   - nothing in the panel scrolls sideways.
//
// NON-VACUITY FIRST (ACC-120): both panels are laid out, with rows, before
// any height is compared.

const WIDTHS = [988, 358] as const;

@Component({
  standalone: true,
  imports: [RecordTasksPanelComponent, UserSessionsPanelComponent],
  template: `
    <div class="grid gap-3" [style.width.px]="width()" [style.grid-template-columns]="grid" data-user-panels>
      <app-record-tasks-panel data-panel="tasks" person="u-huda" recordName="Huda Al-Qahtani" />
      <app-user-sessions-panel userId="u-huda" mode="own" personName="Huda Al-Qahtani" />
    </div>
  `,
})
class HostComponent {
  readonly width = input<number>(988);
  protected readonly grid = USER_PANEL_GRID;
}

const SESSION = {
  id: 's-1',
  startedAt: '2026-11-17T06:00:00.000Z',
  lastActiveAt: '2026-11-17T09:50:00.000Z',
  expiresAt: '2026-11-17T18:00:00.000Z',
  device: { browser: 'Chrome', os: 'Windows' },
  address: '203.0.113.7',
  current: true,
};

describe('A person\'s Tasks panel beside the record page\'s other capped panels (ACC-216)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function render(language: 'en' | 'ar', width: number, fail = false): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: AmConfirmService, useValue: { ask: () => undefined } },
        {
          provide: TaskService,
          useValue: {
            getPersonPanel: () =>
              fail ? throwError(() => ({ status: 500 })) : of({ total: 12, scope: 'all', rows: rows(5), canCreate: false }),
          },
        },
        {
          provide: UserService,
          useValue: { getSessions: () => of({ total: 1, rows: [SESSION] }) },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    (fixture?.nativeElement as HTMLElement | undefined)?.remove();
  });

  afterAll(() => console.log(`ACC-216 Tasks panel beside the record page's capped panels:\n  ${measured.join('\n  ')}`));

  for (const language of ['en', 'ar'] as const) {
    for (const width of WIDTHS) {
      it(`${language} · ${width}px: the Tasks body is the capped height, the same as Signed-in devices`, async () => {
        const el = await render(language, width);
        const body = (prefix: string) => el.querySelector<HTMLElement>(`[data-testid="${prefix}-body"]`);
        const tasks = body('record-tasks');
        const others = ['sessions'].map((p) => ({ p, b: body(p) }));
        // Non-vacuity: every panel is laid out, the Tasks panel with its five rows and its footer.
        expect(tasks).withContext('the Tasks body rendered').not.toBeNull();
        for (const o of others) expect(o.b).withContext(`the ${o.p} body rendered`).not.toBeNull();
        expect(el.querySelectorAll('[data-task-row]').length).withContext('five task rows').toBe(5);
        expect(el.querySelector('[data-testid="record-tasks-foot"]')).withContext('the "Showing 5 of 12" footer').not.toBeNull();
        const capped = language === 'ar' ? CAPPED_PANEL_BODY_PX.rtl : CAPPED_PANEL_BODY_PX.ltr;
        const t = Math.round(tasks!.getBoundingClientRect().height);
        expect(t).withContext('the Tasks body is the capped frame\'s fixed height').toBe(capped);
        for (const o of others) {
          expect(Math.round(o.b!.getBoundingClientRect().height)).withContext(`${o.p} body equals the Tasks body`).toBe(t);
        }
        const section = el.querySelector<HTMLElement>('[data-testid="record-tasks-panel"]')!;
        expect(section.scrollWidth).withContext('the Tasks panel scrolls sideways').toBeLessThanOrEqual(section.clientWidth);
        measured.push(`${language} ${width}: tasks ${t}, ${others.map((o) => `${o.p} ${Math.round(o.b!.getBoundingClientRect().height)}`).join(', ')}`);
      });
    }
  }
  // CC-331 — the load error is the shared block (am-load-error) in every capped panel,
  // and the body keeps its fixed height while it shows.
  for (const language of ['en', 'ar'] as const) {
    it(`${language} · 988px: in the error state the Tasks body stays the capped height, with the shared block`, async () => {
      const el = await render(language, 988, true);
      const body = el.querySelector<HTMLElement>('[data-testid="record-tasks-body"]')!;
      const block = body.querySelector('am-load-error [data-panel-error]');
      expect(block).withContext('non-vacuity: the shared error block is shown').not.toBeNull();
      expect(block!.querySelector('p-button button')).withContext('its Retry').not.toBeNull();
      const capped = language === 'ar' ? CAPPED_PANEL_BODY_PX.rtl : CAPPED_PANEL_BODY_PX.ltr;
      expect(Math.round(body.getBoundingClientRect().height)).toBe(capped);
    });
  }
});
