// ACC-55 live-pass regressions. Both tests here were confirmed to FAIL
// against the pre-fix code before the fixes were written — see each test's
// own note for what it produced then.
//
// TEST 1: a save returning a warning notified the parent immediately, whose
//         list reload destroyed and recreated this component, wiping the
//         open dialog and the warning it was showing.
// TEST 3: module headings were selectable, and selecting one saved
//         requiredPermission: null — silently CLEARING an existing
//         permission rather than being inert as originally claimed.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { WorkflowTransitionEditorComponent } from './workflow-transition-editor.component';
import { WorkflowTransitionDto } from '../../services/workflow-template.service';

const EXISTING: WorkflowTransitionDto = {
  id: 'transition-1',
  fromStageId: 'stage-1',
  toStageId: 'stage-2',
  labelEn: 'Approve Committee',
  labelAr: 'اعتماد اللجنة',
  requiredPermission: 'committees:manage',
  triggerCondition: 'ROLE_BASED',
  triggerUserId: null,
  triggerRoleId: null,
  validatorConfig: null,
  isApprovalPath: false,
};

const PERMISSIONS = [
  { id: 'p1', module: 'committees', action: 'view', description: null },
  { id: 'p2', module: 'committees', action: 'manage', description: null },
  { id: 'p3', module: 'committees', action: 'approve', description: null },
  { id: 'p4', module: 'documents', action: 'view', description: null },
];

const TRANSITIONS_URL = `${environment.apiUrl}/workflow-templates/transitions`;

