import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
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
import { WorkflowStageListComponent } from './workflow-stage-list.component';

// ACC-254 (ACC-255 PR 3, plan §10.1) — /workflows/:id/stages, MEASURED in the
// real theme, font and translations, at the widths the page's content column
// has in a 1280, 1440 and 1920 window (the same main column the All tasks list
// measures: 988, 1148, 1628), in English and Arabic, with a stage expanded:
//
//   - nothing on the page scrolls sideways;
//   - every header label starts where its column's cells start, in every row,
//     within 1px — the stage row's tracks are all fixed or fr;
//   - the actions cell (Edit and the ⋯) fits its track;
//   - the transition table inside the expanded row stays inside its column.
//
// ACC-255 PR 4a — the rows as the Workflow Setup drawing has them (section 3):
// # · Stage (meaning chips under the name) · Allows · Details, and one column
// on a phone (390, less its 16px gutters: 358).
//
// What it caught as built (ACC-254): the actions cell — up, down, Edit and
// remove — spilled out of data-list's 88px track into the scroller, which
// scrolled sideways, and the expand track was 'auto', so header and rows
// misaligned.
//
// NON-VACUITY FIRST (ACC-120): the rows exist, the header has a label per
// column, and the column starts are distinct and in order, before "they match"
// may mean anything.

const CASES = [
  { name: 'at 1280', width: 988 },
  { name: 'at 1440', width: 1148 },
  { name: 'at 1920', width: 1628 },
  { name: 'at 390', width: 358 },
] as const;

/** The seeded committee stages' actions and meanings (Workflow Setup, section 2; ACC-255 PR 2). */
const MEMBERS = ['add_member', 'remove_member', 'change_member_role'];
const SEEDED: { actions: string[]; flags: string[] }[] = [
  { actions: ['edit_details', ...MEMBERS], flags: [] },
  { actions: [...MEMBERS], flags: [] },
  { actions: [...MEMBERS, 'request_change'], flags: ['IN_FORCE'] },
  { actions: [...MEMBERS, 'request_change'], flags: ['IN_FORCE'] },
  { actions: [...MEMBERS], flags: ['DISSOLVING'] },
  { actions: [], flags: ['DISSOLVING'] },
];
const RECORD_ACTIONS = ['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change'].map((key) => ({
  key,
  labelKey: `workflow.recordAction.COMMITTEE.${key}`,
}));
const STAGE_FLAGS = [
  { key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' },
  { key: 'IN_FORCE', labelKey: 'workflow.stageFlag.IN_FORCE', cardinality: 'any' },
  { key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' },
];

const LONG = {
  en: 'Executive Committee Terms of Reference Review and Final Sign-off by the Board',
  ar: 'مراجعة النظام الداخلي للجنة التنفيذية والاعتماد النهائي من مجلس الإدارة',
};

function stage(i: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: `stage-${i}`,
    workflowTemplateId: 'template-1',
    key: null,
    nameEn: i === 2 ? LONG.en : `Stage ${i}`,
    nameAr: i === 2 ? LONG.ar : `المرحلة ${i}`,
    description: null,
    order: i * 10,
    slaWorkingHours: i % 2 ? 40 : null,
    isInitial: i === 1,
    isFinal: i === 6,
    approvalMode: ['SINGLE', 'SEQUENTIAL', 'PARALLEL', 'COMMITTEE'][i % 4],
    parallelThreshold: null,
    committeeId: null,
    assigneeStrategy: ['ROLE', 'POSITION_FIXED', 'ORG_UNIT_HEAD', 'COMMITTEE', 'SPECIFIC_USER', 'SELF'][i % 6],
    assigneeUserId: null,
    assigneeRoleId: null,
    assigneeCommitteeRoleValueId: null,
    assigneePositionId: null,
    assigneeOrgUnitId: null,
    escalationConfig: null,
    actions: SEEDED[i - 1]!.actions,
    flags: SEEDED[i - 1]!.flags,
    // Stage 1 is the expanded one, and its Tasks on entry list reports its own
    // count back to the row; stage 3 carries a count the row reads as sent.
    taskDefinitionCount: i === 3 ? 1 : 0,
    transitions:
      i === 1
        ? [
            {
              id: 't-1',
              fromStageId: 'stage-1',
              toStageId: 'stage-2',
              labelEn: 'Submit the terms of reference to the Board for its final approval',
              labelAr: 'إرسال النظام الداخلي إلى مجلس الإدارة لاعتماده النهائي',
              requiredPermission: 'committees:manage',
              triggerCondition: 'ASSIGNEE_POOL',
              triggerUserId: null,
              triggerRoleId: null,
              validatorConfig: null,
              isApprovalPath: false,
              kind: 'RETURN',
            },
            {
              // The longest chips of each column (measured, ACC-255 PR 4a):
              // "End the record" and "Any Authenticated User".
              id: 't-2',
              fromStageId: 'stage-1',
              toStageId: 'stage-2',
              labelEn: 'Withdraw the committee proposal before the Board has considered it',
              labelAr: 'سحب مقترح اللجنة قبل أن ينظر فيه مجلس الإدارة',
              requiredPermission: null,
              triggerCondition: 'ANY_AUTHENTICATED',
              triggerUserId: null,
              triggerRoleId: null,
              validatorConfig: null,
              isApprovalPath: false,
              kind: 'EXIT',
            },
          ]
        : [],
    ...over,
  };
}

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee lifecycle',
  nameAr: 'دورة حياة اللجنة',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  recordActions: RECORD_ACTIONS,
  stageFlags: STAGE_FLAGS,
  recordFields: [],
  recordRoutes: { unit: false, committee: false },
  stages: [1, 2, 3, 4, 5, 6].map((i) => stage(i)),
};

