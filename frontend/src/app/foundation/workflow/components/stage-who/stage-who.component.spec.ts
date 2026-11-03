import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import type {
  StageAssigneeKind,
  StageWhoEntryDto,
  StageWhoMode,
  WorkflowStageDto,
  WorkflowTemplateDto,
} from '../../services/workflow-template.service';
import { StageEditorPanelComponent } from '../stage-editor-panel/stage-editor-panel.component';
import { ALL_KINDS, WHO_OPTIONS, WHO_RULES, fakeStageWhoOptions, storedEntry } from './stage-who-options.testing';
import { RECORD_CHOICE, ALL_MEMBERS } from './stage-who.model';

// ACC-271 PR 5a — "Who works this stage" (drawing section 8), through the stage
// editor panel that hosts it: every kind, in every mode it allows, saves
// exactly the `who` the server takes and reads back what the server stored —
// its entries, its "Starting assignment" chip and its sentence — and every
// refusal lands in its slot, with Save never disabled. The kinds, fields, modes
// and record forms are the template read's (assigneeKinds, whoRules,
// recordRoutes), given here as the server serves them.

const API = environment.apiUrl;
const QUALITY = { id: 'unit-q', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' };
const SAFETY_COMMITTEE = { id: 'c-ps', nameEn: 'Patient Safety Committee', nameAr: 'لجنة سلامة المرضى' };
const CHAIR = { id: 'role-chair', labelEn: 'Chairman', labelAr: 'رئيس' };

const BASE_STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Under review',
  nameAr: 'قيد المراجعة',
  description: null,
  order: 20,
  slaWorkingHours: null,
  isInitial: false,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'SPECIFIC_USER',
  assigneeUserId: null,
  assigneeRoleId: null,
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
  actions: [],
  flags: [],
};

const stageWith = (mode: StageWhoMode, entries: StageWhoEntryDto[], sentence = { en: 'Saved sentence.', ar: 'جملة محفوظة.' }): WorkflowStageDto => ({
  ...BASE_STAGE,
  who: { mode, entries },
  whoSentence: sentence,
});

const LAYLA = storedEntry({ kind: 'SPECIFIC_USER', userId: 'u-layla', user: { id: 'u-layla', name: 'Layla Al-Harbi' }, isStartingAssignment: true });

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Policy review',
  nameAr: 'مراجعة السياسات',
  objectType: 'MEETING',
  isDefault: true,
  isActive: true,
  isProtected: false,
  createdAt: '',
  updatedAt: '',
  stages: [BASE_STAGE],
  recordActions: [],
  stageFlags: [],
  recordRoutes: { unit: true, committee: true },
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
};

