// ACC-55 — the integration that actually broke on the live pass, and that
// neither component's own spec covers on its own.
//
// The transition editor's dialog logic was already correct in isolation. What
// failed was the seam: the editor emitted `changed`, workflow-stage-list ran
// loadTemplate(), the stages array was replaced, p-table rebuilt the expanded
// row's embedded view, and the editor component was DESTROYED and recreated —
// taking the open dialog and its warning with it.
//
// Proven pre-fix: after a reload the component instance identity changed and
// both showEditDialog and editPermissionWarning were back at their defaults.
// This spec pins the seam so a future refactor cannot silently reintroduce it.
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../../environments/environment';
import { WorkflowStageListComponent } from './workflow-stage-list.component';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowTransitionEditorComponent } from '../workflow-transition-editor/workflow-transition-editor.component';

const TRANSITION = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-1',
  labelEn: 'Approve',
  labelAr: 'اعتماد',
  requiredPermission: 'committees:manage',
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,

  kind: 'ADVANCE' as const,
};

const template = () => ({
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee Management',
  nameAr: 'إدارة اللجان',
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  stages: [
    {
      id: 'stage-1',
      workflowTemplateId: 'template-1',
      nameEn: 'Formation',
      nameAr: 'التكوين',
      description: null,
      order: 10,
      slaWorkingHours: null,
      isInitial: true,
      isFinal: false,
      approvalMode: 'SINGLE',
      parallelThreshold: null,
      committeeId: null,
      assigneeStrategy: 'ROLE',
      assigneeUserId: null,
      assigneeRoleId: null,
      assigneeCommitteeRoleValueId: null,
      assigneePositionId: null,
      assigneeOrgUnitId: null,
      escalationConfig: null,
      transitions: [TRANSITION],
    },
  ],
});

describe('WorkflowStageList + TransitionEditor (ACC-55 seam)', () => {
  it('a warning dialog survives — the parent is not reloaded underneath it', () => {
    TestBed.configureTestingModule({
      imports: [WorkflowStageListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        {
          provide: ActivatedRoute,
          // queryParamMap — ACC-82's Fix link reads it; this test passes none.
          useValue: {
            snapshot: { paramMap: { get: () => 'template-1' }, queryParamMap: convertToParamMap({}) },
          },
        },
      ],
    });

    // ACC-78 — the role picker reads listAllRoles(), which asks for
    // ?pageSize=200 and expects the PAGINATED ENVELOPE. Flushing a bare array
    // here would leave `.data` undefined rather than failing loudly, so the
    // shape matters even though the test does not read the roles.
    const drainRoles = (http: HttpTestingController): void => {
      http
        .match((r) => r.url === `${environment.apiUrl}/roles`)
        .forEach((r) => r.flush({ data: [], total: 0, page: 1, pageSize: 200 }));
      http.match(`${environment.apiUrl}/roles/permissions`).forEach((r) => r.flush([]));
      // ACC-208 — the expanded row's "Tasks on entry" reads its own list.
      http
        .match(`${environment.apiUrl}/workflow-templates/stages/stage-1/task-definitions`)
        .forEach((r) => r.flush([]));
    };

    const fixture = TestBed.createComponent(WorkflowStageListComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(template());
    fixture.detectChanges();

    fixture.componentInstance.expandedRowKeys.set({ 'stage-1': true });
    fixture.detectChanges();

    const editorDebug = fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent));
    const editor = editorDebug.componentInstance as WorkflowTransitionEditorComponent;
    drainRoles(http);
    fixture.detectChanges();

    editor.openEdit(TRANSITION);
    fixture.detectChanges();
    editor.onSubmitEdit();

    http
      .expectOne(`${environment.apiUrl}/workflow-templates/transitions/transition-1`)
      .flush({
        transition: { ...TRANSITION, requiredPermission: 'capa:approve' },
        permissionWarning: 'UNKNOWN_PERMISSION',
      });
    fixture.detectChanges();

    // No template refetch may be in flight — that request is what destroyed
    // the dialog. http.verify() in the finally block enforces it.
    const sameInstance =
      (fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent))
        ?.componentInstance as WorkflowTransitionEditorComponent) === editor;

    expect(sameInstance).withContext('editor must not be recreated').toBe(true);
    expect(editor.showEditDialog()).withContext('dialog must stay open').toBe(true);
    expect(editor.editPermissionWarning()).toBe('UNKNOWN_PERMISSION');

    // Closing flushes the deferred refresh — the list must still end up fresh.
    editor.onEditDialogVisibleChange(false);
    fixture.detectChanges();
    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(template());
    fixture.detectChanges();
    // Drained twice, and the second time is not redundant: reopening the
    // expanded row rebuilds the editor, which fetches its role list again.
    drainRoles(http);
    fixture.detectChanges();
    drainRoles(http);

    http.verify();
  });
});

// ACC-160, as the drawn list shows it (ACC-255 PR 4a) — one name per stage, in
// the reader's language. A stage is a record's identity there, so a stage with
// no Arabic name reads in English in an Arabic session: never a blank, never
// "null" (ACC-160's identity rule). The list no longer has a separate Arabic
// slot (Workflow Setup, section 3).
describe('WorkflowStageList — the stage name in the reader\'s language (ACC-160)', () => {
  preserveDocumentLanguage();

  function namesWith(stageNameAr: string | null, lang: 'en' | 'ar'): string[] {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [WorkflowStageListComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: { get: () => 'template-1' }, queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    TestBed.inject(LanguageService).use(lang);
    const fixture = TestBed.createComponent(WorkflowStageListComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const t = template();
    http
      .expectOne(`${environment.apiUrl}/workflow-templates/template-1`)
      .flush({ ...t, stages: [{ ...t.stages[0], nameEn: 'Formation', nameAr: stageNameAr }] });
    fixture.detectChanges();
    http.match(() => true).forEach((r) => r.flush([]));
    return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[data-stage-name]')).map((e) =>
      (e.textContent ?? '').trim(),
    );
  }

  it('reads the Arabic name in Arabic and the English name in English', () => {
    expect(namesWith('التكوين', 'ar')).toEqual(['التكوين']);
    expect(namesWith('التكوين', 'en')).toEqual(['Formation']);
  });

  it('falls back to English in Arabic when the stage has no Arabic name, never a blank', () => {
    const names = namesWith(null, 'ar');
    expect(names).toEqual(['Formation']);
    expect(names.join('')).not.toContain('null');
  });
});
