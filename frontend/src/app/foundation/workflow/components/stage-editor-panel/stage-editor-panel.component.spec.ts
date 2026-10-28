import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { WorkflowStageDto, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { StageEditorPanelComponent } from './stage-editor-panel.component';

// ACC-255 PR 4b — the stage editor as a page panel (plan §17; Workflow Setup,
// sections 2 and 3), and ACC-208's refusals under their own fields, moved with
// it from the stage form dialog. Everything the panel shows about what a stage
// allows and means comes from the template the server sends: the registries,
// each action's permissionKey, isProtected and editableStageFields.

const API = environment.apiUrl;

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
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
  actions: ['add_member', 'remove_member', 'change_member_role'],
  flags: [],
};

const RECORD_ACTIONS = [
  { key: 'edit_details', labelKey: 'workflow.recordAction.COMMITTEE.edit_details', permissionKey: 'committees:edit_details' },
  { key: 'add_member', labelKey: 'workflow.recordAction.COMMITTEE.add_member', permissionKey: 'committees:add_member' },
  { key: 'remove_member', labelKey: 'workflow.recordAction.COMMITTEE.remove_member', permissionKey: 'committees:remove_member' },
  { key: 'change_member_role', labelKey: 'workflow.recordAction.COMMITTEE.change_member_role', permissionKey: 'committees:change_member_role' },
  { key: 'request_change', labelKey: 'workflow.recordAction.COMMITTEE.request_change', permissionKey: 'committees:edit_details' },
];
const COMMITTEE_FLAGS = [
  { key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' as const },
  { key: 'IN_FORCE', labelKey: 'workflow.stageFlag.IN_FORCE', cardinality: 'any' as const },
];

const OTHER: WorkflowStageDto = { ...STAGE, id: 'stage-2', nameEn: 'Active', nameAr: 'نشطة', order: 30 };

const COMMITTEE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: null,
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  isProtected: false,
  createdAt: '',
  updatedAt: '',
  stages: [STAGE, OTHER],
  recordActions: RECORD_ACTIONS,
  stageFlags: COMMITTEE_FLAGS,
};

