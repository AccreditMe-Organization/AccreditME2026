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
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';
import { RecordTasksPanelComponent } from './record-tasks-panel.component';
import { NO_ACTIONS, listPage, rows } from './record-tasks.fixtures';

// ACC-229 — the record Tasks panel and the All tasks list MEASURED, in both
// languages, in the real theme, font and translations (plan §2.5):
//
//   - the panel body is EXACTLY 294px English / 328px Arabic with 0, 3, 5 and
//     16 tasks — it never grows and never scrolls; header 42/46, rows 52/58,
//     footer 34/38;
//   - a long title and a long assignee name do not change a row's height, and
//     the due label is never cut;
//   - the popup's body at 1040 × 760 (the dialog's own header is 64/68 of it):
//     toolbar, chips, column header and footer stay put and ONLY the list
//     scrolls; at a phone's width the rows are cards and nothing scrolls
//     sideways.
//
// NON-VACUITY FIRST (ACC-120): every measure asserts the thing is laid out, in
// the real font, before a number is allowed to mean anything.

const API = `${environment.apiUrl}/tasks`;
const PANEL_WIDTH = 400; // one of three panels in a row on a 1240 page

const LONG = {
  title: {
    en: 'Collect sharps-disposal audit forms from every ward in Tower A and Tower B before the quarterly review',
    ar: 'جمع نماذج تدقيق التخلص من الأدوات الحادة من كل أجنحة البرج A والبرج B قبل المراجعة الربعية',
  },
  name: 'Dr. Abdulrahman bin Abdulaziz Al-Qahtani Al-Shahrani',
};

const EXPECT = {
  en: { head: 42, body: 294, row: 52, foot: 34, popupHead: 64 },
  ar: { head: 46, body: 328, row: 58, foot: 38, popupHead: 68 },
};

