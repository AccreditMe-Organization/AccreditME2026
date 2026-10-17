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
import { ITaskRecordRowDto } from '../../services/task.service';
import { TaskListViewComponent } from './task-list-view.component';
import { NO_ACTIONS, listPage, rows } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-234 — the All tasks list's COLUMNS, MEASURED in the real theme, font and
// translations, at the widths /tasks/all draws it (measured on the page: a
// 1280 window gives a 988px list, 1440 → 1148, 1920 → 1628) and in the See all
// popup at 1040 × 760, in English and Arabic:
//
//   - every header label starts where its column's cells start, in every row
//     — rows with a next-step button and rows without — within 1px;
//   - the action column is the same width in every row, button or not;
//   - no cell's text paints outside its track (an ellipsis is the only cut
//     allowed, and only on a name, whose whole text is its tooltip);
//   - Due puts the date on line 2 when one line does not fit, never overflowing;
//   - no toolbar label is cut.
//
// The three faults these catch, as they were seen live (ACC-234): a Due text
// painting into Created by; rows laid out per row, so a row with Start was
// shifted against one without; and "Required or …" cut in the toolbar.
//
// NON-VACUITY FIRST (ACC-120): every measure asserts the thing is laid out, in
// the real font, with the rows it was given, before a number may mean anything.

const API = `${environment.apiUrl}/tasks/record-list`;
const DAY = 86_400_000;
const LONG = {
  title: {
    en: 'Collect sharps-disposal audit forms from every ward in Tower A and Tower B before the quarterly review',
    ar: 'جمع نماذج تدقيق التخلص من الأدوات الحادة من كل أجنحة البرج A والبرج B قبل المراجعة الربعية',
  },
  name: 'Dr. Abdulrahman bin Abdulaziz Al-Qahtani Al-Shahrani',
};

