import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { IdleService } from '../../../../core/services/idle.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TopbarComponent } from '../../../../layout/topbar/topbar.component';
import { BreadcrumbComponent } from '../../../../layout/breadcrumb/breadcrumb.component';
import { LanguageToggleComponent } from '../../../../layout/language-toggle/language-toggle.component';
import { ImpersonationBannerComponent } from '../../../../layout/impersonation-banner/impersonation-banner.component';
import { NotificationBellComponent } from '../../../notification/components/notification-bell/notification-bell.component';
import { IdleWarningComponent } from '../../../../core/components/idle-warning/idle-warning.component';
import { AppShellComponent } from '../../../../layout/app-shell/app-shell.component';
import { ALL_KINDS, WHO_RULES, storedEntry } from '../stage-who/stage-who-options.testing';
import { WorkflowStageListComponent } from './workflow-stage-list.component';

// ACC-271 PR 5a — the Stages page scrolls in ONE place: the shell's <main>.
// Found by Ahmad on Committee Management (an overflowing strip): the window
// scrolled as well as <main>, and at the bottom blank page showed under the
// rail. Two causes, each pinned here:
//
//   - <main> was not a containing block, so anything absolutely positioned in
//     the page (visually hidden text, the mode choice's inputs, the list's live
//     region) was placed against the wrapper above it, escaped main's scroll
//     and made the document taller than the window;
//   - the page held its column to the window's height, so under an open stage
//     panel the stages list was squeezed to nothing and its rows got a second,
//     hidden vertical scroll.
//
// The REAL shell and the REAL page are rendered (the bell, breadcrumb, language
// toggle, banner and idle warning are stand-ins), at the content widths of a
// 1280, 1440 and 1920 window and a 390 phone, in English and Arabic, with the
// panel closed and open. The strip keeps its own HORIZONTAL scroll, which is
// not a vertical scroll and is left alone.
//
// ACC-271 PR 5b — and with the TRANSITION panel open, in the same slot. The
// panel and the stages list never scroll sideways, and the strip, which opens
// on Fit, shows its whole row with no sideways scroll at any of these widths.
//
// NON-VACUITY FIRST: the page is taller than the window (so <main> must scroll)
// and the list has its rows, before "nothing else scrolls" may mean anything.

@Component({ selector: 'app-breadcrumb', standalone: true, template: '' })
class BreadcrumbStub {}
@Component({ selector: 'app-notification-bell', standalone: true, template: '' })
class BellStub {}
@Component({ selector: 'app-language-toggle', standalone: true, template: '' })
class LanguageToggleStub {}
@Component({ selector: 'app-impersonation-banner', standalone: true, template: '' })
class BannerStub {}
@Component({ selector: 'app-idle-warning', standalone: true, template: '' })
class IdleWarningStub {}

const CASES = [
  { name: 'at 1280', width: 1280, phone: false },
  { name: 'at 1440', width: 1440, phone: false },
  { name: 'at 1920', width: 1920, phone: false },
  { name: 'at 390', width: 390, phone: true },
] as const;

const NAMES: [string, string][] = [
  ['Formation', 'التشكيل'],
  ['Terms Review', 'مراجعة الشروط'],
  ['Active', 'نشطة'],
  ['Under Review', 'قيد المراجعة'],
  ['Suspended', 'معلّقة'],
  ['Dissolution Pending', 'بانتظار الحل'],
  ['Dissolved', 'منحلة'],
];

