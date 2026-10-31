import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
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
import { StageEditorPanelComponent } from './components/stage-editor-panel/stage-editor-panel.component';
import { WorkflowTransitionEditorComponent } from './components/workflow-transition-editor/workflow-transition-editor.component';
import { WorkflowStageDto, WorkflowTransitionDto } from './services/workflow-template.service';
import { whoMovedToStageMessage } from './workflow-refusal';

// ACC-271 PR 3 — who works a converted stage is set on the stage now, so the
// server refuses a CHANGED old people field with WHO_MOVED_TO_STAGE. Unlike
// every other workflow refusal, this one is shown in the SERVER's own words, in
// the reader's language: `message` in English, `messageAr` in Arabic. The
// sentences below stand in for the server's; the screens keep no copy.

const API = `${environment.apiUrl}/workflow-templates`;
const SERVER_EN = 'Who works this stage is now set on the stage, not here.';
const SERVER_AR = 'يُحدَّد من يعمل على هذه المرحلة الآن في المرحلة نفسها، لا هنا.';

const refusal = (field: string) => ({
  statusCode: 400,
  message: SERVER_EN,
  error: 'Bad Request',
  code: 'WHO_MOVED_TO_STAGE',
  field,
  messageAr: SERVER_AR,
});

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
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE',
};

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
  recordRoutes: { unit: true, committee: true },
  stages: [{ ...STAGE, key: null, actions: [], flags: [], transitions: [] }],
};

describe('whoMovedToStageMessage (ACC-271 PR 3)', () => {
  const err = (body: unknown) => new HttpErrorResponse({ status: 400, error: body });

  it("reads the server's sentence in the reader's language", () => {
    expect(whoMovedToStageMessage(err(refusal('approvalMode')), false)).toBe(SERVER_EN);
    expect(whoMovedToStageMessage(err(refusal('approvalMode')), true)).toBe(SERVER_AR);
  });

  it('falls back to the English sentence when the body carries no Arabic', () => {
    const { messageAr: _ar, ...noArabic } = refusal('approvalMode');
    expect(whoMovedToStageMessage(err(noArabic), true)).toBe(SERVER_EN);
  });

  it('is null for any other refusal, and for a body with no sentence', () => {
    expect(whoMovedToStageMessage(err({ code: 'STAGE_HAS_NO_ONE', message: 'x', messageAr: 'س' }), false)).toBeNull();
    expect(whoMovedToStageMessage(err({ code: 'WHO_MOVED_TO_STAGE' }), true)).toBeNull();
    expect(whoMovedToStageMessage(new Error('offline'), false)).toBeNull();
  });
});

describe("workflow screens say WHO_MOVED_TO_STAGE in the server's own words (ACC-271 PR 3)", () => {
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

  /** Answer the screen's own reads with something harmless. */
  function drain(fixture: ComponentFixture<unknown>): void {
    for (const r of http.match((req) => req.method === 'GET')) {
      if (r.request.url === `${API}/template-1`) r.flush(TEMPLATE);
      else r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []);
    }
    fixture.detectChanges();
  }

  function refuse(fixture: ComponentFixture<unknown>, url: string, field: string): void {
    http.expectOne((req) => req.method === 'PATCH' && req.url === url).flush(refusal(field), { status: 400, statusText: 'Bad Request' });
    fixture.detectChanges();
    drain(fixture);
  }

  // The transition editor's dialog renders in an overlay, so read the whole document.
  const shownText = () => document.body.textContent ?? '';

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  for (const [lang, said, notSaid] of [
    ['en', SERVER_EN, SERVER_AR],
    ['ar', SERVER_AR, SERVER_EN],
  ] as const) {
    describe(`[${lang}]`, () => {
      it('the stage editor panel: Save', () => {
        const fixture = setup(StageEditorPanelComponent, lang, { stage: STAGE, template: { id: 'template-1', stages: [STAGE] } });
        drain(fixture);
        fixture.componentInstance.onSubmit();
        refuse(fixture, `${API}/stages/stage-1`, 'approvalMode');
        expect(shownText()).toContain(said);
        expect(shownText()).not.toContain(notSaid);
        expect(shownText()).not.toContain('WHO_MOVED_TO_STAGE');
      });

      it('the transition editor: Save in Edit', () => {
        const fixture = setup(WorkflowTransitionEditorComponent, lang, {
          stageId: 'stage-1',
          transitions: [TRANSITION],
          availableStages: [STAGE],
        });
        drain(fixture);
        const editor = fixture.componentInstance;
        editor.openEdit(TRANSITION);
        fixture.detectChanges();
        drain(fixture);
        editor.onSubmitEdit();
        refuse(fixture, `${API}/transitions/transition-1`, 'requiredPermission');
        expect(editor.saveError()).toBe(said);
        expect(shownText()).toContain(said);
        expect(shownText()).not.toContain(notSaid);
        expect(shownText()).not.toContain('WHO_MOVED_TO_STAGE');
      });
    });
  }
});
