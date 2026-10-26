import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
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
] as const;

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
    actions: [],
    flags: [],
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
  recordActions: [],
  stageFlags: [],
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

  async function render(width: number, lang: 'en' | 'ar'): Promise<HTMLElement> {
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
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(TEMPLATE);
    fixture.detectChanges();
    // Expand the stage with the long transition, as a person does.
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('[data-testid="stage-expand"] button')!.click();
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
        expect(headCells.length).withContext('expand, name, approval, assignee, SLA, actions').toBe(6);
        const starts = headCells.map(startOf);
        for (let i = 1; i < starts.length; i++) {
          const ahead = rtl ? starts[i - 1]! > starts[i]! : starts[i]! > starts[i - 1]!;
          expect(ahead).withContext(`column ${i} starts after column ${i - 1}`).toBeTrue();
        }
        expect(host.getBoundingClientRect().width).toBeCloseTo(c.width, 0);

        // ── No sideways scroll, anywhere in the page ──
        const sideways = [host, ...Array.from(host.querySelectorAll<HTMLElement>('*'))].filter((el) => {
          const ox = getComputedStyle(el).overflowX;
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

        // ── ACC-265: the SLA, now a counted string, fits its column, uncut ──
        const slaCells = Array.from(host.querySelectorAll<HTMLElement>('[data-cell="sla"]'));
        expect(slaCells.length).withContext('one SLA cell per stage').toBe(6);
        for (const cell of slaCells) {
          // Non-vacuity: a real box (an inline span would measure 0 and pass for nothing).
          expect(cell.clientWidth).withContext('SLA cell has a width').toBeGreaterThan(20);
          expect(cell.scrollWidth).withContext(`SLA "${cell.textContent!.trim()}" fits`).toBeLessThanOrEqual(cell.clientWidth + 1);
        }

        // ── The transition table stays inside its column ──
        const table = host.querySelector<HTMLElement>('.am-tr-table table') ?? host.querySelector<HTMLElement>('.am-tr-table');
        expect(table).withContext('the expanded row shows its transitions').not.toBeNull();
        const column = table!.closest<HTMLElement>('app-workflow-transition-editor')!.getBoundingClientRect();
        const box = table!.getBoundingClientRect();
        expect(box.right).withContext('table right edge').toBeLessThanOrEqual(column.right + 1);
        expect(box.left).withContext('table left edge').toBeGreaterThanOrEqual(column.left - 1);
      });
    }
  }

  it('the raw codes are gone: approval, assignee and trigger read in words', async () => {
    const host = await render(1148, 'en');
    const text = host.textContent!;
    for (const code of ['SINGLE', 'SEQUENTIAL', 'POSITION_FIXED', 'ORG_UNIT_HEAD', 'ASSIGNEE_POOL']) {
      expect(text).withContext(code).not.toContain(code);
    }
    expect(host.querySelector('[data-testid="stage-approval"]')!.textContent!.trim()).toBe('Sequential');
    expect(text).toContain('Fixed position');
    expect(host.querySelector('[data-tr-trigger]')!.textContent!.trim()).toBe('Assignee pool');
  });

  // ACC-265 item 2 — the SLA column read "40h" in both languages.
  for (const [lang, hours] of [
    ['en', '40 working hours'],
    ['ar', '40 ساعة عمل'],
  ] as const) {
    it(`the SLA reads as a counted string, never "40h" [${lang}]`, async () => {
      const host = await render(1148, lang);
      const sla = Array.from(host.querySelectorAll<HTMLElement>('[data-cell="sla"]')).map((c) => c.textContent!.trim());
      // Stages 1, 3 and 5 have a 40-hour SLA; the rest have none.
      expect(sla).toEqual([hours, '—', hours, '—', hours, '—']);
      expect(host.textContent).not.toContain('40h');
    });
  }
});