const CASES = [
  { name: '/tasks/all at 1280', variant: 'page', width: 988, height: 700 },
  { name: '/tasks/all at 1440', variant: 'page', width: 1148, height: 700 },
  { name: '/tasks/all at 1920', variant: 'page', width: 1628, height: 700 },
  { name: 'See all at 1040 × 760', variant: 'popup', width: 1040, height: 0 },
] as const;
const POPUP_HEAD = { en: 64, ar: 68 };

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<div class="flex flex-col" [style.width.px]="width()" [style.height.px]="height()">
    <app-task-list-view sourceType="COMMITTEE" sourceId="c-1" [variant]="variant()" />
  </div>`,
})
class ListHost {
  readonly width = input(1040);
  readonly height = input(700);
  readonly variant = input<'page' | 'popup'>('popup');
}

/** Every kind of row the list draws: with and without a next step, overdue, long text. */
function variedRows(language: 'en' | 'ar'): ITaskRecordRowDto[] {
  const kinds: Partial<ITaskRecordRowDto>[] = [
    { title: LONG.title[language], dueAt: new Date(Date.now() - 23 * DAY).toISOString(), requirement: 'REQUIRED', actions: { ...NO_ACTIONS, start: true, primary: 'START' } },
    { dueAt: new Date(Date.now() - 23 * DAY).toISOString() },
    { assignees: [{ id: 'x', name: LONG.name, positionNameEn: 'Infection Control Nurse Specialist, Night Shift', positionNameAr: null }], createdBy: { id: 'c', name: LONG.name }, actions: { ...NO_ACTIONS, complete: true, completeNeedsEvidence: true, primary: 'COMPLETE' } },
    { dueAt: new Date(Date.now() + 2 * DAY).toISOString() },
    { status: 'ON_HOLD', onHoldUntil: new Date(Date.now() + 6 * DAY).toISOString(), dueAt: new Date(Date.now() + 9 * DAY).toISOString(), actions: { ...NO_ACTIONS, resume: true, primary: 'RESUME' } },
    { openRequest: { id: 'r', type: 'EXTENSION', requestedDueAt: new Date(Date.now() + 9 * DAY).toISOString(), holdUntil: null, requestedById: 'x', requestedByName: LONG.name, reason: 'Waiting for the lab', createdAt: new Date().toISOString() }, actions: { ...NO_ACTIONS, reviewRequest: true, primary: 'REVIEW_REQUEST' } },
    { assignees: [], waitingInPool: true, pool: { kind: 'COMMITTEE_ROLE', positionNameEn: null, positionNameAr: null, orgUnitNameEn: null, orgUnitNameAr: null, roleLabelEn: 'Secretary', roleLabelAr: 'أمين السر', committeeNameEn: 'Infection Prevention & Control Committee', committeeNameAr: null }, actions: { ...NO_ACTIONS, pickUp: true, primary: 'PICK_UP' } },
    { status: 'COMPLETED', completedAt: new Date(Date.now() - 2 * DAY).toISOString() },
    { status: 'CANCELLED', cancelledAt: new Date(Date.now() - 5 * DAY).toISOString() },
    { dueAt: null },
  ];
  return rows(30, (i) => kinds[i % kinds.length]!);
}

interface Measured {
  drift: number[];
  overflow: string[];
  actionWidths: number[];
  cut: string[];
  dueTwoParts: { sameLine: boolean; dateBelow: boolean }[];
  untitledCuts: string[];
}

/** The page's own measurement, as the browser proof runs it. */
function measure(root: HTMLElement): Measured {
  const rtl = getComputedStyle(root).direction === 'rtl';
  const start = (r: DOMRect) => (rtl ? r.right : r.left);
  const head = root.querySelector<HTMLElement>('[data-testid="task-list-head"]')!;
  const rowEls = Array.from(root.querySelectorAll<HTMLElement>('[data-task-row]'));
  const headCells = Array.from(head.children) as HTMLElement[];
  const labelOf = (cell: HTMLElement) => cell.querySelector<HTMLElement>('.am-sh__label') ?? cell;
  const drift = headCells.map((h, i) => {
    const want = start(labelOf(h).getBoundingClientRect());
    return Math.max(0, ...rowEls.map((r) => Math.abs(start((r.children[i] as HTMLElement).getBoundingClientRect()) - want)));
  });
  // An ellipsis is the one allowed cut; any other clipping still counts.
  const ellipsis = (el: Element) => {
    const c = getComputedStyle(el);
    return ['hidden', 'clip'].includes(c.overflowX) && c.textOverflow === 'ellipsis';
  };
  const overflow: string[] = [];
  const untitledCuts: string[] = [];
  for (const r of rowEls) {
    Array.from(r.children).forEach((cell, col) => {
      const box = cell.getBoundingClientRect();
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
      for (let t = walker.nextNode(); t; t = walker.nextNode()) {
        const text = t.textContent!.trim();
        if (!text) continue;
        let cutBy: Element | null = null;
        for (let a = t.parentElement; a; a = a.parentElement) {
          if (ellipsis(a)) {
            cutBy = a;
            break;
          }
          if (a === cell) break;
        }
        if (cutBy) {
          // A name that is cut keeps its whole text in a tooltip.
          if (cutBy.scrollWidth > cutBy.clientWidth + 1 && !cutBy.closest('[title]')?.getAttribute('title')?.includes(text)) untitledCuts.push(text);
          continue;
        }
        const range = document.createRange();
        range.selectNodeContents(t);
        for (const rect of Array.from(range.getClientRects())) {
          if (rect.width && (rect.left < box.left - 0.5 || rect.right > box.right + 0.5)) {
            overflow.push(`column ${col}: "${text.slice(0, 40)}" by ${Math.round(Math.max(box.left - rect.left, rect.right - box.right))}px`);
          }
        }
      }
    });
  }
  const act = headCells.length - 1;
  const actionWidths = [head, ...rowEls].map((r) => Math.round((r.children[act] as HTMLElement).getBoundingClientRect().width));
  const toolbar = root.querySelector<HTMLElement>('[data-testid="task-list-toolbar"]')!;
  const cut = Array.from(toolbar.querySelectorAll<HTMLElement>('.am-overlay-select-label, button'))
    .filter((el) => el.offsetParent && el.scrollWidth > el.clientWidth + 1)
    .map((el) => el.textContent!.trim());
  const dueTwoParts = Array.from(root.querySelectorAll<HTMLElement>('[data-testid="task-list-due"]'))
    .map((d) => Array.from(d.querySelectorAll<HTMLElement>('.am-tl__part')))
    .filter((p) => p.length === 2)
    .map(([a, b]) => {
      const ra = a!.getBoundingClientRect();
      const rb = b!.getBoundingClientRect();
      return { sameLine: Math.abs(ra.top - rb.top) < 1, dateBelow: rb.top >= ra.bottom - 1 };
    });
  return { drift, overflow, actionWidths, cut, dueTwoParts, untitledCuts };
}

describe('All tasks list — columns, measured (ACC-234)', () => {
  preserveDocumentLanguage();
  const report: string[] = [];
  let http: HttpTestingController;

  afterAll(() => console.log(`ACC-234 measurements:\n  ${report.join('\n  ')}`));

  function configure(language: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ListHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    await fixture.whenStable();
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  }

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      for (const c of CASES) {
        it(`${c.name}: headers sit over their columns, nothing overflows its track, no toolbar label is cut`, async () => {
          configure(language);
          const fixture = TestBed.createComponent(ListHost);
          fixture.componentRef.setInput('width', c.width);
          fixture.componentRef.setInput('height', c.variant === 'popup' ? 760 - POPUP_HEAD[language] : c.height);
          fixture.componentRef.setInput('variant', c.variant);
          document.body.appendChild(fixture.nativeElement);
          fixture.autoDetectChanges(true);
          const view = fixture.debugElement.query((d) => d.componentInstance instanceof TaskListViewComponent)!.componentInstance as TaskListViewComponent;
          view.phone.set(false);
          http.expectOne((r) => r.url === API).flush(listPage(variedRows(language), { total: 120, matching: 120 }));
          await settle(fixture);

          const root = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="task-list-view"]')!;
          const rowEls = Array.from(root.querySelectorAll<HTMLElement>('[data-task-row]'));
          // Non-vacuity: laid out, in the real font, with every kind of row.
          expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
          expect(rowEls.length).withContext('rows rendered').toBe(30);
          expect(root.querySelector('[data-testid="task-list-head"]')!.getBoundingClientRect().width).withContext('the list is not laid out').toBeGreaterThan(900);
          expect(rowEls.filter((r) => r.querySelector('[data-action]')).length).withContext('rows with a next step').toBeGreaterThan(5);
          expect(rowEls.filter((r) => !r.querySelector('[data-action]')).length).withContext('rows without one').toBeGreaterThan(5);
          expect(rowEls.filter((r) => r.querySelector('[data-tone="danger"]')).length).withContext('overdue rows').toBeGreaterThan(2);

          const m = measure(root);
          expect(m.dueTwoParts.length).withContext('two-part due texts to measure').toBeGreaterThan(5);
          report.push(
            `${language} ${c.name}: header drift max ${Math.max(...m.drift).toFixed(2)}px [${m.drift.map((d) => d.toFixed(1)).join(' ')}], ` +
              `action ${[...new Set(m.actionWidths)].join('/')}px, overflow ${m.overflow.length}, cut toolbar labels ${m.cut.length}, ` +
              `two-part due on one line ${m.dueTwoParts.filter((d) => d.sameLine).length}/${m.dueTwoParts.length}`,
          );

          m.drift.forEach((d, i) => expect(d).withContext(`column ${i}: its header label and its cells start ${d.toFixed(2)}px apart`).toBeLessThanOrEqual(1));
          expect(new Set(m.actionWidths).size).withContext(`the action column is not one width: ${m.actionWidths.join(',')}`).toBe(1);
          expect(m.overflow).withContext('text painting outside its track').toEqual([]);
          expect(m.untitledCuts).withContext('a cut name with no tooltip').toEqual([]);
          expect(m.cut).withContext('a cut toolbar label').toEqual([]);
          for (const d of m.dueTwoParts) expect(d.sameLine || d.dateBelow).withContext('the date is on line 2 when it does not fit').toBe(true);
          fixture.nativeElement.remove();
        });
      }
    });
  }
});
