import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowStageDto } from '../../services/workflow-template.service';
import { WorkflowStageFormComponent } from './workflow-stage-form.component';

// ACC-208 — the stage form's side of the stage-deadline rule, and a final
// stage that still creates tasks: each refusal shown under its own field, in
// words built from the refusal's numbers, never the server's English.

const API = environment.apiUrl;

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: null,
  description: null,
  order: 20,
  slaWorkingHours: 40,
  isInitial: false,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'ROLE',
  assigneeUserId: null,
  assigneeRoleId: 'role-1',
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
};

describe('WorkflowStageFormComponent — refusals (ACC-208)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<WorkflowStageFormComponent>;
  let http: HttpTestingController;

  function setup(language: 'en' | 'ar' = 'en'): WorkflowStageFormComponent {
    TestBed.configureTestingModule({
      imports: [WorkflowStageFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowStageFormComponent);
    fixture.componentInstance.stage = STAGE;
    fixture.componentInstance.templateId = 'template-1';
    fixture.detectChanges();
    // The pickers' lists; the roles list is the paginated envelope.
    http.match(() => true).forEach((r) => r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []));
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const save = (form: WorkflowStageFormComponent, body: Record<string, unknown>, status: number) => {
    form.onSubmit();
    http
      .expectOne(`${API}/workflow-templates/stages/stage-1`)
      .flush({ statusCode: status, message: 'English for a log', ...body }, { status, statusText: 'Refused' });
    fixture.detectChanges();
  };

  const text = (selector: string) => (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? null;

  afterEach(() => http.verify());

  it('words a deadline lowered below its tasks under the SLA field, with both numbers and the way out', () => {
    const form = setup();
    form.form.controls.slaWorkingHours.setValue(12);
    save(form, { code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: ['d1'] }, 409);

    expect(text('[data-sla-refusal]')).toBe(
      'A task on this stage is due in 16 working hours. Set the deadline to at least 16, or give those tasks a higher priority.',
    );
    expect(form.saveError()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('English for a log');
  });

  it('clears it once the deadline changes', () => {
    const form = setup();
    save(form, { code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: [] }, 409);
    form.form.controls.slaWorkingHours.setValue(16);
    fixture.detectChanges();
    expect(text('[data-sla-refusal]')).toBeNull();
  });

  it('says how many tasks a stage made final still creates', () => {
    const form = setup();
    form.form.controls.isFinal.setValue(true);
    save(form, { code: 'STAGE_TASK_ON_FINAL_STAGE', taskDefinitionCount: 2 }, 400);
    expect(text('[data-final-refusal]')).toBe('This stage creates 2 tasks on entry. Remove them before making it final.');
  });

  it('says it in Arabic, with the Arabic plural', () => {
    const form = setup('ar');
    save(form, { code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: [] }, 409);
    expect(text('[data-sla-refusal]')).toBe(
      'مهمة في هذه المرحلة مستحقة خلال 16 ساعة عمل. اجعل المهلة 16 على الأقل، أو امنح تلك المهام أولوية أعلى.',
    );
  });
});