const UNIT = { id: 'unit-q', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' };

const stage = (i: number): Record<string, unknown> => ({
  id: `stage-${i}`,
  workflowTemplateId: 'template-1',
  nameEn: NAMES[i]![0],
  nameAr: NAMES[i]![1],
  description: null,
  order: (i + 1) * 10,
  slaWorkingHours: 40,
  isInitial: i === 0,
  isFinal: i === NAMES.length - 1,
  escalationConfig: null,
  actions: ['add_member'],
  flags: [],
  liveCount: i,
  transitions:
    i < NAMES.length - 1
      ? [
          {
            id: `t-${i}`,
            fromStageId: `stage-${i}`,
            toStageId: `stage-${i + 1}`,
            labelEn: `Move to ${NAMES[i + 1]![0]}`,
            labelAr: `نقل إلى ${NAMES[i + 1]![1]}`,
            validatorConfig: null,
            isApprovalPath: false,
            kind: 'ADVANCE',
            mover: 'PERSON',
            actions: [{ id: `a-${i}`, workflowTransitionId: `t-${i}`, actionType: 'LOG_AUDIT', order: 10, isEnabled: true, configJson: null }],
          },
        ]
      : [],
  // Two entries, so the mode choice (and its visually hidden inputs) shows.
  who: {
    mode: 'ANY_ONE',
    entries: [storedEntry({ kind: 'ORG_UNIT_HEAD', orgUnitId: UNIT.id, orgUnit: UNIT }), storedEntry({ kind: 'CREATOR' })],
  },
  whoSentence: { en: 'Any one of: the head of Quality Department, or whoever created the record.', ar: 'أيٌّ من: من يرأس إدارة الجودة، أو من أنشأ السجل.' },
});

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  isProtected: false,
  recordActions: [{ key: 'add_member', labelKey: 'workflow.recordAction.COMMITTEE.add_member', permissionKey: 'committees:add_member' }],
  stageFlags: [{ key: 'IN_FORCE', labelKey: 'workflow.stageFlag.IN_FORCE', cardinality: 'any' }],
  recordFields: [],
  recordRoutes: { unit: true, committee: true },
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
  stages: NAMES.map((_, i) => stage(i)),
};

