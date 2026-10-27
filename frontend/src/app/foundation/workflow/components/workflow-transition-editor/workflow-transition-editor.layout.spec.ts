import { Component } from '@angular/core';
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
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowStageDto, WorkflowTransitionDto } from '../../services/workflow-template.service';
import { WorkflowTransitionEditorComponent } from './workflow-transition-editor.component';

// ACC-208 — the 420px body cap for the Add and Edit transition dialogs,
// measured (ACC-120). Before this ticket neither had ever been measured, and
// both were far over: Add 674 English / 696 Arabic, Edit 542 / 564. Kind adds
// three radio rows, so both are stepped on the seam they had — the move
// (where to, its name, its kind) and who may fire it — with the actions in the
// footer. Each state's tallest arrangement is measured here.
//
// NON-VACUITY FIRST: a body measuring 0 passes "<= 420", so each case first
// asserts the body is really laid out.

const CAP = 420;
// ACC-255 PR 4b (plan §17.6) — a dialog that stays a dialog keeps at least
// 20px of room under the cap, which is never raised.
const ROOM = 20;
const FLOOR = 120;

const TRANSITION: WorkflowTransitionDto = {
  id: 'tr-1',
  fromStageId: 's1',
  toStageId: 's2',
  labelEn: 'Approve the terms',
  labelAr: 'اعتماد الشروط',
  requiredPermission: 'committees:approve',
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: true,
  kind: 'ADVANCE',
  actions: [],
};

@Component({
  standalone: true,
  imports: [WorkflowTransitionEditorComponent],
  template: `<app-workflow-transition-editor stageId="s1" [transitions]="transitions" [availableStages]="stages" />`,
})
class HostComponent {
  readonly transitions = [TRANSITION];
  readonly stages = [
    { id: 's1', nameEn: 'Terms Review', nameAr: null },
    { id: 's2', nameEn: 'Active', nameAr: null },
  ] as WorkflowStageDto[];
}

describe('Transition dialogs — the 420px body cap (ACC-208)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function open(language: 'en' | 'ar'): Promise<WorkflowTransitionEditorComponent> {
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
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .match(() => true)
      .forEach((r) => r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []));
    fixture.detectChanges();
    return fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent)).componentInstance as WorkflowTransitionEditorComponent;
  }

  async function measure(label: string, language: 'en' | 'ar'): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const body = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(body).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    const height = body!.scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px against the ${CAP}px cap, with ${ROOM}px of room`).toBeLessThanOrEqual(CAP - ROOM);
  }

  afterAll(() => console.log(`ACC-208 transition measurements\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      it('Add, step 1 — target, labels and Kind', async () => {
        const editor = await open(language);
        editor.openAdd();
        await measure('Add · step 1', language);
      });

      it('Add, step 2 — role-based, with the role field showing', async () => {
        const editor = await open(language);
        editor.openAdd();
        editor.addStep.set(2);
        await measure('Add · step 2 · role-based', language);
      });

      it('Add, step 2 — assignee pool, with its explanation showing', async () => {
        const editor = await open(language);
        editor.openAdd();
        editor.addForm.controls.triggerCondition.setValue('ASSIGNEE_POOL');
        editor.addStep.set(2);
        await measure('Add · step 2 · assignee pool', language);
      });

      it('Edit, step 1 — the locked-endpoints note, labels and Kind', async () => {
        const editor = await open(language);
        editor.openEdit(TRANSITION);
        await measure('Edit · step 1', language);
      });

      it('Edit, step 2 — with the permission warning a save can leave (ACC-55)', async () => {
        const editor = await open(language);
        editor.openEdit(TRANSITION);
        editor.editStep.set(2);
        editor.editPermissionWarning.set('NO_ACTIVE_ROLE_HOLDS');
        await measure('Edit · step 2 · with warning', language);
      });
    });
  }
});
