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
import { FormatService } from '../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AmConfirmService } from '../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { WorkflowTemplateListComponent } from './components/workflow-template-list/workflow-template-list.component';
import { WorkflowStageListComponent } from './components/workflow-stage-list/workflow-stage-list.component';
import { StageEditorPanelComponent } from './components/stage-editor-panel/stage-editor-panel.component';
import { fakeStageWhoOptions } from './components/stage-who/stage-who-options.testing';
import { WorkflowTransitionEditorComponent } from './components/workflow-transition-editor/workflow-transition-editor.component';
import { WorkflowActionConfiguratorComponent } from './components/workflow-action-configurator/workflow-action-configurator.component';
import { WorkflowStageIndicatorComponent } from './components/workflow-stage-indicator/workflow-stage-indicator.component';
import { WorkflowStageDto, WorkflowTransitionActionDto, WorkflowTransitionDto } from './services/workflow-template.service';
import { WorkflowInstanceDto, WorkflowStageHistoryDto } from './services/workflow.service';

// ACC-57, ACC-191, ACC-202 (plan: backend/Plans/step-57-191-202-workflow-checks.md)
// — what the workflow screens say about a template's starting and final stages,
// about removing something a record has used, and how stage history shows a
// send-back or an end. Every sentence is the translation file's, in both
// languages, chosen from the refusal's CODE and numbers (plainWorkflowRefusalKey()
// first); the server's English (the bait) never shows.

const API = `${environment.apiUrl}/workflow-templates`;
const BAIT = 'English for a log';

const lookup = (lang: unknown, key: string): string => {
  const value = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], lang);
  if (typeof value !== 'string') throw new Error(`no translation for ${key}`);
  return value;
};
const fill = (sentence: string, params: Record<string, string>) => sentence.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => params[k] ?? '');

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Formation',
  nameAr: 'التكوين',
  description: null,
  order: 10,
  slaWorkingHours: 40,
  isInitial: true,
  isFinal: false,
  escalationConfig: null,
};
const OTHER = { id: 'stage-2', nameEn: 'Terms Review', nameAr: 'مراجعة الشروط' };

const TRANSITION: WorkflowTransitionDto = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Submit',
  labelAr: 'إرسال',
  validatorConfig: null,
  isApprovalPath: false,
  kind: 'ADVANCE',
};

const ACTION = { id: 'action-1', transitionId: 'transition-1', actionType: 'SEND_NOTIFICATION', config: {}, order: 1, isEnabled: true } as unknown as WorkflowTransitionActionDto;

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: false,
  isActive: true,
  recordActions: [],
  stageFlags: [],
  recordFields: [],
  recordRoutes: { unit: true, committee: true },
  stages: [{ ...STAGE, key: null, actions: [], flags: [], transitions: [] }],
};

const refusal = (code: string, status: number, details: Record<string, unknown> = {}) => ({ statusCode: status, message: BAIT, error: 'Refused', code, ...details });