describe('am-stage-who — who works a stage (ACC-271 PR 5a)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<StageEditorPanelComponent>;
  let http: HttpTestingController;

  async function setup(opts: { stage?: WorkflowStageDto | null; template?: WorkflowTemplateDto; lang?: 'en' | 'ar' } = {}): Promise<StageEditorPanelComponent> {
    const lang = opts.lang ?? 'en';
    TestBed.configureTestingModule({
      imports: [StageEditorPanelComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask: jasmine.createSpy('ask') } },
        fakeStageWhoOptions(WHO_OPTIONS),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(StageEditorPanelComponent);
    fixture.componentRef.setInput('template', opts.template ?? TEMPLATE);
    fixture.componentRef.setInput('stage', opts.stage === undefined ? stageWith('ANY_ONE', [LAYLA]) : opts.stage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .am-list-dialog').forEach((n) => n.remove());
  });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const who = (): HTMLElement => el().querySelector('[data-section="who"]')!;
  const text = (node: Element | null | undefined): string => node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const panel = (): StageEditorPanelComponent => fixture.componentInstance;
  const rows = () => panel().whoDraft.rows();
  const rowEl = (i: number): HTMLElement => who().querySelector<HTMLElement>(`[data-who-row="${i}"]`)!;

  /** Sets a row's kind and values as a person picks them; selects are set through their control. */
  function setRow(i: number, kind: StageAssigneeKind, values: Record<string, string | null> = {}): void {
    const g = rows()[i]!.group;
    g.controls.kind.setValue(kind);
    for (const [field, value] of Object.entries(values)) (g.controls as Record<string, { setValue(v: unknown): void }>)[field]!.setValue(value);
    fixture.detectChanges();
  }

  function addRow(): void {
    who().querySelector<HTMLButtonElement>('[data-who-add]')!.click();
    fixture.detectChanges();
  }

  function chooseMode(mode: StageWhoMode): void {
    who().querySelector<HTMLInputElement>(`[data-who-mode="${mode}"]`)!.click();
    fixture.detectChanges();
  }

  /** Presses the real Save, which is never disabled, and returns the stage request. */
  function save(): TestRequest {
    const button = el().querySelector<HTMLButtonElement>('[data-panel-save] button')!;
    expect(button.disabled).withContext('Save is never disabled').toBeFalse();
    button.click();
    fixture.detectChanges();
    return http.expectOne((r) => r.url.startsWith(`${API}/workflow-templates/`) && !r.url.includes('who-options'));
  }

  function refuse(body: Record<string, unknown>, status = 400): void {
    save().flush({ statusCode: status, message: 'English for a log', ...body }, { status, statusText: 'Refused' });
    fixture.detectChanges();
  }

  /** Opens a row's person or committee picker, answers its first page, and picks a row. */
  async function pickFromDialog(i: number, which: 'person' | 'committee', page: object[]): Promise<TestRequest> {
    rowEl(i).querySelector<HTMLButtonElement>(`[data-who-${which}-button]`)!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url.includes(which === 'person' ? '/who-options/people' : '/who-options/committees'));
    req.flush({ items: page, total: page.length, matching: page.length });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-testid="simple-list-pick"]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return req;
  }

  // ── The kinds offered ──────────────────────────────────────────────────────

  it('offers exactly the template’s assigneeKinds, in the reader’s words', async () => {
    const p = await setup({ template: { ...TEMPLATE, assigneeKinds: ['SPECIFIC_USER', 'CREATOR'] } });
    const entry = fixture.debugElement.query((d) => d.name === 'am-stage-who-entry').componentInstance;
    expect(entry.kindOptions().map((o: { label: string }) => o.label)).toEqual(['Specific user', 'Creator']);
    expect(p).toBeTruthy();
  });

  it('a new stage starts with one Fixed position entry (ACC-136)', async () => {
    const p = await setup({ stage: null });
    expect(rows().length).toBe(1);
    expect(rows()[0]!.group.controls.kind.value).toBe('POSITION_IN_UNIT');
    expect(rowEl(0).querySelector('[data-slot="positionId"]')).not.toBeNull();
    expect(rowEl(0).querySelector('[data-slot="orgUnitId"]')).not.toBeNull();
    expect(p.whoDraft.mode()).toBe('ANY_ONE');
  });

  // ── Every kind saves exactly what the server takes ─────────────────────────

  it('Specific user: the picker offers ACTIVE and INVITED people, paged on the server, and saves the person', async () => {
    await setup();
    const req = await pickFromDialog(0, 'person', [
      { id: 'u-omar', name: 'Omar Haddad', status: 'ACTIVE' },
      { id: 'u-huda', name: 'Huda Saleh', status: 'INVITED' },
    ]);
    expect(req.request.params.get('sort')).toBe('name');
    expect(req.request.params.get('dir')).toBe('asc');
    expect(req.request.params.get('take')).toBe('50');
    expect(req.request.params.get('skip')).toBe('0');
    expect((rowEl(0).querySelector('[data-who-person]') as HTMLInputElement).value).toBe('Omar Haddad');
    const r = save();
    expect(r.request.body.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'SPECIFIC_USER', userId: 'u-omar' }] });
    r.flush(stageWith('ANY_ONE', [storedEntry({ kind: 'SPECIFIC_USER', userId: 'u-omar', user: { id: 'u-omar', name: 'Omar Haddad' } })]));
  });

  it('the person picker shows an invited person as such', async () => {
    await setup();
    rowEl(0).querySelector<HTMLButtonElement>('[data-who-person-button]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    http.expectOne((r) => r.url.includes('/who-options/people')).flush({ items: [{ id: 'u-huda', name: 'Huda Saleh', status: 'INVITED' }], total: 1, matching: 1 });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(text(document.querySelector('[data-testid="simple-list-pick"]'))).toContain('Invitation pending');
  });

  it('Fixed position: position and unit, a no-holder warning for that row that never blocks Save', async () => {
    await setup();
    setRow(0, 'POSITION_IN_UNIT', { positionId: 'pos-tl', orgUnitId: 'unit-ps' });
    expect(text(rowEl(0).querySelector('[data-no-holder]'))).toBe('Nobody holds this position in this unit yet.');
    addRow();
    setRow(1, 'POSITION_IN_UNIT', { positionId: 'pos-tl', orgUnitId: 'unit-q' });
    expect(rowEl(1).querySelector('[data-no-holder]')).toBeNull();
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).toContain('Held by 3 people');
    chooseMode('ALL');
    const r = save();
    expect(r.request.body.who).toEqual({
      mode: 'ALL',
      entries: [
        { kind: 'POSITION_IN_UNIT', positionId: 'pos-tl', orgUnitId: 'unit-ps' },
        { kind: 'POSITION_IN_UNIT', positionId: 'pos-tl', orgUnitId: 'unit-q' },
      ],
    });
    r.flush(BASE_STAGE);
  });

  it('a saved Fixed position row warns from the template read’s holderCount, with no call', async () => {
    await setup({
      stage: stageWith('ANY_ONE', [
        storedEntry({ kind: 'POSITION_IN_UNIT', positionId: 'pos-qm', position: { id: 'pos-qm', nameEn: 'Quality Manager', nameAr: null }, orgUnitId: 'unit-q', orgUnit: QUALITY, holderCount: 0 }),
      ]),
    });
    expect(text(rowEl(0).querySelector('[data-no-holder]'))).toBe('Nobody holds this position in this unit yet.');
  });

  it('Org unit head: a named unit, or the record’s unit, each in either mode', async () => {
    await setup();
    setRow(0, 'ORG_UNIT_HEAD', { orgUnitId: 'unit-q' });
    addRow();
    setRow(1, 'ORG_UNIT_HEAD');
    // The record's unit is the row's starting choice, where the record type has one.
    expect(rows()[1]!.group.controls.orgUnitId.value).toBe(RECORD_CHOICE);
    for (const mode of ['ANY_ONE', 'ALL'] as const) {
      chooseMode(mode);
      const r = save();
      expect(r.request.body.who).toEqual({
        mode,
        entries: [
          { kind: 'ORG_UNIT_HEAD', orgUnitId: 'unit-q' },
          { kind: 'ORG_UNIT_HEAD', orgUnitId: null },
        ],
      });
      r.flush(BASE_STAGE);
    }
  });

  it('"The record’s unit" is offered only where the record type has a unit', async () => {
    await setup({ template: { ...TEMPLATE, recordRoutes: { unit: false, committee: true } } });
    setRow(0, 'ORG_UNIT_HEAD');
    const entry = fixture.debugElement.query((d) => d.name === 'am-stage-who-entry').componentInstance;
    expect(entry.unitOptions().map((o: { value: string }) => o.value)).not.toContain(RECORD_CHOICE);
    expect(rows()[0]!.group.controls.orgUnitId.value).toBeNull();
  });

  it('Creator: no fields, alone or beside another entry', async () => {
    await setup();
    setRow(0, 'CREATOR');
    expect(rowEl(0).querySelectorAll('[data-slot]:not([data-slot="kind"])').length).toBe(0);
    let r = save();
    expect(r.request.body.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] });
    r.flush(BASE_STAGE);
    addRow();
    setRow(1, 'ORG_UNIT_HEAD', { orgUnitId: 'unit-q' });
    chooseMode('ALL');
    r = save();
    expect(r.request.body.who).toEqual({ mode: 'ALL', entries: [{ kind: 'CREATOR' }, { kind: 'ORG_UNIT_HEAD', orgUnitId: 'unit-q' }] });
    r.flush(BASE_STAGE);
  });

  it('Committee: a named committee from the server-paged picker, all members, by vote', async () => {
    await setup();
    setRow(0, 'COMMITTEE');
    const req = await pickFromDialog(0, 'committee', [SAFETY_COMMITTEE]);
    expect(req.request.params.get('lang')).toBe('en');
    expect((rowEl(0).querySelector('[data-who-committee]') as HTMLInputElement).value).toBe('Patient Safety Committee');
    expect(rows()[0]!.group.controls.committeeRoleValueId.value).toBe(ALL_MEMBERS);
    // One Committee entry: the choice shows, Committee vote with it.
    expect(Array.from(who().querySelectorAll('[data-who-mode]')).map((n) => n.getAttribute('data-who-mode'))).toEqual(['ANY_ONE', 'ALL', 'COMMITTEE_VOTE']);
    chooseMode('COMMITTEE_VOTE');
    expect(text(who().querySelector('[data-who-mode-help]'))).toBe("The committee’s members vote; the committee’s own quorum and voting rules decide.");
    const r = save();
    expect(r.request.body.who).toEqual({ mode: 'COMMITTEE_VOTE', entries: [{ kind: 'COMMITTEE', committeeId: 'c-ps', committeeRoleValueId: null }] });
    r.flush(BASE_STAGE);
  });

  it('Committee: a named committee with a role filter, in each mode', async () => {
    await setup();
    setRow(0, 'COMMITTEE');
    await pickFromDialog(0, 'committee', [SAFETY_COMMITTEE]);
    setRow(0, 'COMMITTEE', { committeeId: 'c-ps', committeeRoleValueId: 'role-chair' });
    rows()[0]!.committee.set({ nameEn: SAFETY_COMMITTEE.nameEn, nameAr: SAFETY_COMMITTEE.nameAr });
    for (const mode of ['ANY_ONE', 'ALL', 'COMMITTEE_VOTE'] as const) {
      chooseMode(mode);
      const r = save();
      expect(r.request.body.who).toEqual({ mode, entries: [{ kind: 'COMMITTEE', committeeId: 'c-ps', committeeRoleValueId: 'role-chair' }] });
      r.flush(BASE_STAGE);
    }
  });

  it('Committee: the record’s committee, with and without a role filter', async () => {
    await setup();
    setRow(0, 'COMMITTEE');
    expect(rows()[0]!.group.controls.committeeId.value).toBe(RECORD_CHOICE);
    expect((rowEl(0).querySelector('[data-who-committee]') as HTMLInputElement).value).toBe('The record’s committee');
    let r = save();
    expect(r.request.body.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'COMMITTEE', committeeId: null, committeeRoleValueId: null }] });
    r.flush(BASE_STAGE);
    setRow(0, 'COMMITTEE', { committeeId: RECORD_CHOICE, committeeRoleValueId: 'role-chair' });
    chooseMode('COMMITTEE_VOTE');
    r = save();
    expect(r.request.body.who).toEqual({ mode: 'COMMITTEE_VOTE', entries: [{ kind: 'COMMITTEE', committeeId: null, committeeRoleValueId: 'role-chair' }] });
    r.flush(BASE_STAGE);
  });

  it('after a named committee, "Use the record’s committee instead" goes back to it', async () => {
    await setup();
    setRow(0, 'COMMITTEE');
    await pickFromDialog(0, 'committee', [SAFETY_COMMITTEE]);
    rowEl(0).querySelector<HTMLButtonElement>('[data-who-record-committee]')!.click();
    fixture.detectChanges();
    expect(rows()[0]!.group.controls.committeeId.value).toBe(RECORD_CHOICE);
    expect(rowEl(0).querySelector('[data-who-record-committee]')).toBeNull();
  });

  it('"The record’s committee" is offered only where the record type has a committee', async () => {
    await setup({ template: { ...TEMPLATE, recordRoutes: { unit: true, committee: false } } });
    setRow(0, 'COMMITTEE');
    expect(rows()[0]!.group.controls.committeeId.value).toBeNull();
    expect(rowEl(0).querySelector('[data-who-record-committee]')).toBeNull();
  });

  // ── The modes, driven only by whoRules ─────────────────────────────────────

  it('one entry that is not a committee shows no mode choice and sends the default mode', async () => {
    await setup();
    expect(who().querySelector('[data-who-modes]')).toBeNull();
    setRow(0, 'CREATOR');
    expect(who().querySelector('[data-who-modes]')).toBeNull();
  });

  it('two entries show Any one / All, never Committee vote', async () => {
    await setup();
    addRow();
    setRow(1, 'CREATOR');
    expect(Array.from(who().querySelectorAll('[data-who-mode]')).map((n) => n.getAttribute('data-who-mode'))).toEqual(['ANY_ONE', 'ALL']);
    expect(text(who().querySelector('[data-who-mode-help]'))).toBe('The first to act decides; the others’ tasks close.');
  });

  it('Committee vote falls back to the default mode, and says so, once the list is no longer one committee', async () => {
    await setup();
    setRow(0, 'COMMITTEE');
    chooseMode('COMMITTEE_VOTE');
    addRow();
    setRow(1, 'CREATOR');
    expect(text(who().querySelector('[data-who-fallback]'))).toBe('“Committee vote” can’t be used with this list, so the stage will use “Any one of them”.');
    const r = save();
    expect(r.request.body.who.mode).toBe('ANY_ONE');
    r.flush(BASE_STAGE);
  });

  it('a rule served differently is followed: the choice shows from three entries when the server says so', async () => {
    await setup({ template: { ...TEMPLATE, whoRules: { ...WHO_RULES, modeChoiceShownWhen: { minEntries: 3, orSingleKind: 'COMMITTEE' } } } });
    addRow();
    setRow(1, 'CREATOR');
    expect(who().querySelector('[data-who-modes]')).toBeNull();
    addRow();
    setRow(2, 'ORG_UNIT_HEAD');
    expect(who().querySelector('[data-who-modes]')).not.toBeNull();
  });

  // ── Reading back what the server stored ────────────────────────────────────

  it('reads back the stored entries, the starting chip and its note, and the server’s sentence, politely', async () => {
    await setup({ stage: stageWith('ANY_ONE', [LAYLA], { en: 'Layla Al-Harbi.', ar: 'ليلى الحربي.' }) });
    expect((rowEl(0).querySelector('[data-who-person]') as HTMLInputElement).value).toBe('Layla Al-Harbi');
    expect(text(rowEl(0).querySelector('[data-starting-chip]'))).toBe('Starting assignment');
    expect(text(who().querySelector('[data-starting-note]'))).toBe(
      'Seeded workflows start here so every stage has someone. Replace it with the people who should do this work.',
    );
    const readback = who().querySelector('[data-who-readback]')!;
    expect(readback.getAttribute('aria-live')).toBe('polite');
    expect(text(readback)).toBe('Layla Al-Harbi.');
  });

  it('changing the list clears the chip and says the sentence follows a save', async () => {
    await setup();
    setRow(0, 'CREATOR');
    expect(rowEl(0).querySelector('[data-starting-chip]')).toBeNull();
    expect(text(who().querySelector('[data-who-readback]'))).toBe('How this reads is shown once the stage is saved.');
    expect(text(el().querySelector('[data-changed-note]'))).toContain('Who works this stage');
  });

  it('reads back in Arabic: kinds, the chip and the server’s Arabic sentence', async () => {
    await setup({
      lang: 'ar',
      stage: stageWith('COMMITTEE_VOTE', [storedEntry({ kind: 'COMMITTEE', committeeId: 'c-ps', committee: SAFETY_COMMITTEE, committeeRoleValueId: 'role-chair', committeeRole: CHAIR, isStartingAssignment: true })], {
        en: 'The Patient Safety Committee decides by vote.',
        ar: 'تقرر لجنة سلامة المرضى بالتصويت.',
      }),
    });
    expect(text(rowEl(0).querySelector('[data-who-kind]'))).toContain('لجنة');
    expect((rowEl(0).querySelector('[data-who-committee]') as HTMLInputElement).value).toBe('لجنة سلامة المرضى');
    expect(text(rowEl(0).querySelector('[data-starting-chip]'))).toBe('إسناد أولي');
    expect(text(who().querySelector('[data-who-readback]'))).toBe('تقرر لجنة سلامة المرضى بالتصويت.');
    expect(text(who().querySelector('.am-who__seg-option--on'))).toBe('تصويت اللجنة');
  });

  it('an unchanged stage sends no who; a reload of the same stage keeps unsaved who work (ACC-55)', async () => {
    await setup();
    let r = save();
    expect('who' in r.request.body).toBeFalse();
    r.flush(stageWith('ANY_ONE', [LAYLA]));
    fixture.detectChanges();
    setRow(0, 'CREATOR');
    fixture.componentRef.setInput('stage', stageWith('ANY_ONE', [LAYLA]));
    fixture.detectChanges();
    expect(rows()[0]!.group.controls.kind.value).toBe('CREATOR');
    r = save();
    expect(r.request.body.who).toEqual({ mode: 'ANY_ONE', entries: [{ kind: 'CREATOR' }] });
    r.flush(BASE_STAGE);
  });

  // ── Errors in their slots; Save never disabled ─────────────────────────────

  it('a missing value is said in its own slot on Save, and nothing is sent', async () => {
    await setup({ stage: null });
    panel().form.controls.nameEn.setValue('Board review');
    el().querySelector<HTMLButtonElement>('[data-panel-save] button')!.click();
    fixture.detectChanges();
    http.expectNone((r) => r.url.includes('/stages'));
    expect(text(rowEl(0).querySelector('[data-slot="positionId"]'))).toContain('Choose a position.');
    expect(text(rowEl(0).querySelector('[data-slot="orgUnitId"]'))).toContain('Choose a unit.');
    addRow();
    el().querySelector<HTMLButtonElement>('[data-panel-save] button')!.click();
    fixture.detectChanges();
    expect(text(rowEl(1).querySelector('[data-slot="kind"]'))).toContain('Choose a kind.');
  });

  it('the server’s refusals land in their slots by index and field, in the reader’s words', async () => {
    await setup();
    addRow();
    setRow(1, 'ORG_UNIT_HEAD', { orgUnitId: 'unit-q' });

    refuse({ code: 'WHO_ENTRY_DUPLICATE', index: 1 });
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).toContain('This entry is already in the list.');
    expect(el().textContent).not.toContain('English for a log');
    expect(el().querySelector('[data-panel-refusal]')).toBeNull();

    refuse({ code: 'WHO_USER_NOT_ACTIVE', index: 0 });
    expect(text(rowEl(0).querySelector('[data-slot="userId"]'))).toContain('This person’s account isn’t active. Choose someone else.');
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).not.toContain('already in the list');

    refuse({ code: 'WHO_REFERENCE_NOT_FOUND', index: 1, field: 'orgUnitId' }, 404);
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).toContain('This was removed. Choose again.');

    refuse({ code: 'WHO_RECORD_ROUTE_NOT_AVAILABLE', index: 1, kind: 'ORG_UNIT_HEAD' });
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).toContain('This record type has no unit of its own. Choose a unit.');

    refuse({ code: 'WHO_KIND_NOT_ALLOWED', index: 0, kind: 'SPECIFIC_USER' });
    expect(text(rowEl(0).querySelector('[data-slot="kind"]'))).toContain('This kind of assignee can’t work a stage of this record type.');

    refuse({ code: 'COMMITTEE_VOTE_NEEDS_ONE_COMMITTEE' });
    expect(text(who().querySelector('[data-who-mode-error]'))).toBe('A committee vote needs exactly one assignee, and it must be a committee.');
  });

  it('an empty list is said under the section', async () => {
    await setup();
    who().querySelector<HTMLButtonElement>('[data-who-remove]')!.click();
    fixture.detectChanges();
    refuse({ code: 'WHO_ENTRIES_REQUIRED' });
    expect(text(who().querySelector('[data-who-section-error]'))).toBe('A stage needs at least one assignee.');
  });

  it('a slot’s refusal clears once that row changes', async () => {
    await setup();
    refuse({ code: 'WHO_USER_NOT_ACTIVE', index: 0 });
    setRow(0, 'CREATOR');
    expect(text(rowEl(0))).not.toContain('isn’t active');
  });

  it('says a refusal in Arabic', async () => {
    await setup({ lang: 'ar' });
    addRow();
    setRow(1, 'ORG_UNIT_HEAD', { orgUnitId: 'unit-q' });
    refuse({ code: 'WHO_ENTRY_DUPLICATE', index: 1 });
    expect(text(rowEl(1).querySelector('[data-slot="orgUnitId"]'))).toContain('هذا الإسناد موجود في القائمة بالفعل.');
  });

  // ── A protected workflow ───────────────────────────────────────────────────

  it('a protected workflow shows the section read-only, and never sends who', async () => {
    await setup({
      template: { ...TEMPLATE, isProtected: true, editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'] },
    });
    expect(who().querySelector('[data-who-kind]')).toBeNull();
    expect(who().querySelector('[data-who-add]')).toBeNull();
    expect(who().querySelector('[data-who-remove]')).toBeNull();
    expect(text(rowEl(0))).toContain('Specific user');
    expect(text(rowEl(0))).toContain('Layla Al-Harbi');
    expect(text(who().querySelector('[data-who-readback]'))).toBe('Saved sentence.');
    const r = save();
    expect('who' in r.request.body).toBeFalse();
    r.flush(BASE_STAGE);
  });

  // ── Keyboard and focus ─────────────────────────────────────────────────────

  it('Add another puts focus on the new entry’s Kind', async () => {
    await setup();
    addRow();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(rowEl(1).querySelector('[data-who-kind] .am-overlay-select-trigger'));
  });

  it('after Remove, focus moves to the next Remove, or to Add another when it was the last', async () => {
    await setup();
    addRow();
    setRow(1, 'CREATOR');
    addRow();
    setRow(2, 'ORG_UNIT_HEAD');
    rowEl(0).querySelector<HTMLButtonElement>('[data-who-remove]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(rows().length).toBe(2);
    expect(document.activeElement).toBe(rowEl(0).querySelector('[data-who-remove]'));
    rowEl(1).querySelector<HTMLButtonElement>('[data-who-remove]')!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(document.activeElement).toBe(who().querySelector('[data-who-add]'));
  });

  /** Opens row i's Kind list with the mouse, clicks option n, and says whether the list is still open. */
  async function pickKindWithMouse(i: number, n: number): Promise<boolean> {
    rowEl(i).querySelector<HTMLElement>('[data-who-kind] .am-overlay-select-trigger')!.click();
    fixture.detectChanges();
    const options = document.querySelectorAll<HTMLElement>('.am-overlay-select-panel [role="option"]');
    expect(options.length).withContext('the Kind list opened').toBe(ALL_KINDS.length);
    options[n]!.click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return document.querySelector('.am-overlay-select-panel') !== null;
  }

  // 5a's live check: "Fixed position" picked with the mouse left the list open
  // while the other kinds closed it. The row was already Fixed position, and a
  // re-pick sends no value change from CdkListbox, so nothing closed the list.
  it('picking each kind with the mouse closes the Kind list, including the kind the row already has', async () => {
    await setup();
    for (const [n, kind] of ALL_KINDS.entries()) {
      expect(await pickKindWithMouse(0, n)).withContext(`${kind} picked`).toBeFalse();
      expect(rows()[0]!.group.controls.kind.value).toBe(kind);
      expect(await pickKindWithMouse(0, n)).withContext(`${kind} picked again`).toBeFalse();
      expect(rows()[0]!.group.controls.kind.value).toBe(kind);
    }
  });

  it('each Remove is named for its entry', async () => {
    await setup();
    addRow();
    const names = Array.from(who().querySelectorAll('[data-who-remove]')).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Remove assignee 1', 'Remove assignee 2']);
  });
});