@Component({
  standalone: true,
  imports: [WorkflowStageListComponent],
  template: `<div class="flex flex-col" data-host [style.width.px]="width()" style="height: 900px">
    <app-workflow-stage-list />
  </div>`,
})
class StagesHost {
  readonly width = input(988);
}

describe('WorkflowStageListComponent — the stages page fits its column (ACC-254)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<StagesHost>;
  let http: HttpTestingController;

  async function render(width: number, lang: 'en' | 'ar', over: Partial<typeof TEMPLATE> = {}): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [StagesHost],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ templateId: 'template-1' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StagesHost);
    fixture.componentRef.setInput('width', width);
    // The phone layout follows the window's width; set it here, as the
    // committees list spec does, so each case is the layout it names.
    fixture.debugElement.query(By.directive(WorkflowStageListComponent)).componentInstance.phone.set(width < 400);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush({ ...TEMPLATE, ...over });
    fixture.detectChanges();
    // Expand the stage with the long transition, as a person does.
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="stage-expand"]')!.click();
    fixture.detectChanges();
    drain();
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  /** Answer whatever else the page and its expanded row ask for with nothing. */
  function drain(): void {
    for (const r of http.match(() => true)) {
      r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []);
    }
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
  });

  for (const lang of ['en', 'ar'] as const) {
    for (const c of CASES) {
      it(`${c.name} [${lang}]: no sideways scroll, header over its cells, actions and transitions inside their columns`, async () => {
        const host = await render(c.width, lang);
        const rtl = lang === 'ar';
        const startOf = (el: Element) => {
          const r = el.getBoundingClientRect();
          return rtl ? r.right : r.left;
        };

        const grids = Array.from(host.querySelectorAll<HTMLElement>('[style*="--am-list-cols"]')).filter(
          (g) => g.getAttribute('style')!.includes('grid-template-columns'),
        );
        const header = grids.find((g) => g.getAttribute('role') === 'row')!;
        const rows = grids.filter((g) => g !== header);

        // ── Non-vacuity ──
        expect(header).withContext('the header row').toBeDefined();
        expect(rows.length).withContext('one grid per stage').toBe(6);
        const headCells = Array.from(header.children) as HTMLElement[];
        const phone = c.width < 400;
        expect(headCells.length)
          .withContext(phone ? 'stage, actions' : '#, stage, allows, details, actions')
          .toBe(phone ? 2 : 5);
        const starts = headCells.map(startOf);
        for (let i = 1; i < starts.length; i++) {
          const ahead = rtl ? starts[i - 1]! > starts[i]! : starts[i]! > starts[i - 1]!;
          expect(ahead).withContext(`column ${i} starts after column ${i - 1}`).toBeTrue();
        }
        expect(host.getBoundingClientRect().width).toBeCloseTo(c.width, 0);

        // ── No sideways scroll, anywhere in the page ──
        const sideways = [host, ...Array.from(host.querySelectorAll<HTMLElement>('*'))].filter((el) => {
          const ox = getComputedStyle(el).overflowX;
          // The transition table's own frame may scroll on a phone (ACC-254's
          // allowance); at desktop widths it must not either.
          if (c.width < 400 && el.closest('[data-tr-scroll]')) return false;
          // ACC-255 PR 4b — the flow strip scrolls sideways inside its own frame
          // at any width (Templates 6b); its own spec holds the page to that.
          if (el.hasAttribute('data-strip-frame')) return false;
          return (ox === 'auto' || ox === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        });
        expect(sideways.map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80))).withContext('scrolls sideways').toEqual([]);
        expect(host.scrollWidth).withContext('the page').toBeLessThanOrEqual(c.width + 1);

        // ── Header over its cells, every row, within 1px ──
        for (const [i, row] of rows.entries()) {
          const cells = Array.from(row.children) as HTMLElement[];
          expect(cells.length).withContext(`row ${i} cells`).toBe(headCells.length);
          cells.forEach((cell, col) => {
            expect(Math.abs(startOf(cell) - starts[col]!)).withContext(`row ${i}, column ${col}`).toBeLessThanOrEqual(1);
          });
        }

        // ── The actions cell fits its track ──
        for (const cell of Array.from(host.querySelectorAll<HTMLElement>('[data-testid="stage-actions"]'))) {
          expect(cell.scrollWidth).withContext('actions cell').toBeLessThanOrEqual(cell.clientWidth + 1);
          const track = cell.getBoundingClientRect();
          for (const child of Array.from(cell.children)) {
            const r = child.getBoundingClientRect();
            expect(r.left).withContext('actions inside the track (left)').toBeGreaterThanOrEqual(track.left - 1);
            expect(r.right).withContext('actions inside the track (right)').toBeLessThanOrEqual(track.right + 1);
          }
        }

        // ── ACC-255 PR 4a: every Stage, Allows and Details cell fits its column ──
        for (const key of ['stage', 'allows', 'details']) {
          const cells = Array.from(host.querySelectorAll<HTMLElement>(`[data-cell="${key}"]`));
          expect(cells.length).withContext(`one ${key} cell per stage`).toBe(6);
          for (const cell of cells) {
            const box = cell.getBoundingClientRect();
            const column = cell.closest<HTMLElement>('[style*="grid-template-columns"]')!.getBoundingClientRect();
            expect(box.left).withContext(`${key} inside its row (left)`).toBeGreaterThanOrEqual(column.left - 1);
            expect(box.right).withContext(`${key} inside its row (right)`).toBeLessThanOrEqual(column.right + 1);
          }
        }
        // The meaning chips stay on one line each.
        for (const chip of Array.from(host.querySelectorAll<HTMLElement>('.am-stage-meaning'))) {
          expect(chip.getBoundingClientRect().height).withContext(`chip "${chip.textContent!.trim()}" on one line`).toBeLessThan(24);
        }

        // ── The transition table stays inside its column ──
        const table = host.querySelector<HTMLElement>('[data-tr-scroll]');
        expect(table).withContext('the expanded row shows its transitions').not.toBeNull();
        const column = table!.closest<HTMLElement>('app-workflow-transition-editor')!.getBoundingClientRect();
        const box = table!.getBoundingClientRect();
        expect(box.right).withContext('table right edge').toBeLessThanOrEqual(column.right + 1);
        expect(box.left).withContext('table left edge').toBeGreaterThanOrEqual(column.left - 1);

        // ── ACC-255 PR 4a (ACC-265 item 3): the table reads whole ──
        const labels = Array.from(host.querySelectorAll<HTMLElement>('[data-tr-label], [data-tr-to]'));
        expect(labels.length).withContext('non-vacuity: two transitions, name and destination').toBe(4);
        for (const cell of labels) {
          // The whole text is drawn: it wraps, and nothing is clipped or cut.
          expect(getComputedStyle(cell).textOverflow).withContext('no ellipsis').not.toBe('ellipsis');
          expect(cell.scrollWidth).withContext(`"${cell.textContent!.trim()}" not clipped`).toBeLessThanOrEqual(cell.clientWidth + 1);
          expect(cell.scrollHeight).withContext(`"${cell.textContent!.trim()}" not cut`).toBeLessThanOrEqual(cell.clientHeight + 1);
        }
        const oneLine = (el: HTMLElement) => {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = Array.from(range.getClientRects());
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize) * 1.5;
          const spread = Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top));
          return rects.length > 0 && spread < lineHeight / 2;
        };
        for (const chip of Array.from(host.querySelectorAll<HTMLElement>('[data-tr-trigger], [data-tr-kind]'))) {
          expect(oneLine(chip)).withContext(`chip "${chip.textContent!.trim()}" on one line`).toBeTrue();
          if (c.width < 400) continue;
          const cell = chip.closest('td')!.getBoundingClientRect();
          const r = chip.getBoundingClientRect();
          expect(r.left).withContext(`chip "${chip.textContent!.trim()}" inside its cell (left)`).toBeGreaterThanOrEqual(cell.left - 1);
          expect(r.right).withContext(`chip "${chip.textContent!.trim()}" inside its cell (right)`).toBeLessThanOrEqual(cell.right + 1);
        }
        // Transitions stack above Tasks on entry until each can be about 660px:
        // side by side only at 1920 (Ahmad, Q4).
        const editor = host.querySelector<HTMLElement>('app-workflow-transition-editor')!.getBoundingClientRect();
        const tasks = host.querySelector<HTMLElement>('app-stage-task-list')!.getBoundingClientRect();
        const sideBySide = Math.abs(editor.top - tasks.top) < 1;
        expect(sideBySide).withContext('side by side only at 1920').toBe(c.width === 1628);
      });
    }
  }

  it('the trigger reads in words, never its code', async () => {
    const host = await render(1148, 'en');
    const text = host.textContent!;
    for (const code of ['ASSIGNEE_POOL', 'ROLE_BASED', 'SINGLE', 'POSITION_FIXED']) {
      expect(text).withContext(code).not.toContain(code);
    }
    expect(host.querySelector('[data-tr-trigger]')!.textContent!.trim()).toBe('Assignee pool');
  });

  // ACC-255 PR 4a — the rows as drawn: meanings in words under the name, what
  // the stage allows as a counted string (the action names as its tooltip and
  // accessible name), and what the row expands to.
  for (const [lang, want] of [
    [
      'en',
      {
        allows: ['Allows 4 of 5 actions', 'Allows 3 of 5 actions', 'Allows 4 of 5 actions', 'Allows 4 of 5 actions', 'Allows 3 of 5 actions', 'Allows nothing'],
        meanings: [[], [], ['Record is in force'], ['Record is in force'], ['Dissolving'], ['Dissolving']],
        tip: 'Allows: Edit details, Add member, Remove member, Change member role',
        details: ['2 transitions', 'No exits', 'No exits · 1 task on entry', 'No exits', 'No exits', 'No exits'],
      },
    ],
    [
      'ar',
      {
        allows: ['يسمح بـ 4 من 5 إجراءات', 'يسمح بـ 3 من 5 إجراءات', 'يسمح بـ 4 من 5 إجراءات', 'يسمح بـ 4 من 5 إجراءات', 'يسمح بـ 3 من 5 إجراءات', 'لا يسمح بشيء'],
        meanings: [[], [], ['السجل نافذ'], ['السجل نافذ'], ['قيد الحل'], ['قيد الحل']],
        tip: 'يسمح بـ: تعديل التفاصيل، إضافة عضو، إزالة عضو، تغيير دور العضو',
        details: ['انتقالان', 'لا مخارج', 'لا مخارج · مهمة واحدة عند الدخول', 'لا مخارج', 'لا مخارج', 'لا مخارج'],
      },
    ],
  ] as const) {
    it(`the rows say what each stage means and allows [${lang}]`, async () => {
      const host = await render(1148, lang);
      const cells = (key: string) => Array.from(host.querySelectorAll<HTMLElement>(`[data-cell="${key}"]`));
      expect(cells('allows').map((c) => c.textContent!.trim())).toEqual([...want.allows]);
      expect(cells('stage').map((c) => Array.from(c.querySelectorAll('.am-stage-meaning')).map((m) => m.textContent!.trim()))).toEqual(
        want.meanings.map((m) => [...m]),
      );
      expect(cells('allows')[0]!.getAttribute('aria-label')).toBe(want.tip);
      expect(cells('details').map((c) => c.textContent!.trim())).toEqual([...want.details]);
      // Every count is in Latin digits (ACC-94).
      expect(host.textContent).not.toMatch(/[\u0660-\u0669]/);
    });
  }

  it('a record type with no actions shows nothing in Allows', async () => {
    const host = await render(1148, 'en', { recordActions: [] });
    const allows = Array.from(host.querySelectorAll<HTMLElement>('[data-cell="allows"]'));
    expect(allows.length).withContext('non-vacuity').toBe(6);
    expect(allows.every((c) => c.textContent!.trim() === '')).toBeTrue();
  });

  it('on a phone each stage is one column: number and name, chips, allows, details', async () => {
    const host = await render(358, 'en');
    const stage = host.querySelectorAll<HTMLElement>('[data-cell="stage"]')[2]!;
    expect(stage.querySelector('[data-stage-number]')!.textContent!.trim()).withContext('the number, first').toBe('3');
    expect(stage.querySelector('[data-stage-name]')!.textContent!.trim()).toBe('Stage 3');
    expect(stage.querySelector('.am-stage-meaning')!.textContent!.trim()).toBe('Record is in force');
    expect(stage.querySelector('[data-cell="allows"]')!.textContent!.trim()).toBe('Allows 4 of 5 actions');
    expect(stage.querySelector('[data-cell="details"]')).not.toBeNull();
    expect(host.querySelector('[data-cell="number"]')).withContext('no separate # column').toBeNull();
  });
});