const REQUEST_STAGE: WorkflowStageDto = { ...STAGE, id: 'cr-approved', nameEn: 'Approved', nameAr: 'معتمد', actions: [], flags: ['APPLIES_APPROVED_CHANGE'] };
const PROTECTED: WorkflowTemplateDto = {
  ...COMMITTEE,
  id: 'template-cr',
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isProtected: true,
  editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'],
  stages: [REQUEST_STAGE],
  recordActions: [],
  stageFlags: [{ key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' }],
};

describe('StageEditorPanelComponent (ACC-255 PR 4b)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<StageEditorPanelComponent>;
  let http: HttpTestingController;
  let confirm: jasmine.Spy;

  async function setup(
    opts: { language?: 'en' | 'ar'; template?: WorkflowTemplateDto; stage?: WorkflowStageDto | null } = {},
  ): Promise<StageEditorPanelComponent> {
    const language = opts.language ?? 'en';
    confirm = jasmine.createSpy('ask');
    TestBed.configureTestingModule({
      imports: [StageEditorPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AmConfirmService, useValue: { ask: confirm } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StageEditorPanelComponent);
    fixture.componentRef.setInput('template', opts.template ?? COMMITTEE);
    fixture.componentRef.setInput('stage', opts.stage === undefined ? STAGE : opts.stage);
    fixture.detectChanges();
    // The pickers' lists; the roles list is the paginated envelope.
    http.match(() => true).forEach((r) => r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []));
    fixture.detectChanges();
    // ngModel writes the boxes' values after a turn.
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (selector: string): string | null => el().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const texts = (selector: string): string[] =>
    Array.from(el().querySelectorAll<HTMLElement>(selector)).map((n) => n.textContent!.replace(/\s+/g, ' ').trim());
  const rowTitles = (section: string): string[] => texts(`[data-section="${section}"] [data-check-row] .am-checks__title`);
  const box = (key: string): HTMLInputElement => el().querySelector<HTMLInputElement>(`[data-check-row="${key}"] input[type="checkbox"]`)!;
  const tick = (key: string): void => {
    box(key).click();
    fixture.detectChanges();
  };

  const submit = (): TestRequest => {
    fixture.componentInstance.onSubmit();
    return http.expectOne((r) => r.url.startsWith(`${API}/workflow-templates/`));
  };
  const refuse = (body: Record<string, unknown>, status: number): void => {
    submit().flush({ statusCode: status, message: 'English for a log', ...body }, { status, statusText: 'Refused' });
    fixture.detectChanges();
  };

  afterEach(() => http.verify());

  // ── Sections 2 and 3, from the server ──────────────────────────────────────

  it('lists every record action the template offers, with its description and "Also needs" from its permissionKey', async () => {
    await setup();
    expect(rowTitles('actions')).toEqual(['Edit details', 'Add member', 'Remove member', 'Change member role', 'Request a change']);
    expect(texts('[data-section="actions"] .am-checks__desc')[1]).toBe('Add a person to a seat.');
    expect(texts('[data-section="actions"] [data-check-aside]')).toEqual([
      "Also needs: Edit a committee's details and request changes",
      'Also needs: Add members to a committee',
      'Also needs: Remove members from a committee',
      'Also needs: Change a member’s role on a committee',
      "Also needs: Edit a committee's details and request changes",
    ]);
    // Ticked as the stage stores them.
    expect(RECORD_ACTIONS.map((a) => box(a.key).checked)).toEqual([false, true, true, true, false]);
  });

  it('lists the meanings with the drawing’s wording and their cardinality', async () => {
    await setup();
    expect(rowTitles('meanings')).toEqual(['Dissolving', 'Record is in force']);
    expect(texts('[data-section="meanings"] .am-checks__desc')).toEqual([
      "Committees here can't be a parent or be reported to.",
      'Counted as active in lists. Change requests can be submitted and decided here.',
    ]);
    expect(texts('[data-section="meanings"] [data-check-aside]')).toEqual(['Any number', 'Any number']);
  });

  it('reads in Arabic, with the Arabic permission sentence', async () => {
    await setup({ language: 'ar' });
    expect(rowTitles('actions')[0]).toBe('تعديل التفاصيل');
    expect(texts('[data-section="actions"] [data-check-aside]')[0]).toBe('تتطلب أيضًا: تعديل تفاصيل اللجنة وطلب تغييرات');
    expect(texts('[data-section="meanings"] [data-check-aside]')[0]).toBe('أي عدد');
    expect(text('[data-panel-heading]')).toBe('مراجعة الشروط');
  });

  it('a record type with no actions says so, rather than leaving the section out', async () => {
    await setup({ template: { ...COMMITTEE, recordActions: [], stageFlags: [] } });
    expect(text('[data-actions-empty]')).toBe('This record type has no actions a stage can limit yet.');
    expect(text('[data-meanings-empty]')).toBe('This record type has no meanings a stage can carry yet.');
  });

  it('shows the deadline in words through the formatting layer', async () => {
    await setup();
    expect(text('[data-card="identity"]')).toContain('40 working hours');
  });

  // ── Changes ────────────────────────────────────────────────────────────────

  it('tints a changed row, counts the changes politely, and names them', async () => {
    await setup();
    expect(text('[data-change-count]')).toBe('');
    tick('add_member');
    tick('IN_FORCE');
    const changed = Array.from(el().querySelectorAll('[data-check-row].am-checks__row--changed')).map((r) => r.getAttribute('data-check-row'));
    expect(changed).toEqual(['add_member', 'IN_FORCE']);
    expect(el().querySelector('[data-change-count]')!.getAttribute('aria-live')).toBe('polite');
    expect(text('[data-change-count]')).toBe('2 changes');
    expect(text('[data-changed-note]')).toBe(
      "Changed since saving: Add member, Record is in force. Saved changes are recorded in the workflow's history.",
    );
    // Ticking it back is no change.
    tick('add_member');
    expect(text('[data-change-count]')).toBe('1 change');
  });

  it('sends only a changed section, in registry order; Save keeps the panel and its focus, and says it saved', async () => {
    const panel = await setup();
    const saved = jasmine.createSpy('saved');
    panel.saved.subscribe(saved);
    tick('request_change');
    tick('edit_details');
    const save = el().querySelector<HTMLButtonElement>('[data-panel-save] button')!;
    save.focus();
    const req = submit();
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.actions).toEqual(['edit_details', 'add_member', 'remove_member', 'change_member_role', 'request_change']);
    expect('flags' in req.request.body).toBeFalse();
    req.flush({ ...STAGE, actions: req.request.body.actions });
    fixture.detectChanges();
    expect(saved).toHaveBeenCalled();
    expect(el().querySelectorAll('.am-checks__row--changed').length).toBe(0);
    expect(text('[data-change-count]')).toBe('Stage saved');
    expect(document.activeElement).toBe(save);
  });

  it('an unchanged stage sends neither section', async () => {
    await setup();
    const req = submit();
    expect('actions' in req.request.body).toBeFalse();
    expect('flags' in req.request.body).toBeFalse();
    req.flush(STAGE);
  });

  it('a reload of the same stage keeps unsaved work (ACC-55); another stage loads afresh', async () => {
    const panel = await setup();
    tick('edit_details');
    fixture.componentRef.setInput('stage', { ...STAGE });
    fixture.detectChanges();
    expect(box('edit_details').checked).toBeTrue();
    expect(panel.hasChanges()).toBeTrue();
    fixture.componentRef.setInput('stage', OTHER);
    fixture.detectChanges();
    expect(panel.hasChanges()).toBeFalse();
    expect(text('[data-panel-heading]')).toBe('Active');
  });

  // ── Adding a stage (Ahmad's Q1) ────────────────────────────────────────────

  it('while adding, shows no action or meaning boxes, only the line, and sends neither', async () => {
    await setup({ stage: null });
    expect(el().querySelector('[data-section]')).toBeNull();
    expect(text('[data-adding-note]')).toBe("You can set what this stage allows once it's added.");
    fixture.componentInstance.form.controls.nameEn.setValue('Board review');
    const req = submit();
    expect(req.request.method).toBe('POST');
    expect('actions' in req.request.body).toBeFalse();
    expect('flags' in req.request.body).toBeFalse();
    req.flush({ ...STAGE, id: 'stage-new' });
  });

  it('says the adding line in Arabic', async () => {
    await setup({ stage: null, language: 'ar' });
    expect(text('[data-adding-note]')).toBe('يمكن تحديد ما تسمح به هذه المرحلة بعد إضافتها.');
  });

  // ── A protected workflow (Ahmad's Q2) ──────────────────────────────────────

  it('a protected workflow shows its sentence and renders every field the server leaves out read-only', async () => {
    await setup({ template: PROTECTED, stage: REQUEST_STAGE });
    expect(text('[data-protected-banner] .am-sep__banner-title')).toBe('Protected workflow');
    expect(text('[data-protected-banner] .am-sep__banner-body')).toBe(
      'AccreditMe keeps this workflow working: you can rename its stages and set their deadlines, but not change what they allow or mean.',
    );
    // The meanings: ✓ and –, no box to press.
    expect(el().querySelectorAll('[data-section="meanings"] input[type="checkbox"]').length).toBe(0);
    expect(texts('[data-section="meanings"] .am-checks__mark')).toEqual(['✓']);
    // Names, description and deadline stay editable; the rest is read-only.
    for (const id of ['sep-nameEn', 'sep-nameAr', 'sep-description', 'sep-sla']) {
      expect(el().querySelector(`#${id}`)).withContext(id).not.toBeNull();
    }
    expect(el().querySelector('[data-card="approval"] app-overlay-select')).toBeNull();
    expect(el().querySelector('[data-card="assignee"] app-overlay-select')).toBeNull();
    expect(el().querySelector('[data-readonly-field="isInitial"]')).not.toBeNull();
    expect(el().querySelector('[data-readonly-field="isFinal"]')).not.toBeNull();
    expect(el().querySelector('#sep-isFinal')).toBeNull();
    // A save never sends what the workflow keeps fixed.
    fixture.componentInstance.flags.set(new Set());
    const req = submit();
    expect('flags' in req.request.body).toBeFalse();
    req.flush(REQUEST_STAGE);
  });

  it('says the protected sentence in Arabic', async () => {
    await setup({ template: PROTECTED, stage: REQUEST_STAGE, language: 'ar' });
    expect(text('[data-protected-banner]')).toContain(
      'تحافظ AccreditMe على عمل سير العمل هذا: يمكن إعادة تسمية مراحله وتحديد مهلها، ولا يمكن تغيير ما تسمح به أو ما تعنيه.',
    );
  });

  // ── Refusals ───────────────────────────────────────────────────────────────

  const exactlyOne = (stageIds: string[], names: { nameEn: string; nameAr: string | null }[]) => ({
    code: 'STAGE_FLAG_EXACTLY_ONE',
    flag: 'APPLIES_APPROVED_CHANGE',
    stageNames: names,
    stageIds,
  });
  const UNPROTECTED_CR: WorkflowTemplateDto = { ...PROTECTED, isProtected: false, editableStageFields: undefined };

  it('"Applies the approved change" on another stage: named in its row and the banner, which opens that stage', async () => {
    const panel = await setup({ template: UNPROTECTED_CR, stage: { ...REQUEST_STAGE, id: 'cr-legal', nameEn: 'Legal review', flags: [] } });
    const open = jasmine.createSpy('openStage');
    panel.openStage.subscribe(open);
    tick('APPLIES_APPROVED_CHANGE');
    refuse(exactlyOne(['cr-approved', 'cr-legal'], [{ nameEn: 'Approved', nameAr: 'معتمد' }, { nameEn: 'Legal review', nameAr: null }]), 409);
    const sentence = 'Applies the approved change is already on Approved. A workflow has exactly one.';
    expect(text('[data-check-row="APPLIES_APPROVED_CHANGE"] [data-check-error]')).toBe(sentence);
    expect(text('[data-panel-refusal] .am-sep__banner-title')).toBe("The workflow can't be saved");
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe(sentence);
    expect(el().textContent).not.toContain('English for a log');
    el().querySelector<HTMLButtonElement>('[data-refusal-link]')!.click();
    expect(open).toHaveBeenCalledWith('cr-approved');
  });

  it('says it in Arabic, naming the stage in Arabic', async () => {
    await setup({ template: UNPROTECTED_CR, stage: { ...REQUEST_STAGE, id: 'cr-legal', flags: [] }, language: 'ar' });
    tick('APPLIES_APPROVED_CHANGE');
    refuse(exactlyOne(['cr-approved'], [{ nameEn: 'Approved', nameAr: 'معتمد' }]), 409);
    expect(text('[data-panel-refusal] .am-sep__banner-title')).toBe('تعذّر حفظ سير العمل');
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe(
      '«يطبّق التغيير المعتمد» موجود بالفعل في مرحلة «معتمد». لسير العمل مرحلة واحدة فقط بهذا المعنى.',
    );
    expect(text('[data-refusal-link]')).toBe('فتح معتمد');
  });

  it('the only holder removed: "This workflow needs one stage that applies the approved change."', async () => {
    await setup({ template: UNPROTECTED_CR, stage: REQUEST_STAGE });
    tick('APPLIES_APPROVED_CHANGE');
    refuse(exactlyOne([], []), 409);
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe('This workflow needs one stage that applies the approved change.');
    expect(el().querySelector('[data-refusal-link]')).toBeNull();
  });

  it('any other refusal is said from its code in the banner, never the server’s English', async () => {
    await setup();
    refuse({ code: 'WORKFLOW_TEMPLATE_PROTECTED', edit: 'STAGE_FIELD' }, 409);
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe(en.workflow.refusal.protected.STAGE_FIELD);
  });

  // ── ACC-208's refusals, under their own fields ─────────────────────────────

  it('words a deadline lowered below its tasks under the SLA field, with both numbers and the way out', async () => {
    const panel = await setup();
    panel.form.controls.slaWorkingHours.setValue(12);
    refuse({ code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: ['d1'] }, 409);
    expect(text('[data-sla-refusal]')).toBe(
      'A task on this stage is due in 16 working hours. Set the deadline to at least 16, or give those tasks a higher priority.',
    );
    expect(panel.refusal()).toBeNull();
    expect(el().textContent).not.toContain('English for a log');
  });

  it('clears it once the deadline changes', async () => {
    const panel = await setup();
    refuse({ code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: [] }, 409);
    panel.form.controls.slaWorkingHours.setValue(16);
    fixture.detectChanges();
    expect(text('[data-sla-refusal]')).toBeNull();
  });

  it('says how many tasks a stage made final still creates', async () => {
    const panel = await setup();
    panel.form.controls.isFinal.setValue(true);
    refuse({ code: 'STAGE_TASK_ON_FINAL_STAGE', taskDefinitionCount: 2 }, 400);
    expect(text('[data-final-refusal]')).toBe('This stage creates 2 tasks on entry. Remove them before making it final.');
  });

  it('says it in Arabic, with the Arabic plural', async () => {
    await setup({ language: 'ar' });
    refuse({ code: 'STAGE_DEADLINE_BEFORE_TASKS', stageHours: 12, longestTaskHours: 16, definitionIds: [] }, 409);
    expect(text('[data-sla-refusal]')).toBe(
      'مهمة في هذه المرحلة مستحقة خلال 16 ساعة عمل. اجعل المهلة 16 على الأقل، أو امنح تلك المهام أولوية أعلى.',
    );
  });

  // ── Keyboard ───────────────────────────────────────────────────────────────

  it('opening a stage moves focus to the panel’s heading', async () => {
    await setup();
    await fixture.whenStable();
    expect(document.activeElement).toBe(el().querySelector('[data-panel-heading]'));
  });

  it('Escape cancels with nothing changed, asks first with changes, and leaves an open overlay alone', async () => {
    const panel = await setup();
    const closed = jasmine.createSpy('closed');
    panel.closed.subscribe(closed);
    const escape = (): void => {
      el().querySelector('[data-stage-panel]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    };

    // An overlay above the panel (a select, a menu, a confirm) owns Escape.
    const layers = TestBed.inject(LayerStackService);
    const id = layers.push();
    escape();
    expect(closed).not.toHaveBeenCalled();
    layers.remove(id);

    escape();
    expect(closed).toHaveBeenCalledTimes(1);

    tick('edit_details');
    escape();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(closed).toHaveBeenCalledTimes(1);
    (confirm.calls.mostRecent().args[0] as { accept: () => void }).accept();
    expect(closed).toHaveBeenCalledTimes(2);
  });
});
