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
import { LanguageService } from '../../../../core/services/language.service';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';

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

  kind: 'ADVANCE' as const,
};

// ACC-120 slice 5 (PR B) — inUse is what the picker filters on: the documents
// keys are not checked by any code yet, and platform:admin is hidden inside a
// tenant (the spec's NavigationAccessService is the real one: not the platform
// organisation).
const PERMISSIONS = [
  { id: 'p1', module: 'committees', action: 'view', description: null, inUse: true },
  { id: 'p2', module: 'committees', action: 'manage', description: null, inUse: true },
  { id: 'p3', module: 'committees', action: 'approve', description: null, inUse: true },
  { id: 'p4', module: 'documents', action: 'view', description: null, inUse: false },
  { id: 'p5', module: 'documents', action: 'review', description: null, inUse: false },
  { id: 'p6', module: 'platform', action: 'admin', description: null, inUse: true },
];

/** A seeded Document Lifecycle-style transition: its key exists, but nothing checks it yet. */
const NOT_GRANTABLE: WorkflowTransitionDto = {
  ...EXISTING,
  id: 'transition-doc',
  labelEn: 'Send for Review',
  labelAr: 'إرسال للمراجعة',
  requiredPermission: 'documents:review',
};

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

    http
      .expectOne(`${environment.apiUrl}/roles?pageSize=200`)
      .flush({ data: [], total: 0, page: 1, pageSize: 200 });
    http.expectOne(`${environment.apiUrl}/roles/permissions`).flush(PERMISSIONS);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function openPermissionPicker(): HTMLElement[] {
    // ACC-208 — the permission picker is on step 2 of both dialogs.
    component.addStep.set(2);
    component.editStep.set(2);
    fixture.detectChanges();
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

  // ACC-208 — the transition's kind (drawing section 3.2).
  describe('Kind', () => {
    it('starts at Advance on Add, whatever stage it points to, and sends it', async () => {
      fixture.componentRef.setInput('availableStages', [
        { id: 'stage-0', nameEn: 'Earlier', nameAr: null, order: 0 },
        { id: 'stage-1', nameEn: 'Here', nameAr: null, order: 10 },
      ]);
      component.openAdd();
      component.addForm.patchValue({ toStageId: 'stage-0', labelEn: 'Send it back' });
      fixture.detectChanges();
      await fixture.whenStable();

      // Never inferred from stage order: an earlier target stays Advance.
      expect(component.addForm.controls.kind.value).toBe('ADVANCE');
      const radios = Array.from(document.querySelectorAll('.am-tr-kind__row')).map((r) => [
        r.querySelector('.am-tr-kind__title')?.textContent?.trim(),
        r.querySelector('.am-tr-kind__help')?.textContent?.trim(),
      ]);
      expect(radios).toEqual([
        ['workflow.kind.advance', 'workflow.kind.advanceHelp'],
        ['workflow.kind.return', 'workflow.kind.returnHelp'],
        ['workflow.kind.exit', 'workflow.kind.exitHelp'],
      ]);

      component.addForm.controls.kind.setValue('RETURN');
      component.addStep.set(2);
      component.onSubmitAdd();
      const req = http.expectOne(TRANSITIONS_URL);
      expect(req.request.body).toEqual(jasmine.objectContaining({ kind: 'RETURN', toStageId: 'stage-0' }));
      req.flush({ transition: { ...EXISTING, id: 'new', kind: 'RETURN' }, permissionWarning: null });
    });

    it('shows the stored kind on Edit and sends the one chosen', () => {
      component.openEdit({ ...EXISTING, kind: 'EXIT' });
      expect(component.editForm.controls.kind.value).toBe('EXIT');
      component.editForm.controls.kind.setValue('RETURN');
      component.onSubmitEdit();
      const req = http.expectOne(`${TRANSITIONS_URL}/transition-1`);
      expect(req.request.body).toEqual(jasmine.objectContaining({ kind: 'RETURN' }));
      req.flush({ transition: { ...EXISTING, kind: 'RETURN' }, permissionWarning: null });
    });

    it('will not move on to step 2 until the move is described', () => {
      component.openAdd();
      expect(component.addStepOneInvalid()).toBeTrue();
      component.addForm.patchValue({ toStageId: 'stage-2', labelEn: 'Approve' });
      expect(component.addStepOneInvalid()).toBeFalse();
    });

    it('labels each row of the table with its kind', () => {
      fixture.componentRef.setInput('transitions', [
        EXISTING,
        { ...EXISTING, id: 't-return', kind: 'RETURN' },
        { ...EXISTING, id: 't-exit', kind: 'EXIT' },
      ]);
      fixture.detectChanges();
      const chips = Array.from(fixture.nativeElement.querySelectorAll('[data-tr-kind]')) as HTMLElement[];
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['workflow.kind.advance', 'workflow.kind.return', 'workflow.kind.exit']);
      expect(chips[1].classList).toContain('am-tr-chip--return');
    });

    it('opens the warning an Add produced on step 2 of Edit, where the permission is (ACC-55)', () => {
      component.openAdd();
      component.addForm.patchValue({ toStageId: 'stage-2', labelEn: 'Approve' });
      component.onSubmitAdd();
      http.expectOne(TRANSITIONS_URL).flush({ transition: { ...EXISTING, id: 'new' }, permissionWarning: 'NO_ACTIVE_ROLE_HOLDS' });
      expect(component.showEditDialog()).toBeTrue();
      expect(component.editStep()).toBe(2);
      expect(component.editPermissionWarning()).toBe('NO_ACTIVE_ROLE_HOLDS');
    });
  });

  // ACC-208 (D5) — create never sent isApprovalPath, so a box ticked on Add
  // was silently dropped. It is offered only where it saves: on Edit.
  it('offers Approval path on Edit only, never on Add', async () => {
    component.openAdd();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.querySelector('#add-isApprovalPath')).toBeNull();
    expect(component.addForm.contains('isApprovalPath' as never)).toBeFalse();

    component.onAddDialogVisibleChange(false);
    component.openEdit(EXISTING);
    component.editStep.set(2); // ACC-208 — it sits on step 2, with who may fire it
    fixture.detectChanges();
    await fixture.whenStable();
    expect(document.querySelector('#edit-isApprovalPath')).not.toBeNull();
  });

  // ── ACC-120 slice 5 (F1, PR B) — which keys the picker offers ─────────────
  describe('which keys the picker offers (part of ACC-120)', () => {
    const texts = (rows: HTMLElement[]): string[] => rows.map((el) => el.textContent?.trim() ?? '');

    it('offers only keys in use, and no platform key inside a tenant', () => {
      fixture.componentRef.setInput('transitions', [EXISTING, NOT_GRANTABLE]);
      component.openAdd();
      fixture.detectChanges();

      const offered = texts(openPermissionPicker());
      expect(offered).toContain('committees:approve');
      expect(offered).not.toContain('documents:view');
      expect(offered).not.toContain('documents:review');
      expect(offered).not.toContain('platform:admin');
      // No heading for a module with nothing to offer.
      expect(offered).not.toContain('documents');
    });

    it('shows the transition’s own ungrantable key as current, in its own group, on Edit only', () => {
      fixture.componentRef.setInput('transitions', [EXISTING, NOT_GRANTABLE]);
      component.openEdit(NOT_GRANTABLE);
      fixture.detectChanges();

      expect(component.editForm.controls.requiredPermission.value).toBe('documents:review');
      const editRows = texts(openPermissionPicker());
      expect(editRows).toContain('workflow.permissionNotGrantable');
      expect(editRows).toContain('documents:review');
      expect(editRows.indexOf('documents:review')).toBeGreaterThan(editRows.indexOf('workflow.permissionNotGrantable'));

      // Another transition's ungrantable key is never offered to this one.
      component.onEditDialogVisibleChange(false);
      component.openEdit(EXISTING);
      fixture.detectChanges();
      expect(texts(openPermissionPicker())).not.toContain('documents:review');
    });

    it('an unrelated edit sends the ungrantable key back unchanged, never blanked', () => {
      component.openEdit(NOT_GRANTABLE);
      fixture.detectChanges();
      component.editForm.controls.labelEn.setValue('Send for Review (renamed)');
      component.onSubmitEdit();

      const req = http.expectOne(`${TRANSITIONS_URL}/transition-doc`);
      expect(req.request.body.requiredPermission).toBe('documents:review');
      expect(req.request.body.labelEn).toBe('Send for Review (renamed)');
      req.flush({ transition: NOT_GRANTABLE, permissionWarning: null });
    });
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

// ACC-82 — the transitions table names the role a ROLE_BASED transition is
// restricted to. "ROLE_BASED" alone did not say which transition a Setup
// health stage Fix had landed on to repair.
describe('WorkflowTransitionEditorComponent — trigger role in the table (ACC-82)', () => {
  const ROLE = {
    id: 'role-auditor',
    organizationId: 'org-a',
    key: 'AUDITOR',
    nameEn: 'Auditor',
    nameAr: 'مدقق',
    description: null,
    isSystem: true,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  function render(transitions: WorkflowTransitionDto[], arabic = false): HTMLElement {
    TestBed.configureTestingModule({
      imports: [WorkflowTransitionEditorComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            // ACC-160 — the real rule, under this mock's own language flag.
            bilingual: (en: string, ar: string | null | undefined) => pickBilingualName(en, ar, arabic),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(WorkflowTransitionEditorComponent);
    fixture.componentRef.setInput('stageId', 'stage-1');
    fixture.componentRef.setInput('transitions', transitions);
    fixture.componentRef.setInput('availableStages', []);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiUrl}/roles?pageSize=200`)
      .flush({ data: [ROLE], total: 1, page: 1, pageSize: 200 });
    http.expectOne(`${environment.apiUrl}/roles/permissions`).flush(PERMISSIONS);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const rowText = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('tbody tr')).map((tr) => (tr.textContent ?? '').replace(/\s+/g, ' ').trim());

  it('shows the role’s name beside ROLE_BASED', () => {
    const el = render([{ ...EXISTING, triggerRoleId: 'role-auditor' }]);
    expect(rowText(el)[0]).toContain('ROLE_BASED');
    expect(el.querySelector('tbody tr td:nth-child(4) span.ms-2')?.textContent?.trim()).toBe('Auditor');
  });

  it('shows the Arabic name in an Arabic session', () => {
    const el = render([{ ...EXISTING, triggerRoleId: 'role-auditor' }], true);
    expect(rowText(el)[0]).toContain('مدقق');
  });

  // The case that leaves a stage unfireable must not look like "no role".
  it('says the role is unknown when the id matches no role', () => {
    const el = render([{ ...EXISTING, triggerRoleId: 'role-deleted' }]);
    expect(rowText(el)[0]).toContain('workflow.triggerRoleUnknown');
  });

  it('adds nothing when a ROLE_BASED transition has no role, or the condition is not role-based', () => {
    const el = render([
      { ...EXISTING, id: 't-no-role', triggerRoleId: null },
      { ...EXISTING, id: 't-any', triggerCondition: 'ANY_AUTHENTICATED', triggerRoleId: 'role-auditor' },
    ]);
    expect(rowText(el)[0]).not.toContain('Auditor');
    expect(rowText(el)[1]).not.toContain('Auditor');
  });
});

// ACC-120 slice 10 — the Actions dialog is a raw p-dialog, so it registers on
// the layer stack itself and answers Escape only while it is the top layer.
// Before this it was on no stack: PrimeNG's own Escape went by z-index, and
// once Remove action's confirm returned focus to the trash button, that
// button's tooltip held the top z-index and Escape no longer closed the dialog.
describe('WorkflowTransitionEditorComponent — the Actions dialog is a layer (ACC-120 slice 10)', () => {
  let fixture: ComponentFixture<WorkflowTransitionEditorComponent>;
  let component: WorkflowTransitionEditorComponent;
  let layers: LayerStackService;

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
    layers = TestBed.inject(LayerStackService);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.match(() => true).forEach((r) => r.flush([]));
  });

  afterEach(() => {
    document.querySelectorAll('.p-dialog, .p-dialog-mask').forEach((n) => n.remove());
  });

  const escape = (): void => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };

  it('holds a layer while open, and releases it on close', () => {
    expect(layers.depth()).withContext('nothing open yet').toBe(0);
    component.openActions(EXISTING);
    fixture.detectChanges();
    expect(component.showActionsDialog()).toBeTrue();
    expect(layers.depth()).toBe(1);

    component.showActionsDialog.set(false);
    fixture.detectChanges();
    expect(layers.depth()).toBe(0);
  });

  it('one Escape closes it while it is the top layer', () => {
    component.openActions(EXISTING);
    fixture.detectChanges();
    escape();
    expect(component.showActionsDialog()).toBeFalse();
    expect(layers.depth()).toBe(0);
  });

  it('Escape leaves it open while a layer above it (a confirm) owns Escape', () => {
    component.openActions(EXISTING);
    fixture.detectChanges();
    const confirmLayer = layers.push();
    escape();
    expect(component.showActionsDialog()).withContext('the confirm owns this Escape').toBeTrue();

    layers.remove(confirmLayer);
    escape();
    expect(component.showActionsDialog()).withContext('and the next one closes the dialog').toBeFalse();
  });

  it('ignores Escape while closed', () => {
    const spy = spyOn(component.showActionsDialog, 'set').and.callThrough();
    escape();
    expect(spy).not.toHaveBeenCalled();
  });
});