describe('workflow stage checks on screen (ACC-57, ACC-191, ACC-202)', () => {
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
        fakeStageWhoOptions(),
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

  function drain(fixture: ComponentFixture<unknown>): void {
    for (const r of http.match((req) => req.method === 'GET')) {
      if (r.request.url === `${API}/template-1`) r.flush(TEMPLATE);
      else if (r.request.url === API) r.flush([TEMPLATE]);
      else r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []);
    }
    fixture.detectChanges();
  }

  function answer(fixture: ComponentFixture<unknown>, method: string, url: string, body: Record<string, unknown>, status: number): void {
    http.expectOne((req) => req.method === method && req.url === url).flush(body, { status, statusText: 'Refused' });
    fixture.detectChanges();
    drain(fixture);
  }

  const text = (fixture: ComponentFixture<unknown>, selector?: string) =>
    ((selector ? (fixture.nativeElement as HTMLElement).querySelector(selector) : fixture.nativeElement) as HTMLElement | null)?.textContent?.trim() ?? '';

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  for (const [lang, file] of [['en', en], ['ar', ar]] as const) {
    const name = (s: { nameEn: string; nameAr: string | null }) => (lang === 'ar' ? s.nameAr! : s.nameEn);
    const clean = (fixture: ComponentFixture<unknown>) => {
      expect(text(fixture)).not.toContain(BAIT);
      expect(text(fixture)).not.toContain('workflow.');
      expect(text(fixture)).not.toContain('plural.');
    };

    describe(`[${lang}]`, () => {
      // ── ACC-191: Remove says how many ────────────────────────────────────────

      it('the stages list: a stage records have entered says how many, and why another refusal is', () => {
        const fixture = setup(WorkflowStageListComponent, lang);
        drain(fixture);
        const format = TestBed.inject(FormatService);

        fixture.componentInstance.onRemove(STAGE);
        answer(fixture, 'DELETE', `${API}/stages/stage-1`, refusal('STAGE_IN_USE', 409, { recordCount: 3 }), 409);
        expect(text(fixture)).toContain(format.count('workflow.stageInUse', 3));
        clean(fixture);

        fixture.componentInstance.onRemove(STAGE);
        answer(fixture, 'DELETE', `${API}/stages/stage-1`, refusal('STAGE_HAS_TRANSITIONS', 409, { transitionCount: 2 }), 409);
        expect(text(fixture)).toContain(lookup(file, 'workflow.refusal.stageHasTransitions'));

        fixture.componentInstance.onRemove(STAGE);
        answer(fixture, 'DELETE', `${API}/stages/stage-1`, refusal('STAGE_INITIAL_REQUIRED', 409, { stageIds: ['stage-1'], stageNames: [STAGE] }), 409);
        expect(text(fixture)).toContain(lookup(file, 'workflow.refusal.initialRequired'));
        clean(fixture);
      });

      it('the action configurator: an action that has run says how many times', () => {
        const fixture = setup(WorkflowActionConfiguratorComponent, lang, { transitionId: 'transition-1', actions: [ACTION] });
        drain(fixture);
        fixture.componentInstance.onRemove(ACTION);
        answer(fixture, 'DELETE', `${API}/transitions/actions/action-1`, refusal('TRANSITION_ACTION_IN_USE', 409, { runCount: 12 }), 409);
        expect(text(fixture)).toContain(TestBed.inject(FormatService).count('workflow.actionInUse', 12));
        clean(fixture);
      });

      it('the transition editor: a transition used once says so, in the one form', () => {
        const fixture = setup(WorkflowTransitionEditorComponent, lang, { stageId: 'stage-1', transitions: [TRANSITION], availableStages: [STAGE] });
        drain(fixture);
        fixture.componentInstance.onRemove(TRANSITION);
        answer(fixture, 'DELETE', `${API}/transitions/transition-1`, refusal('TRANSITION_IN_USE', 409, { runCount: 1 }), 409);
        const once = TestBed.inject(FormatService).count('workflow.transitionInUse', 1);
        expect(once).toBe(lookup(file, 'plural.workflow.transitionInUse.one'));
        expect(text(fixture)).toContain(once);
        clean(fixture);
      });

      // ── ACC-57: the starting stage ───────────────────────────────────────────

      it('the templates list: Set as default on a workflow with no starting stage says why', () => {
        const fixture = setup(WorkflowTemplateListComponent, lang);
        drain(fixture);
        fixture.componentInstance.onSetDefault(TEMPLATE as never, new Event('click'));
        answer(fixture, 'POST', `${API}/template-1/set-default`, refusal('STAGE_INITIAL_REQUIRED', 409, { stageIds: [], stageNames: [] }), 409);
        expect(text(fixture)).toContain(lookup(file, 'workflow.refusal.initialRequired'));
        clean(fixture);
      });

      describe('the stage editor panel', () => {
        const panel = () => setup(StageEditorPanelComponent, lang, { stage: STAGE, template: { ...TEMPLATE, stages: [STAGE] } });

        it('unticking the only starting stage: under Initial, naming it, focus on the box', () => {
          const fixture = panel();
          drain(fixture);
          fixture.componentInstance.form.controls.isInitial.setValue(false);
          fixture.componentInstance.onSubmit();
          answer(fixture, 'PATCH', `${API}/stages/stage-1`, refusal('STAGE_INITIAL_REQUIRED', 409, { stageIds: ['stage-1'], stageNames: [STAGE] }), 409);
          expect(text(fixture, '[data-initial-refusal]')).toBe(fill(lookup(file, 'workflow.editor.initialRequiredNamed'), { stage: name(STAGE) }));
          expect(document.activeElement?.id).toBe('sep-isInitial');
          expect(text(fixture, '[data-panel-refusal]')).toBe('');
          clean(fixture);
        });

        it('a stage both starting and final: under Final', () => {
          const fixture = panel();
          drain(fixture);
          fixture.componentInstance.form.controls.isFinal.setValue(true);
          fixture.componentInstance.onSubmit();
          answer(fixture, 'PATCH', `${API}/stages/stage-1`, refusal('STAGE_INITIAL_AND_FINAL', 400, { stageIds: ['stage-1'], stageNames: [STAGE] }), 400);
          expect(text(fixture, '[data-final-refusal]')).toBe(lookup(file, 'workflow.refusal.initialAndFinal'));
          expect(document.activeElement?.id).toBe('sep-isFinal');
          clean(fixture);
        });

        it('two starting stages (a template already in breach): under Initial, naming both', () => {
          const fixture = panel();
          drain(fixture);
          fixture.componentInstance.onSubmit();
          answer(
            fixture,
            'PATCH',
            `${API}/stages/stage-1`,
            refusal('STAGE_INITIAL_NOT_UNIQUE', 409, { stageIds: ['stage-1', 'stage-2'], stageNames: [STAGE, OTHER] }),
            409,
          );
          const separator = lang === 'ar' ? '، ' : ', ';
          expect(text(fixture, '[data-initial-refusal]')).toBe(
            fill(lookup(file, 'workflow.editor.initialNotUniqueNamed'), { stages: [name(STAGE), name(OTHER)].join(separator) }),
          );
          clean(fixture);
        });

        it('a save that moved the starting stage here names the stage it left (Q1), until the next change', () => {
          const fixture = setup(StageEditorPanelComponent, lang, { stage: { ...STAGE, isInitial: false }, template: { ...TEMPLATE, stages: [STAGE] } });
          drain(fixture);
          fixture.componentInstance.form.controls.isInitial.setValue(true);
          fixture.componentInstance.onSubmit();
          http
            .expectOne((req) => req.method === 'PATCH' && req.url === `${API}/stages/stage-1`)
            .flush({ ...STAGE, actions: [], flags: [], startingStageMovedFrom: [OTHER] });
          fixture.detectChanges();
          expect(text(fixture, '[data-initial-moved]')).toBe(fill(lookup(file, 'workflow.editor.initialMoved'), { stage: name(OTHER) }));

          fixture.componentInstance.form.controls.nameEn.setValue('Formation 2');
          fixture.detectChanges();
          expect(text(fixture, '[data-initial-moved]')).toBe('');
        });
      });

      // ── ACC-202: stage history shows a send-back or an end ───────────────────

      it('stage history: "Sent back" and "Ended" from arrivedBy, nothing for a forward move or an older backend', () => {
        const fixture = setup(WorkflowStageIndicatorComponent, lang, { instance: { id: 'i-1' } as WorkflowInstanceDto, show: 'history' });
        const visit = (id: string, enteredAt: string, arrivedBy: 'RETURNED' | 'EXITED' | null | undefined) => ({
          id,
          stageId: id,
          stageNameEn: id,
          stageNameAr: id,
          enteredAt,
          exitedAt: null,
          outcome: 'APPROVED',
          actorId: null,
          actorName: null,
          transitionLabelEn: null,
          transitionLabelAr: null,
          comment: null,
          ...(arrivedBy === undefined ? {} : { arrivedBy }),
          isUnassigned: false,
          delegation: null,
        });
        const history: WorkflowStageHistoryDto = {
          instanceId: 'i-1',
          stages: [],
          visits: [
            visit('v1', '2026-11-01T08:00:00Z', null),
            visit('v2', '2026-11-02T08:00:00Z', 'RETURNED'),
            visit('v3', '2026-11-03T08:00:00Z', 'EXITED'),
            visit('v4', '2026-11-04T08:00:00Z', undefined),
          ],
        } as unknown as WorkflowStageHistoryDto;
        http.expectOne(`${environment.apiUrl}/workflows/instances/i-1/stage-history`).flush(history);
        fixture.detectChanges();

        const chips = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-arrived-by]')).map((c) => c.textContent?.trim());
        // Newest first: v3 (ended), then v2 (sent back); v1 and v4 show none.
        expect(chips).toEqual([lookup(file, 'workflow.stageIndicator.arrivedByExited'), lookup(file, 'workflow.stageIndicator.arrivedByReturned')]);
        expect(text(fixture)).not.toContain('RETURNED');
        expect(text(fixture)).not.toContain('EXITED');
      });
    });
  }
});