describe('WorkflowTransitionEditorComponent (ACC-55)', () => {
  let fixture: ComponentFixture<WorkflowTransitionEditorComponent>;
  let component: WorkflowTransitionEditorComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionEditorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
      ],
    });

    fixture = TestBed.createComponent(WorkflowTransitionEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('stageId', 'stage-1');
    fixture.componentRef.setInput('transitions', [EXISTING]);
    fixture.componentRef.setInput('availableStages', []);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne(`${environment.apiUrl}/roles`).flush([]);
    http.expectOne(`${environment.apiUrl}/roles/permissions`).flush(PERMISSIONS);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openPermissionPicker(): HTMLElement[] {
    // The permission picker is the last overlay-select in the open dialog.
    const triggers = Array.from(
      document.querySelectorAll('.am-overlay-select-trigger'),
    ) as HTMLElement[];
    triggers[triggers.length - 1]!.click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll('.am-overlay-select-option')) as HTMLElement[];
  }

  // ── TEST 1 — deferred parent notification ─────────────────────────────────
  describe('a save returning a warning keeps its surface alive', () => {
    // PRE-FIX: emitted immediately, so workflow-stage-list reloaded, p-table
    // rebuilt the expanded row, and this component was destroyed mid-warning.
    it('does NOT notify the parent while the EDIT dialog stays open on a warning', () => {
      const changed = jasmine.createSpy('changed');
      component.changed.subscribe(changed);

      component.openEdit(EXISTING);
      fixture.detectChanges();
      component.onSubmitEdit();

      http.expectOne(`${TRANSITIONS_URL}/transition-1`).flush({
        transition: { ...EXISTING, requiredPermission: 'capa:approve' },
        permissionWarning: 'UNKNOWN_PERMISSION',
      });
      fixture.detectChanges();

      expect(component.showEditDialog()).toBe(true);
      expect(component.editPermissionWarning()).toBe('UNKNOWN_PERMISSION');
      expect(changed).not.toHaveBeenCalled();
    });

    it('does NOT notify the parent while the ADD path holds a warning open', () => {
      // The add path's checkpoint claim was asserted, never verified, and was
      // wrong: it emitted too, so its create->edit switch was destroyed the
      // same way. Both paths are pinned here so they cannot diverge again.
      const changed = jasmine.createSpy('changed');
      component.changed.subscribe(changed);

      component.openAdd();
      component.addForm.patchValue({
        toStageId: 'stage-2',
        labelEn: 'New',
        labelAr: 'جديد',
        triggerCondition: 'ROLE_BASED',
        requiredPermission: 'capa:approve',
      });
      fixture.detectChanges();
      component.onSubmitAdd();

      http.expectOne(TRANSITIONS_URL).flush({
        transition: { ...EXISTING, id: 'transition-2', requiredPermission: 'capa:approve' },
        permissionWarning: 'UNKNOWN_PERMISSION',
      });
      fixture.detectChanges();

      expect(component.showAddDialog()).toBe(false);
      expect(component.showEditDialog()).toBe(true);
      expect(component.editPermissionWarning()).toBe('UNKNOWN_PERMISSION');
      expect(changed).not.toHaveBeenCalled();
    });

    it('flushes the deferred refresh once the dialog is finally closed', () => {
      const changed = jasmine.createSpy('changed');
      component.changed.subscribe(changed);

      component.openEdit(EXISTING);
      fixture.detectChanges();
      component.onSubmitEdit();
      http.expectOne(`${TRANSITIONS_URL}/transition-1`).flush({
        transition: { ...EXISTING, requiredPermission: 'capa:approve' },
        permissionWarning: 'UNKNOWN_PERMISSION',
      });
      fixture.detectChanges();
      expect(changed).not.toHaveBeenCalled();

      // Any exit route must flush — this is the one a Cancel click takes.
      component.onEditDialogVisibleChange(false);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('notifies the parent immediately when there is no warning', () => {
      const changed = jasmine.createSpy('changed');
      component.changed.subscribe(changed);

      component.openEdit(EXISTING);
      fixture.detectChanges();
      component.onSubmitEdit();
      http.expectOne(`${TRANSITIONS_URL}/transition-1`).flush({
        transition: EXISTING,
        permissionWarning: null,
      });
      fixture.detectChanges();

      expect(component.showEditDialog()).toBe(false);
      expect(changed).toHaveBeenCalledTimes(1);
    });

    it('does not double-notify when a warning-free save is followed by a close', () => {
      const changed = jasmine.createSpy('changed');
      component.changed.subscribe(changed);

      component.openEdit(EXISTING);
      fixture.detectChanges();
      component.onSubmitEdit();
      http.expectOne(`${TRANSITIONS_URL}/transition-1`).flush({
        transition: EXISTING,
        permissionWarning: null,
      });
      fixture.detectChanges();

      component.onEditDialogVisibleChange(false);
      expect(changed).toHaveBeenCalledTimes(1);
    });
  });

  // ── TEST 3 — module headings are not choices ──────────────────────────────
  describe('module headings cannot be selected', () => {
    // PRE-FIX: clicking the heading set the control to '__module__:committees'
    // and saving sent requiredPermission: null, stripping committees:manage.
    it('clicking a module heading does not change the bound value', () => {
      component.openEdit(EXISTING);
      fixture.detectChanges();

      const rows = openPermissionPicker();
      const heading = rows.find((el) => el.textContent?.trim() === 'committees');
      expect(heading).withContext('module heading should render').toBeTruthy();

      heading!.click();
      fixture.detectChanges();

      expect(component.editForm.controls.requiredPermission.value).toBe('committees:manage');
    });

    it('marks headings disabled so CDK skips them for keyboard nav too', () => {
      component.openEdit(EXISTING);
      fixture.detectChanges();

      const rows = openPermissionPicker();
      const heading = rows.find((el) => el.textContent?.trim() === 'committees')!;
      const leaf = rows.find((el) => el.textContent?.trim() === 'committees:manage')!;

      // CdkListbox drives its ActiveDescendantKeyManager with
      // skipPredicate(option => option.disabled), so aria-disabled is the
      // same flag that governs keyboard navigation, not just pointer input.
      expect(heading.getAttribute('aria-disabled')).toBe('true');
      expect(leaf.getAttribute('aria-disabled')).toBe('false');
    });

    it('selecting a heading cannot clear an existing permission', () => {
      component.openEdit(EXISTING);
      fixture.detectChanges();

      const rows = openPermissionPicker();
      rows.find((el) => el.textContent?.trim() === 'committees')!.click();
      fixture.detectChanges();

      component.onSubmitEdit();

      const req = http.expectOne(`${TRANSITIONS_URL}/transition-1`);
      // The regression: this was null pre-fix, wiping the permission gate and
      // widening who could fire the transition.
      expect(req.request.body.requiredPermission).toBe('committees:manage');
      req.flush({ transition: EXISTING, permissionWarning: null });
    });

    it('a real permission leaf is still selectable', () => {
      component.openEdit(EXISTING);
      fixture.detectChanges();

      const rows = openPermissionPicker();
      rows.find((el) => el.textContent?.trim() === 'committees:approve')!.click();
      fixture.detectChanges();

      expect(component.editForm.controls.requiredPermission.value).toBe('committees:approve');
    });
  });

  // ── Forward-reference round-trip (the constraint from the checkpoint) ─────
  it('round-trips a forward-reference permission unchanged', () => {
    const forward = { ...EXISTING, requiredPermission: 'capa:approve' };
    component.openEdit(forward);
    fixture.detectChanges();

    expect(component.editForm.controls.requiredPermission.value).toBe('capa:approve');
    // It must be a real, selectable option, not silently dropped.
    const rows = openPermissionPicker();
    expect(rows.map((el) => el.textContent?.trim())).toContain('capa:approve');

    component.onSubmitEdit();
    const req = http.expectOne(`${TRANSITIONS_URL}/transition-1`);
    expect(req.request.body.requiredPermission).toBe('capa:approve');
    req.flush({ transition: forward, permissionWarning: 'UNKNOWN_PERMISSION' });
  });

  it('does not strand a deferred refresh when the dialog closes via the X or Escape', () => {
    // EditDialogComponent emits visibleChange for every exit route, so all of
    // them land on the same handler the Cancel button uses.
    const changed = jasmine.createSpy('changed');
    component.changed.subscribe(changed);

    component.openAdd();
    component.addForm.patchValue({
      toStageId: 'stage-2',
      labelEn: 'New',
      labelAr: 'جديد',
      triggerCondition: 'ROLE_BASED',
      requiredPermission: 'capa:close',
    });
    component.onSubmitAdd();
    http.expectOne(TRANSITIONS_URL).flush({
      transition: { ...EXISTING, id: 'transition-3', requiredPermission: 'capa:close' },
      permissionWarning: 'UNKNOWN_PERMISSION',
    });
    fixture.detectChanges();
    expect(changed).not.toHaveBeenCalled();

    component.onEditDialogVisibleChange(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('the blank option clears the permission', () => {
    component.openEdit(EXISTING);
    fixture.detectChanges();

    component.editForm.controls.requiredPermission.setValue('');
    component.onSubmitEdit();

    const req = http.expectOne(`${TRANSITIONS_URL}/transition-1`);
    expect(req.request.body.requiredPermission).toBeNull();
    req.flush({ transition: { ...EXISTING, requiredPermission: null }, permissionWarning: null });
  });
});