@Component({
  standalone: true,
  imports: [RecordTasksPanelComponent],
  template: `<div [style.width.px]="width()">
    <app-record-tasks-panel sourceType="COMMITTEE" sourceId="c-1" recordName="Infection Control" [canCreate]="true" />
  </div>`,
})
class PanelHost {
  readonly width = input(PANEL_WIDTH);
}

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<div class="flex flex-col" [style.width.px]="width()" [style.height.px]="height()">
    <app-task-list-view sourceType="COMMITTEE" sourceId="c-1" />
  </div>`,
})
class ListHost {
  readonly width = input(1040);
  readonly height = input(760 - 64);
}

describe('Record tasks panel and All tasks — layout, measured (ACC-229)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let http: HttpTestingController;

  afterAll(() => {
    console.log(`ACC-229 measurements:\n  ${measured.join('\n  ')}`);
  });

  function configure(language: 'en' | 'ar'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [PanelHost, ListHost],
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

  // A row of every kind the panel draws: overdue, soon, on hold, a request, a
  // pool, rejected, completed — with a button and a ⋯ on each.
  function variedRows(n: number, language: 'en' | 'ar'): ITaskRecordRowDto[] {
    const day = 86_400_000;
    return rows(n, (i) => {
      const kinds: Partial<ITaskRecordRowDto>[] = [
        { title: LONG.title[language], dueAt: new Date(Date.now() - 4 * day).toISOString(), requirement: 'REQUIRED', actions: { ...NO_ACTIONS, start: true, primary: 'START' } },
        { dueAt: new Date(Date.now() + day).toISOString(), assignees: [{ id: 'x', name: LONG.name, positionNameEn: 'Infection Control Nurse', positionNameAr: null }], actions: { ...NO_ACTIONS, complete: true, completeNeedsEvidence: true, primary: 'COMPLETE' } },
        { status: 'ON_HOLD', onHoldUntil: new Date(Date.now() + 6 * day).toISOString(), actions: { ...NO_ACTIONS, resume: true, primary: 'RESUME' } },
        { requirement: 'OPTIONAL', openRequest: { id: 'r', type: 'EXTENSION', requestedDueAt: new Date(Date.now() + 9 * day).toISOString(), holdUntil: null, requestedById: 'x', requestedByName: LONG.name, reason: 'Waiting for the lab', createdAt: new Date().toISOString() }, actions: { ...NO_ACTIONS, reviewRequest: true, primary: 'REVIEW_REQUEST' } },
        { assignees: [], waitingInPool: true, pool: { kind: 'COMMITTEE_ROLE', positionNameEn: null, positionNameAr: null, orgUnitNameEn: null, orgUnitNameAr: null, roleLabelEn: 'Secretary', roleLabelAr: 'أمين السر', committeeNameEn: 'Infection Prevention & Control Committee', committeeNameAr: null }, actions: { ...NO_ACTIONS, pickUp: true, primary: 'PICK_UP' } },
        { status: 'REJECTED', rejectedReason: 'Not my unit — this belongs to Facilities Engineering, who own the ward ventilation.' },
        { status: 'COMPLETED', completedAt: new Date(Date.now() - 2 * day).toISOString() },
      ];
      return kinds[i % kinds.length]!;
    });
  }

  for (const language of ['en', 'ar'] as const) {
    describe(language === 'en' ? 'English' : 'Arabic', () => {
      const want = EXPECT[language];

      for (const count of [0, 3, 5, 16]) {
        it(`the panel body is exactly ${want.body}px with ${count} task${count === 1 ? '' : 's'}, and never scrolls`, async () => {
          configure(language);
          const fixture = TestBed.createComponent(PanelHost);
          fixture.autoDetectChanges(true);
          document.body.appendChild(fixture.nativeElement);
          const shown = variedRows(Math.min(count, 5), language);
          http.expectOne((r) => r.url === `${API}/record-panel`).flush({ total: count, scope: 'all', rows: shown });
          await settle(fixture);

          const el = fixture.nativeElement as HTMLElement;
          const body = el.querySelector<HTMLElement>('[data-testid="record-tasks-body"]')!;
          const head = el.querySelector<HTMLElement>('[data-testid="record-tasks-head"]')!;
          // Non-vacuity: laid out, in the real font, with the rows it was given.
          expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
          expect(head.getBoundingClientRect().height).withContext('the panel is not laid out').toBeGreaterThan(0);
          expect(el.querySelectorAll('[data-task-row]').length).withContext('rows rendered').toBe(Math.min(count, 5));

          const bodyH = body.getBoundingClientRect().height;
          measured.push(`${language} panel, ${count} tasks: header ${head.getBoundingClientRect().height}, body ${bodyH}`);
          expect(head.getBoundingClientRect().height).toBe(want.head);
          expect(bodyH).toBe(want.body);
          expect(body.scrollHeight).withContext('the body must not overflow').toBeLessThanOrEqual(body.clientHeight);

          for (const row of Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]'))) {
            expect(row.getBoundingClientRect().height).withContext('a row').toBe(want.row);
            const due = row.querySelector<HTMLElement>('.am-rtp__due')!;
            expect(due.scrollWidth).withContext(`the due label is cut: "${due.textContent}"`).toBeLessThanOrEqual(due.clientWidth);
          }
          const foot = el.querySelector<HTMLElement>('[data-testid="record-tasks-foot"]');
          if (count > 5) {
            expect(foot!.getBoundingClientRect().height).toBe(want.foot);
            expect(foot!.getBoundingClientRect().bottom).withContext('the footer sits at the bottom of the body').toBe(body.getBoundingClientRect().bottom);
            measured.push(`${language} panel footer ${foot!.getBoundingClientRect().height}, rows ${want.row}`);
          } else {
            expect(foot).toBeNull();
          }
          fixture.nativeElement.remove();
        });
      }

      it('the popup at 1040 × 760: only the list scrolls; the fixed parts stay put', async () => {
        configure(language);
        const fixture = TestBed.createComponent(ListHost);
        fixture.componentRef.setInput('height', 760 - want.popupHead);
        document.body.appendChild(fixture.nativeElement);
        fixture.autoDetectChanges(true);
        const view = fixture.debugElement.query((d) => d.componentInstance instanceof TaskListViewComponent)!
          .componentInstance as TaskListViewComponent;
        view.phone.set(false);
        http.expectOne((r) => r.url === `${API}/record-list`).flush(listPage(variedRows(50, language), { total: 120, matching: 120 }));
        await settle(fixture);

        const el = fixture.nativeElement as HTMLElement;
        const part = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
        const scroll = part('task-list-scroll');
        expect(el.querySelectorAll('[data-task-row]').length).withContext('rows rendered').toBe(50);
        expect(scroll.getBoundingClientRect().height).withContext('the list is not laid out').toBeGreaterThan(0);

        const h = (id: string) => Math.round(part(id).getBoundingClientRect().height);
        measured.push(
          `${language} popup body at 1040 × ${760 - want.popupHead}: toolbar ${h('task-list-toolbar')}, chips ${h('task-list-chips')}, ` +
            `column header ${h('task-list-head')}, list ${h('task-list-scroll')}, footer ${h('task-list-foot')}`,
        );
        // Only the list scrolls.
        const scrollers = Array.from(el.querySelectorAll<HTMLElement>('*')).filter(
          (n) => n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== 'visible' && getComputedStyle(n).overflowY !== 'hidden',
        );
        expect(scrollers).toEqual([scroll]);
        // The column header is sticky inside the list, so it stays put as it scrolls.
        const headTop = part('task-list-head').getBoundingClientRect().top;
        scroll.scrollTop = 400;
        await settle(fixture);
        expect(part('task-list-head').getBoundingClientRect().top).toBe(headTop);
        // Every row is at least the drawn height, and the whole column set fits the minimum row.
        for (const row of Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]')).slice(0, 7)) {
          expect(row.getBoundingClientRect().height).toBeGreaterThanOrEqual(language === 'en' ? 52 : 58);
        }
        expect(part('task-list-foot').getBoundingClientRect().height).toBe(language === 'en' ? 44 : 48);
        fixture.nativeElement.remove();
      });

      it('the phone sheet: two-line card rows, nothing scrolls sideways', async () => {
        configure(language);
        const fixture = TestBed.createComponent(ListHost);
        fixture.componentRef.setInput('width', 390);
        fixture.componentRef.setInput('height', 844 - want.popupHead);
        document.body.appendChild(fixture.nativeElement);
        fixture.autoDetectChanges(true);
        const view = fixture.debugElement.query((d) => d.componentInstance instanceof TaskListViewComponent)!
          .componentInstance as TaskListViewComponent;
        view.phone.set(true);
        http.expectOne((r) => r.url === `${API}/record-list`).flush(listPage(variedRows(12, language)));
        await settle(fixture);

        const el = fixture.nativeElement as HTMLElement;
        const scroll = el.querySelector<HTMLElement>('[data-testid="task-list-scroll"]')!;
        expect(el.querySelectorAll('[data-task-row]').length).toBe(12);
        expect(el.querySelector('[data-testid="task-list-head"]')).withContext('no column header on a phone').toBeNull();
        expect(scroll.scrollWidth).withContext('sideways scroll on a phone').toBeLessThanOrEqual(scroll.clientWidth);
        const heights = Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]')).map((r) => Math.round(r.getBoundingClientRect().height));
        measured.push(`${language} phone rows at 390: ${Math.min(...heights)}–${Math.max(...heights)}`);
        expect(Math.min(...heights)).toBeGreaterThanOrEqual(language === 'en' ? 60 : 64);
        fixture.nativeElement.remove();
      });
    });
  }
});
