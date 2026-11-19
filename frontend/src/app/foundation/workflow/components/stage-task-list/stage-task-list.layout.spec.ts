import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
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
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { StageTaskDefinitionListItemDto, WorkflowStageDto, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { StageTaskListComponent } from './stage-task-list.component';

// ACC-212 — the drag handle adds a 22 × 26 button (and a gap) at the start of
// every "Tasks on entry" row, so each row's text has less room. MEASURED, in the
// real theme and font, at the widths the panel actually has on the stages page
// (workflow-stage-list.layout.spec.ts's page widths 988, 1148, 1628 and 358 give
// this panel 962, 1122, 793 and 332), in both languages:
//
//   - the handle is the drawing's 22 × 26, at the row's START edge (left in
//     English, right in Arabic), before the number;
//   - nothing in a row is wider than the row, and the row does not scroll
//     sideways, with a long title and a long assignment;
//   - the actions stay inside the row, on one line.
//
// NON-VACUITY FIRST (ACC-120): the rows are laid out and the handles drawn.

const PANEL_WIDTHS = [
  { name: 'page 1280 (stacked)', width: 962 },
  { name: 'page 1440 (stacked)', width: 1122 },
  { name: 'page 1920 (beside Transitions)', width: 793 },
  { name: 'page 390 (phone)', width: 332 },
];

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
  description: null,
  order: 20,
  slaWorkingHours: 40,
  isInitial: false,
  isFinal: false,
  escalationConfig: null,
};

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: null,
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  recordRoutes: { unit: true, committee: true },
  taskDueHours: { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 },
};

function definition(id: string, titleEn: string, titleAr: string): StageTaskDefinitionListItemDto {
  return {
    id,
    stageId: 'stage-1',
    order: 10,
    titleEn,
    titleAr,
    description: null,
    isMandatory: true,
    requiresEvidence: true,
    priority: 'HIGH',
    assignKind: 'POSITION',
    orgUnitId: 'unit-1',
    positionId: 'pos-1',
    userId: null,
    committeeId: null,
    committeeRoleValueId: null,
    orgUnit: { id: 'unit-1', nameEn: 'Infection Prevention and Antimicrobial Stewardship', nameAr: 'الوقاية من العدوى والإشراف على مضادات الميكروبات' },
    position: { id: 'pos-1', nameEn: 'Senior Quality and Patient Safety Officer', nameAr: 'مسؤول أول للجودة وسلامة المرضى' },
    user: null,
    committee: null,
    committeeRole: null,
    dueAfterHours: 16,
    createdAt: '',
    updatedAt: '',
    warning: 'POSITION_HAS_NO_HOLDER',
    createdTaskCount: 0,
  };
}

const ROWS = [
  definition(
    'def-1',
    'Review the committee terms of reference against the accreditation standard and record every gap found',
    'مراجعة النظام الداخلي للجنة مقابل معيار الاعتماد وتسجيل كل فجوة تُكتشف',
  ),
  definition('def-2', 'Collect the records', 'جمع السجلات'),
  definition('def-3', 'Inform the committee', 'إبلاغ اللجنة'),
];

@Component({
  standalone: true,
  imports: [StageTaskListComponent],
  template: `<div data-host [style.width.px]="width()"><app-stage-task-list [stage]="stage" [template]="template" [canManage]="true" /></div>`,
})
class Host {
  readonly width = input(962);
  readonly stage = STAGE;
  readonly template = TEMPLATE;
}

describe('StageTaskListComponent — the drag handle fits the row (ACC-212)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-212 measurements:\n  ${measured.join('\n  ')}`));

  let fixture: ComponentFixture<Host>;

  async function render(width: number, lang: 'en' | 'ar'): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    const http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Host);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/stages/stage-1/task-definitions`).flush(ROWS);
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    return fixture.nativeElement.querySelector('[data-host]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    document.documentElement.dir = 'ltr';
  });

  for (const lang of ['en', 'ar'] as const) {
    for (const c of PANEL_WIDTHS) {
      it(`${c.name}, panel ${c.width} [${lang}]: the handle is 22 × 26 at the row's start, and nothing passes the row`, async () => {
        const host = await render(c.width, lang);
        const rows = Array.from(host.querySelectorAll<HTMLElement>('[data-stage-task]'));

        // Non-vacuity: laid out at the panel width, three rows, three handles.
        expect(host.getBoundingClientRect().width).withContext('host not laid out').toBeCloseTo(c.width, 0);
        expect(rows.length).withContext('rows rendered').toBe(3);
        expect(host.querySelectorAll('[data-handle] button').length).withContext('handles rendered').toBe(3);

        for (const row of rows) {
          const r = row.getBoundingClientRect();
          const handle = row.querySelector<HTMLElement>('[data-handle] button')!.getBoundingClientRect();
          const n = row.querySelector<HTMLElement>('.am-stage-task__n')!.getBoundingClientRect();
          const body = row.querySelector<HTMLElement>('.am-stage-task__body')!.getBoundingClientRect();
          const actions = row.querySelector<HTMLElement>('.am-stage-task__actions')!.getBoundingClientRect();
          if (row === rows[0]) {
            measured.push(
              `${lang} panel ${c.width}: row ${Math.round(r.width)}, handle ${handle.width}×${handle.height}, text ${Math.round(body.width)}, actions ${Math.round(actions.width)}×${Math.round(actions.height)}`,
            );
          }

          expect([handle.width, handle.height]).withContext('handle size').toEqual([22, 26]);
          if (lang === 'en') {
            expect(Math.round(handle.left)).withContext('handle at the start (left)').toBe(Math.round(r.left));
            expect(handle.right).withContext('handle before the number').toBeLessThanOrEqual(n.left + 0.5);
          } else {
            expect(Math.round(handle.right)).withContext('handle at the start (right)').toBe(Math.round(r.right));
            expect(handle.left).withContext('handle before the number').toBeGreaterThanOrEqual(n.right - 0.5);
          }
          for (const [what, box] of [['handle', handle], ['text', body], ['actions', actions]] as const) {
            expect(box.left).withContext(`${what} inside the row (left)`).toBeGreaterThanOrEqual(r.left - 0.5);
            expect(box.right).withContext(`${what} inside the row (right)`).toBeLessThanOrEqual(r.right + 0.5);
          }
          expect(body.width).withContext('the text keeps room').toBeGreaterThan(120);
          expect(actions.height).withContext('actions on one line').toBeLessThanOrEqual(40);
          expect(row.scrollWidth).withContext('the row scrolls sideways').toBeLessThanOrEqual(row.clientWidth + 1);
        }
        expect(host.scrollWidth).withContext('the panel scrolls sideways').toBeLessThanOrEqual(c.width + 1);
      });
    }
  }
});
