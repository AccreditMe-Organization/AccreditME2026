import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { environment } from '../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AmConfirmService } from '../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { WorkflowTemplateListComponent } from './components/workflow-template-list/workflow-template-list.component';
import { WorkflowStageListComponent } from './components/workflow-stage-list/workflow-stage-list.component';
import { WorkflowStageFormComponent } from './components/workflow-stage-form/workflow-stage-form.component';
import { WorkflowTransitionEditorComponent } from './components/workflow-transition-editor/workflow-transition-editor.component';
import { WorkflowActionConfiguratorComponent } from './components/workflow-action-configurator/workflow-action-configurator.component';
import { WorkflowStageDto, WorkflowTransitionActionDto, WorkflowTransitionDto } from './services/workflow-template.service';

// ACC-255 PR 3 (plan §10.4) — every workflow screen says a refusal in its own
// words, in both languages: the protected change request workflow by WHICH edit
// was refused, and never the server's English (the message below is the bait).
// Each screen is driven to the write it makes, the server refuses it, and the
// sentence on screen is the translation file's, read from en.json and ar.json.

const API = `${environment.apiUrl}/workflow-templates`;
const BAIT = 'English for a log';

const lookup = (lang: unknown, key: string): string => {
  const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], lang);
  if (typeof value !== 'string') throw new Error(`no translation for ${key}`);
  return value;
};

const protectedRefusal = (edit: string) => ({ statusCode: 409, message: BAIT, error: 'Conflict', code: 'WORKFLOW_TEMPLATE_PROTECTED', edit });

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Under review',
  nameAr: 'قيد المراجعة',
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

const TRANSITION: WorkflowTransitionDto = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Approve',
  labelAr: 'اعتماد',
  requiredPermission: null,
  triggerCondition: 'SYSTEM_AUTOMATIC',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE',
};

const ACTION = {
  id: 'action-1',
  transitionId: 'transition-1',
  actionType: 'SEND_NOTIFICATION',
  config: {},
  order: 1,
  isEnabled: true,
} as unknown as WorkflowTransitionActionDto;

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee change request',
  nameAr: 'طلب تغيير لجنة',
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isDefault: true,
  isActive: true,
  recordActions: [],
  stageFlags: [],
  recordFields: [],
  recordRoutes: { unit: false, committee: false },
  stages: [{ ...STAGE, key: null, actions: [], flags: [], transitions: [] }],
};

describe('workflow screens say refusals in their own words (ACC-255 PR 3)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;

  function setup<T>(component: Type<T>, lang: 'en' | 'ar', inputs: Record<string, unknown> = {}): ComponentFixture<T> {
    TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        // A confirm a person accepts: the write follows at once.
        { provide: AmConfirmService, useValue: { ask: (o: { accept: () => void }) => o.accept() } },
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
    const fixture = TestBed.createComponent(component);
    for (const [name, value] of Object.entries(inputs)) fixture.componentRef.setInput(name, value);
    fixture.detectChanges();
    return fixture;
  }

  /** Answer the page's own reads with something harmless. */
  function drain(fixture: ComponentFixture<unknown>): void {
    for (const r of http.match((req) => req.method === 'GET')) {
      if (r.request.url === `${API}/template-1`) r.flush(TEMPLATE);
      else if (r.request.url === API) r.flush([TEMPLATE]);
      else r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []);
    }
    fixture.detectChanges();
  }

  function refuse(fixture: ComponentFixture<unknown>, method: string, url: string, edit: string): void {
    http.expectOne((req) => req.method === method && req.url === url).flush(protectedRefusal(edit), { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    drain(fixture);
  }

  const pageText = (fixture: ComponentFixture<unknown>) => (fixture.nativeElement as HTMLElement).textContent ?? '';

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  for (const [lang, file] of [['en', en], ['ar', ar]] as const) {
    describe(`[${lang}]`, () => {
      const expectSentence = (fixture: ComponentFixture<unknown>, edit: string) => {
        const sentence = lookup(file, `workflow.refusal.protected.${edit}`);
        expect(pageText(fixture)).withContext(edit).toContain(sentence);
        expect(pageText(fixture)).not.toContain(BAIT);
        expect(pageText(fixture)).not.toContain('workflow.refusal');
      };

      it('the templates list: Set as default and Deactivate', () => {
        const fixture = setup(WorkflowTemplateListComponent, lang);
        drain(fixture);
        const list = fixture.componentInstance;
        const template = TEMPLATE as unknown as Parameters<typeof list.onSetDefault>[0];

        list.onSetDefault(template, new Event('click'));
        refuse(fixture, 'POST', `${API}/template-1/set-default`, 'REPLACE_DEFAULT');
        expectSentence(fixture, 'REPLACE_DEFAULT');

        list.onDeactivate(template, new Event('click'));
        refuse(fixture, 'POST', `${API}/template-1/deactivate`, 'DEACTIVATE');
        expectSentence(fixture, 'DEACTIVATE');
      });

      it('the stages list: Remove', () => {
        const fixture = setup(WorkflowStageListComponent, lang);
        drain(fixture);
        fixture.componentInstance.onRemove(STAGE);
        refuse(fixture, 'DELETE', `${API}/stages/stage-1`, 'REMOVE_STAGE');
        expectSentence(fixture, 'REMOVE_STAGE');
      });

      it('the stage form: Save', () => {
        const fixture = setup(WorkflowStageFormComponent, lang, { stage: STAGE, templateId: 'template-1' });
        drain(fixture);
        fixture.componentInstance.onSubmit();
        refuse(fixture, 'PATCH', `${API}/stages/stage-1`, 'STAGE_FIELD');
        expectSentence(fixture, 'STAGE_FIELD');
      });

      it('the transition editor: Remove', () => {
        const fixture = setup(WorkflowTransitionEditorComponent, lang, {
          stageId: 'stage-1',
          transitions: [TRANSITION],
          availableStages: [STAGE],
        });
        drain(fixture);
        fixture.componentInstance.onRemove(TRANSITION);
        refuse(fixture, 'DELETE', `${API}/transitions/transition-1`, 'TRANSITION');
        expectSentence(fixture, 'TRANSITION');
      });

      it('the action configurator: Remove', () => {
        const fixture = setup(WorkflowActionConfiguratorComponent, lang, { transitionId: 'transition-1', actions: [ACTION] });
        drain(fixture);
        fixture.componentInstance.onRemove(ACTION);
        refuse(fixture, 'DELETE', `${API}/transitions/actions/action-1`, 'TRANSITION');
        expectSentence(fixture, 'TRANSITION');
      });

      it('an edit nobody listed says the general sentence, never the English', () => {
        const fixture = setup(WorkflowStageListComponent, lang);
        drain(fixture);
        fixture.componentInstance.onRemove(STAGE);
        refuse(fixture, 'DELETE', `${API}/stages/stage-1`, 'SOMETHING_NEW');
        expect(pageText(fixture)).toContain(lookup(file, 'workflow.refusal.templateProtected'));
        expect(pageText(fixture)).not.toContain(BAIT);
      });
    });
  }
});
