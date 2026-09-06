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
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../../environments/environment';
import { WorkflowStageListComponent } from './workflow-stage-list.component';
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
          useValue: { snapshot: { paramMap: { get: () => 'template-1' } } },
        },
      ],
    });

    const fixture = TestBed.createComponent(WorkflowStageListComponent);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(`${environment.apiUrl}/workflow-templates/template-1`).flush(template());
    fixture.detectChanges();

    fixture.componentInstance.expandedRowKeys.set({ 'stage-1': true });
    fixture.detectChanges();

    const editorDebug = fixture.debugElement.query(By.directive(WorkflowTransitionEditorComponent));
    const editor = editorDebug.componentInstance as WorkflowTransitionEditorComponent;
    http.match(`${environment.apiUrl}/roles`).forEach((r) => r.flush([]));
    http.match(`${environment.apiUrl}/roles/permissions`).forEach((r) => r.flush([]));
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
    http.match(`${environment.apiUrl}/roles`).forEach((r) => r.flush([]));
    http.match(`${environment.apiUrl}/roles/permissions`).forEach((r) => r.flush([]));

    http.verify();
  });
});
