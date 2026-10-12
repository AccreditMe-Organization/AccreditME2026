import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
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
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowStageDto, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { StageTaskDefinitionFormComponent } from './stage-task-definition-form.component';

// ACC-208 — the 420px body cap (ACC-111), measured rather than assumed
// (ACC-120): every state of both steps, in both languages, in the real dialog
// shell at compact density with the real theme, actions in the footer.
//
// The drawing measured one step at 730 / 778 — over the cap by 300px, which
// no compaction closes — so the form is stepped on its seam (what; when and
// who). These numbers are what stepping bought, and the guard below fails the
// spec if any state of either step grows past the cap.
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 420"
// perfectly. Each case asserts the body is really laid out — taller than a
// floor no real state can be under — before the cap means anything.

const API = environment.apiUrl;
const CAP = 420;
const FLOOR = 150;

const STAGE = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
  slaWorkingHours: 40,
  isFinal: false,
} as WorkflowStageDto;

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  recordRoutes: { unit: true, committee: true },
  taskDueHours: { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 },
};

@Component({
  standalone: true,
  imports: [StageTaskDefinitionFormComponent, EditDialogComponent],
  template: `
    <ng-template #body>
      <app-stage-task-definition-form [stage]="stage" [template]="template" />
    </ng-template>
    <app-edit-dialog [visible]="true" header="Add a task on entry" context="Committee Management · Terms Review" [content]="body" density="compact" />
  `,
})
class HostComponent {
  readonly stage = STAGE;
  readonly template = TEMPLATE;
  readonly shown = signal(true);
}

describe('StageTaskDefinitionForm — the 420px body cap (ACC-208)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function open(language: 'en' | 'ar'): Promise<StageTaskDefinitionFormComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await settle();
    return fixture.debugElement.query(By.directive(StageTaskDefinitionFormComponent)).componentInstance as StageTaskDefinitionFormComponent;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The body's full content height — what it would need to show without scrolling. */
  function bodyHeight(): number {
    const body = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    return body!.scrollHeight;
  }

  async function measure(label: string, language: 'en' | 'ar'): Promise<void> {
    await settle();
    const height = bodyHeight();
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px against the ${CAP}px cap`).toBeLessThanOrEqual(CAP);
  }

  async function stepTwo(f: StageTaskDefinitionFormComponent): Promise<void> {
    f.form.controls.titleEn.setValue('Collect the incident records');
    f.form.controls.titleAr.setValue('جمع سجلات الحادث');
    f.next();
    await settle();
  }

  function choosePosition(f: StageTaskDefinitionFormComponent): void {
    f.form.controls.assignKind.setValue('POSITION');
    fixture.detectChanges();
    http.expectOne(`${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
    f.form.controls.assign.controls.scope.setValue('unit-1');
    http.expectOne((r) => r.url === `${API}/tasks/assignment/positions`).flush([
      { id: 'pos-1', nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة', isSingleAssignee: false, holderCount: 1 },
    ]);
    f.form.controls.assign.controls.target.setValue('pos-1');
    http.expectOne((r) => r.url === `${API}/tasks/assignees`).flush([
      { id: 'u-1', name: 'Nora Al-Otaibi', positionNameEn: 'Quality Officer', positionNameAr: 'مسؤول الجودة' },
    ]);
  }

  afterAll(() => {
    // The numbers recorded in step-208-stage-tasks-screen.md §5.
    console.log(`ACC-208 measurements\n${measured.join('\n')}`);
  });

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      afterEach(() => http.verify());

      it('step 1, "The task", fits — with a description and every error showing', async () => {
        const f = await open(language);
        f.form.controls.description.setValue('Timeline, nursing notes, photos of the location.');
        f.next(); // refused: no title, so the required message shows
        await measure('step 1 · title error shown', language);
      });

      it('step 2, a unit you choose, fits — the tallest route, with the person and the outcome line', async () => {
        const f = await open(language);
        await stepTwo(f);
        f.form.controls.priority.setValue('HIGH');
        choosePosition(f);
        await measure('step 2 · a unit you choose', language);
      });

      it('step 2 with the deadline refusal under Priority fits', async () => {
        const f = await open(language);
        await stepTwo(f);
        f.form.controls.priority.setValue('LOW');
        f.form.controls.assignKind.setValue('RECORD_UNIT_POSITION');
        http.expectOne(`${API}/org-positions`).flush([{ id: 'pos-1', nameEn: 'Quality Officer', nameAr: null, isActive: true }]);
        f.form.controls.recordPositionId.setValue('pos-1');
        await measure("step 2 · deadline refused · record's unit", language);
      });

      it('step 2, a committee you choose, fits', async () => {
        const f = await open(language);
        await stepTwo(f);
        f.form.controls.priority.setValue('MEDIUM');
        f.form.controls.assignKind.setValue('COMMITTEE_ROLE');
        http.expectOne(`${API}/committees`).flush([{ id: 'c-1', nameEn: 'Quality Assurance Committee', nameAr: null }]);
        f.form.controls.committeeId.setValue('c-1');
        http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'Secretary', labelAr: 'أمين السر', memberCount: 2 }]);
        f.form.controls.committeeRoleValueId.setValue('r');
        await measure('step 2 · a committee you choose', language);
      });

      it("step 2, the record's committee, fits", async () => {
        const f = await open(language);
        await stepTwo(f);
        f.form.controls.priority.setValue('MEDIUM');
        f.form.controls.assignKind.setValue('RECORD_COMMITTEE_ROLE');
        http.expectOne((r) => r.url === `${API}/tasks/assignment/committee-roles`).flush([{ id: 'r', labelEn: 'Secretary', labelAr: 'أمين السر', memberCount: null }]);
        f.form.controls.committeeRoleValueId.setValue('r');
        await measure("step 2 · the record's committee", language);
      });

      it('step 2 after a save that warned (ACC-55) fits, warning included', async () => {
        const f = await open(language);
        await stepTwo(f);
        f.form.controls.priority.setValue('HIGH');
        choosePosition(f);
        f.savedWarning.set(
          TestBed.inject(TranslateService).instant('workflow.stageTaskForm.savedNoHolder', { unit: 'Cardiology' }),
        );
        await measure('step 2 · a unit you choose · saved with a warning', language);
      });
    });
  }
});
