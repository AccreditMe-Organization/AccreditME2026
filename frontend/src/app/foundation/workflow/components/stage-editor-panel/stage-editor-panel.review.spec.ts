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
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { WorkflowStageDto, WorkflowTemplateDto } from '../../services/workflow-template.service';
import { StageEditorPanelComponent } from './stage-editor-panel.component';
import { ALL_KINDS, WHO_OPTIONS, WHO_RULES, fakeStageWhoOptions, storedEntry } from '../stage-who/stage-who-options.testing';

// ACC-245 PR 3b — the review-stage panel (Workflow Setup §13): adding a review
// stage to the protected committee change request workflow, and editing or
// removing one. Every rule comes from the template read: `reviewStages` (where
// one may go, how many, and who may decide one), each stage's `reviewStage` and
// `editableFields`, and its own forward move.

const API = environment.apiUrl;

const stage = (over: Partial<WorkflowStageDto>): WorkflowStageDto => ({
  id: 'x',
  workflowTemplateId: 'template-cr',
  nameEn: 'x',
  nameAr: null,
  description: null,
  order: 1,
  slaWorkingHours: null,
  isInitial: false,
  isFinal: false,
  escalationConfig: null,
  actions: [],
  flags: [],
  who: null,
  whoSentence: null,
  transitions: [],
  ...over,
});