/** A MediaQueryList fixed to one answer: the shell and the page read the phone line from it. */
const media = (matches: boolean) =>
  ({ matches, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList;

describe('WorkflowStageListComponent — one vertical scroll, inside the shell (ACC-271 PR 5a)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<AppShellComponent>;
  let http: HttpTestingController;
  /**
   * The window, as far as the shell can tell: a fixed box exactly the
   * window's size that scrolls when its content is taller. The test runner's
   * own page is not the app's window (it has its own content), so the shell is
   * measured in this box instead. It is a containing block, as the window is,
   * so anything escaping <main> stretches it the way it stretched the page.
   */
  let viewport: HTMLElement;

  async function render(width: number, phone: boolean, lang: 'en' | 'ar'): Promise<HTMLElement> {
    spyOn(window, 'matchMedia').and.callFake(() => media(phone));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([{ path: 'workflows/:templateId/stages', component: WorkflowStageListComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        {
          provide: NavigationAccessService,
          useValue: {
            loadAccess: () => of(undefined),
            // Only what the Stages page needs: the rail's other items (Setup health's
            // polled count among them) stay out, so nothing keeps the zone busy.
            hasPermission: (p: string) => p.startsWith('workflows:'),
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
            tenantName: signal('Al Nakheel').asReadonly(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'x@y.test', name: 'Huda Al-Harbi' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
          },
        },
        { provide: IdleService, useValue: { start: () => undefined, stop: () => undefined } },
      ],
    });
    TestBed.overrideComponent(TopbarComponent, {
      remove: { imports: [BreadcrumbComponent, NotificationBellComponent, LanguageToggleComponent] },
      add: { imports: [BreadcrumbStub, BellStub, LanguageToggleStub] },
    });
    TestBed.overrideComponent(AppShellComponent, {
      remove: { imports: [ImpersonationBannerComponent, IdleWarningComponent] },
      add: { imports: [BannerStub, IdleWarningStub] },
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);

    fixture = TestBed.createComponent(AppShellComponent);
    const host = fixture.nativeElement as HTMLElement;
    host.style.display = 'block';
    viewport = document.createElement('div');
    viewport.setAttribute('data-test-viewport', '');
    viewport.style.cssText = `position: fixed; top: 0; left: 0; width: ${width}px; height: 100vh; overflow: auto; z-index: 10000; background: #fff`;
    viewport.appendChild(host);
    document.body.appendChild(viewport);
    fixture.detectChanges();
    await TestBed.inject(Router).navigateByUrl('/workflows/template-1/stages');
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE);
    await settle();
    return host;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 2; i++) {
      fixture.detectChanges();
      for (const r of http.match(() => true)) r.flush([]);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 0));
    }
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    viewport?.remove();
  });

  /** Every element but <main> that scrolls vertically and has something to scroll. */
  function otherVerticalScrolls(host: HTMLElement, main: HTMLElement): string[] {
    return Array.from(host.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        if (el === main) return false;
        const oy = getComputedStyle(el).overflowY;
        return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} (${el.clientHeight}px showing ${el.scrollHeight}px)`);
  }

  /** Anything positioned in the page whose box is placed outside <main>, so main's scroll cannot hold it. */
  function escapingMain(main: HTMLElement): string[] {
    return Array.from(main.querySelectorAll<HTMLElement>('*'))
      .filter((el) => {
        const pos = getComputedStyle(el).position;
        if (pos !== 'absolute') return false;
        const parent = el.offsetParent;
        return !parent || (parent !== main && !main.contains(parent));
      })
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const c of CASES) {
      for (const panel of ['closed', 'open', 'transition'] as const) {
        it(`${c.name} [${lang}], panel ${panel}: <main> is the only vertical scroll, and the document is never taller than the window`, async () => {
          const host = await render(c.width, c.phone, lang);
          if (panel === 'open') {
            host.querySelectorAll<HTMLButtonElement>('[data-strip-card]')[1]!.click();
            await settle();
          }
          if (panel === 'transition') {
            host.querySelectorAll<HTMLButtonElement>('[data-testid="stage-expand"]')[1]!.click();
            await settle();
            host.querySelector<HTMLButtonElement>('[data-transition-row="t-1"] [data-tr-open]')!.click();
            await settle();
          }
          const main = host.querySelector<HTMLElement>('main')!;
          const shell = host.querySelector<HTMLElement>('.h-screen')!;
          const list = host.querySelector<HTMLElement>('app-workflow-stage-list app-data-list')!;

          // ── Non-vacuity ──
          if (panel === 'open') {
            expect(host.querySelector('[data-stage-panel] [data-who-modes]')).withContext('the panel is open, mode choice and all').not.toBeNull();
          }
          if (panel === 'transition') {
            expect(host.querySelector('[data-transition-panel] [data-pressed-by]')).withContext('the transition panel is open').not.toBeNull();
            expect(host.querySelector('[data-stage-panel]')).withContext('one panel at a time').toBeNull();
          }
          expect(main.scrollHeight).withContext('the page is taller than the window, so <main> must scroll').toBeGreaterThan(main.clientHeight + 50);
          expect(list.querySelectorAll('[data-testid="stage-edit"]').length).withContext('the list has its seven stages').toBe(NAMES.length);

          // ── Nothing scrolls sideways: not <main>, not a panel, not the strip at Fit ──
          const strip = host.querySelector<HTMLElement>('[data-strip-frame]')!;
          expect(strip.querySelector('[data-strip-card]')).withContext('non-vacuity: the strip has its cards').not.toBeNull();
          expect(strip.scrollWidth).withContext('the strip at Fit').toBeLessThanOrEqual(strip.clientWidth + 1);
          expect(main.scrollWidth).withContext('<main> sideways').toBeLessThanOrEqual(main.clientWidth + 1);
          for (const p of Array.from(host.querySelectorAll<HTMLElement>('[data-transition-panel], [data-stage-panel]'))) {
            expect(p.scrollWidth).withContext('a panel sideways').toBeLessThanOrEqual(p.clientWidth + 1);
            expect(p.getBoundingClientRect().right).withContext('a panel inside <main>').toBeLessThanOrEqual(main.getBoundingClientRect().right + 1);
            expect(p.getBoundingClientRect().left).withContext('a panel inside <main>').toBeGreaterThanOrEqual(main.getBoundingClientRect().left - 1);
          }

          // ── One vertical scroll ──
          expect(otherVerticalScrolls(host, main)).withContext('vertical scrolls besides <main>').toEqual([]);
          expect(escapingMain(main)).withContext('positioned outside <main>').toEqual([]);

          // ── The list is never squeezed: it shows every row ──
          const rows = Array.from(list.querySelectorAll<HTMLElement>('[data-testid="stage-edit"]'));
          const listBox = list.getBoundingClientRect();
          expect(listBox.height).withContext('the list has height').toBeGreaterThan(150);
          expect(rows[rows.length - 1]!.getBoundingClientRect().bottom).withContext('the last row shows inside the list').toBeLessThanOrEqual(listBox.bottom + 1);

          // ── Scrolled to the end, the window has not moved and the shell still fills it ──
          expect(viewport.scrollHeight).withContext('the document is no taller than the window').toBeLessThanOrEqual(viewport.clientHeight + 1);
          main.scrollTop = main.scrollHeight;
          viewport.scrollTop = viewport.scrollHeight;
          await new Promise((r) => requestAnimationFrame(() => r(null)));
          expect(viewport.scrollTop).withContext('the window never scrolls').toBe(0);
          expect(shell.getBoundingClientRect().bottom).withContext('the shell reaches the bottom of the window').toBeGreaterThanOrEqual(viewport.getBoundingClientRect().bottom - 1);
          expect(main.scrollTop).withContext('<main> scrolled to its end').toBeGreaterThan(0);
        }, 30000);
      }
    }
  }
});