const DRAFT = stage({ id: 'st-draft', nameEn: 'Draft', nameAr: 'مسودة', order: 10, isInitial: true });
const LEGAL = stage({
  id: 'st-legal',
  nameEn: 'Legal review',
  nameAr: 'المراجعة القانونية',
  description: 'Legal Affairs checks the change against the committee bylaws.',
  order: 11,
  slaWorkingHours: 24,
  reviewStage: true,
  editableFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig', 'who'],
  who: { mode: 'ANY_ONE', entries: [storedEntry({ kind: 'POSITION_IN_UNIT', positionId: 'pos-qm', orgUnitId: 'unit-q', position: { id: 'pos-qm', nameEn: 'Quality Manager', nameAr: 'مدير الجودة' }, orgUnit: { id: 'unit-q', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' } })] },
  whoSentence: { en: 'Whoever holds Quality Manager in Quality Department.', ar: 'من يشغل منصب مدير الجودة في إدارة الجودة.' },
  // Its own forward move, re-pointed by the server to whatever follows it.
  transitions: [
    { id: 't-approve', fromStageId: 'st-legal', toStageId: 'st-review', labelEn: 'Approve', labelAr: 'اعتماد', validatorConfig: null, kind: 'ADVANCE', mover: 'APP' },
    { id: 't-return', fromStageId: 'st-legal', toStageId: 'st-returned', labelEn: 'Return', labelAr: null, validatorConfig: null, kind: 'RETURN', mover: 'APP' },
  ],
});
const UNDER_REVIEW = stage({ id: 'st-review', nameEn: 'Under review', nameAr: 'قيد المراجعة', order: 20 });

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-cr',
  organizationId: 'org',
  nameEn: 'Committee change request',
  nameAr: null,
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isDefault: true,
  isActive: true,
  isProtected: true,
  editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'],
  createdAt: '',
  updatedAt: '',
  stages: [DRAFT, LEGAL, UNDER_REVIEW],
  recordActions: [],
  stageFlags: [{ key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' }],
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
  recordRoutes: { unit: true, committee: true },
  reviewStages: {
    canAdd: true,
    max: 9,
    count: 1,
    after: [
      { id: 'st-draft', nameEn: 'Draft', nameAr: 'مسودة' },
      { id: 'st-legal', nameEn: 'Legal review', nameAr: 'المراجعة القانونية' },
    ],
    // The server's REVIEW_STAGE_WHO_MODES and the kinds less REVIEW_STAGE_REFUSED_KINDS.
    who: { modes: ['ANY_ONE'], assigneeKinds: ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'COMMITTEE'] },
  },
};

describe('StageEditorPanelComponent — review stages (ACC-245 PR 3b)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<StageEditorPanelComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];

  async function setup(opts: { language?: 'en' | 'ar'; stage?: WorkflowStageDto | null; template?: WorkflowTemplateDto } = {}): Promise<StageEditorPanelComponent> {
    const language = opts.language ?? 'en';
    asked = [];
    TestBed.configureTestingModule({
      imports: [StageEditorPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        fakeStageWhoOptions(WHO_OPTIONS),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StageEditorPanelComponent);
    fixture.componentRef.setInput('template', opts.template ?? TEMPLATE);
    const editing = opts.stage === undefined ? null : opts.stage;
    fixture.componentRef.setInput('addingReview', editing === null);
    fixture.componentRef.setInput('stage', editing);
    fixture.detectChanges();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (selector: string): string | null => el().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const labels = (): string[] =>
    Array.from(el().querySelectorAll<HTMLElement>('[data-card="identity"] .am-field__label')).map((n) => n.textContent!.replace(/\s+/g, ' ').trim());
  const submit = (): TestRequest => {
    fixture.componentInstance.onSubmit();
    return http.expectOne((r) => r.url.startsWith(`${API}/workflow-templates/`));
  };

  // ── Adding ────────────────────────────────────────────────────────────────

  it('adding: titled "Add review stage", the drawn fields with their markers, and no start, end, actions or meanings', async () => {
    await setup();
    expect(text('#sep-heading')).toBe('Add review stage');
    expect(labels()).toEqual(['Name (English)*', 'Name (Arabic) · optional', 'Description · optional', 'SLA (working hours) · optional', 'Goes after*']);
    expect(el().querySelector('#sep-isInitial')).toBeNull();
    expect(el().querySelector('#sep-isFinal')).toBeNull();
    expect(el().querySelector('[data-section="actions"]')).toBeNull();
    expect(el().querySelector('[data-section="meanings"]')).toBeNull();
    expect(el().querySelector('[data-adding-note]')).toBeNull();
    // The organisation's own stage: no protected sentence over it.
    expect(el().querySelector('[data-protected-banner]')).toBeNull();
    expect(text('[data-panel-save]')).toBe('Add');
    expect(el().querySelector('[data-panel-remove]')).toBeNull();
  });

  it('Goes after lists Draft then each review stage (the server\'s after), and starts on the last', async () => {
    const panel = await setup();
    expect(panel.afterOptions().map((o) => o.label)).toEqual(['Draft', 'Legal review']);
    expect(panel.form.controls.goesAfter.value).toBe('st-legal');
    expect(text('[data-goes-after] .am-field__message')).toBe('Review stages run in order, before the stage that decides the request.');
  });

  it('the people: only the server\'s kinds (never "Who started the record"), and two lines where the choice of how they decide was', async () => {
    const panel = await setup();
    expect(panel.whoTemplate()?.assigneeKinds).toEqual(['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'COMMITTEE']);
    expect(panel.whoTemplate()?.whoRules?.modes.map((m) => m.key)).toEqual(['ANY_ONE']);
    // Even with two people, no choice: the lines stand in its place.
    panel.whoDraft.addRow();
    fixture.detectChanges();
    expect(el().querySelector('[data-who-modes]')).toBeNull();
    expect(Array.from(el().querySelectorAll('[data-who-decides] p')).map((p) => p.textContent!.trim())).toEqual([
      'Any one of them decides. Nobody decides on their own request.',
      'Only people who can open the committee can decide.',
    ]);
  });

  it('Add sends where it goes and what it takes, and nothing else (no start, end, actions or meanings)', async () => {
    const panel = await setup();
    panel.form.controls.nameEn.setValue('Finance review');
    panel.form.controls.goesAfter.setValue('st-draft');
    const row = panel.whoDraft.rows()[0]!;
    row.group.controls.positionId.setValue('pos-qm');
    row.group.controls.orgUnitId.setValue('unit-q');
    const req = submit();
    expect(req.request.method).toBe('POST');
    expect(req.request.url).toBe(`${API}/workflow-templates/template-cr/stages`);
    expect(req.request.body.reviewAfterStageId).toBe('st-draft');
    expect(req.request.body.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'POSITION_IN_UNIT', positionId: 'pos-qm', orgUnitId: 'unit-q' }] });
    for (const field of ['isInitial', 'isFinal', 'actions', 'flags']) expect(field in req.request.body).withContext(field).toBeFalse();
    req.flush({ ...LEGAL, id: 'st-new', nameEn: 'Finance review' });
  });

  it('Goes after is required: with none chosen, nothing is sent', async () => {
    const panel = await setup();
    panel.form.controls.nameEn.setValue('Finance review');
    panel.form.controls.goesAfter.setValue(null);
    const row = panel.whoDraft.rows()[0]!;
    row.group.controls.positionId.setValue('pos-qm');
    row.group.controls.orgUnitId.setValue('unit-q');
    panel.onSubmit();
    expect(panel.form.controls.goesAfter.hasError('required')).toBeTrue();
    http.expectNone(() => true);
  });

  it('a refused add is said from its code: the limit with the server\'s maximum, the others from the notes', async () => {
    // A maximum the static refusal text does not say, so the sentence is the server's.
    await setup({ template: { ...TEMPLATE, reviewStages: { ...TEMPLATE.reviewStages!, max: 7 } } });
    const panel = fixture.componentInstance;
    panel.form.controls.nameEn.setValue('Finance review');
    const row = panel.whoDraft.rows()[0]!;
    row.group.controls.positionId.setValue('pos-qm');
    row.group.controls.orgUnitId.setValue('unit-q');
    submit().flush({ statusCode: 409, code: 'REVIEW_STAGE_LIMIT', message: 'x' }, { status: 409, statusText: 'Refused' });
    fixture.detectChanges();
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe('A change request can go through up to 7 review stages.');
    submit().flush({ statusCode: 400, code: 'REVIEW_STAGE_POSITION', message: 'x' }, { status: 400, statusText: 'Refused' });
    fixture.detectChanges();
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe("That position isn't available any more. Reload and choose where it goes again.");
    submit().flush({ statusCode: 400, code: 'REVIEW_STAGE_NO_CREATOR', message: 'x' }, { status: 400, statusText: 'Refused' });
    fixture.detectChanges();
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toBe("Nobody reviews their own request, so this choice isn't offered.");
  });

  it('says it in Arabic', async () => {
    await setup({ language: 'ar' });
    expect(text('#sep-heading')).toBe('إضافة مرحلة مراجعة');
    expect(labels()).toContain('تأتي بعد*');
    expect(text('[data-who-decides] p')).toBe('يقرّر أيٌّ منهم. ولا يقرّر أحد في طلب قدّمه بنفسه.');
  });

  // ── An existing review stage ──────────────────────────────────────────────

  it('editing: its name as the title, Goes after read only with how to move it, the server\'s editableFields, Save and Remove stage', async () => {
    await setup({ stage: LEGAL });
    expect(text('#sep-heading')).toBe('Legal review');
    expect(text('[data-goes-after] .am-field__value')).toBe('Draft');
    expect(text('[data-goes-after] .am-field__message')).toBe(
      "To move it, remove it and add it again. That's possible only while no request has entered it.",
    );
    // The stage's own editableFields: names, description, deadline and people.
    expect((el().querySelector('#sep-nameEn') as HTMLInputElement | null)?.disabled).toBeFalse();
    expect(el().querySelector('#sep-sla')).not.toBeNull();
    expect(el().querySelector('[data-who-add]')).not.toBeNull();
    expect(text('[data-panel-save]')).toBe('Save');
    expect(text('[data-panel-remove]')).toBe('Remove stage');
  });

  it('a save sends only the drawn fields: never start or end, and never where it goes', async () => {
    const panel = await setup({ stage: LEGAL });
    panel.form.controls.nameEn.setValue('Legal and compliance review');
    const req = submit();
    expect(req.request.method).toBe('PATCH');
    expect(req.request.url).toBe(`${API}/workflow-templates/stages/st-legal`);
    for (const field of ['isInitial', 'isFinal', 'reviewAfterStageId', 'actions', 'flags']) expect(field in req.request.body).withContext(field).toBeFalse();
    expect(req.request.body.nameEn).toBe('Legal and compliance review');
    req.flush(LEGAL);
  });

  it('Remove stage asks where requests will go instead: from the stage before it straight to its own forward move\'s target', async () => {
    const panel = await setup({ stage: LEGAL });
    const removed = jasmine.createSpy('removed');
    panel.removed.subscribe(removed);
    (el().querySelector('[data-panel-remove]') as HTMLButtonElement).click();
    expect(asked.length).toBe(1);
    expect(asked[0]!.header).toBe('Remove the stage “Legal review”?');
    expect(asked[0]!.message).toBe('Requests will go from Draft straight to Under review.');
    asked[0]!.accept!();
    const req = http.expectOne(`${API}/workflow-templates/stages/st-legal`);
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    expect(removed).toHaveBeenCalledWith('st-legal');
  });

  it('a stage a request has entered is refused in the panel, keeping what was typed, with the existing words', async () => {
    const panel = await setup({ stage: LEGAL });
    panel.form.controls.nameEn.setValue('Typed but not saved');
    (el().querySelector('[data-panel-remove]') as HTMLButtonElement).click();
    asked[0]!.accept!();
    http
      .expectOne(`${API}/workflow-templates/stages/st-legal`)
      .flush({ statusCode: 409, code: 'STAGE_IN_USE', recordCount: 2, message: 'x' }, { status: 409, statusText: 'Refused' });
    fixture.detectChanges();
    expect(text('[data-panel-refusal] .am-sep__banner-body')).toContain('2 records have entered this stage');
    // The sentence alone: it is not a save that failed.
    expect(el().querySelector('[data-panel-refusal] .am-sep__banner-title')).toBeNull();
    expect(panel.form.controls.nameEn.value).toBe('Typed but not saved');
  });

  it('the remove confirm in Arabic, with the stage names quoted', async () => {
    await setup({ stage: LEGAL, language: 'ar' });
    (el().querySelector('[data-panel-remove]') as HTMLButtonElement).click();
    expect(asked[0]!.message).toBe('ستنتقل الطلبات من «مسودة» مباشرةً إلى «قيد المراجعة».');
  });

  // ── Not a review stage ────────────────────────────────────────────────────

  it('a keyed stage of the same workflow keeps today\'s panel: Initial and Final shown, no Goes after, no Remove stage', async () => {
    await setup({ stage: UNDER_REVIEW });
    expect(el().querySelector('[data-goes-after]')).toBeNull();
    expect(el().querySelector('[data-panel-remove]')).toBeNull();
    expect(el().querySelector('[data-readonly-field="isInitial"]')).not.toBeNull();
    expect(el().querySelector('[data-protected-banner]')).not.toBeNull();
  });
});
