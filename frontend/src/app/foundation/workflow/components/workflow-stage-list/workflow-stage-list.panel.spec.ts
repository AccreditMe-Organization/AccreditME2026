import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { WorkflowStageListComponent } from './workflow-stage-list.component';

// ACC-255 PR 4b — the stages page around the stage editor panel (plan §17.2,
// §17.6; Ahmad's Q1): a strip card, a stage's name in the list, or Add stage
// opens the panel between the strip and the list; switching with unsaved work
// asks first; Cancel returns focus to whatever opened it; a protected workflow
// offers no Add, Move or Remove; and only workflows:manage edits at all.

const API = `${environment.apiUrl}/workflow-templates`;

const stage = (i: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: `stage-${i}`,
  workflowTemplateId: 'template-1',
  nameEn: `Stage ${i}`,
  nameAr: `المرحلة ${i}`,
  description: null,
  order: i * 10,
  slaWorkingHours: 40,
  isInitial: i === 1,
  isFinal: i === 3,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'SELF',
  assigneeUserId: null,
  assigneeRoleId: null,
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
  actions: ['add_member'],
  flags: [],
  liveCount: i,
  transitions: [],
  ...over,
});

const TEMPLATE = {
  id: 'template-1',
  organizationId: 'org-a',
  nameEn: 'Committee lifecycle',
  nameAr: null,
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  isProtected: false,
  recordActions: [
    { key: 'edit_details', labelKey: 'workflow.recordAction.COMMITTEE.edit_details', permissionKey: 'committees:edit_details' },
    { key: 'add_member', labelKey: 'workflow.recordAction.COMMITTEE.add_member', permissionKey: 'committees:add_member' },
  ],
  stageFlags: [{ key: 'DISSOLVING', labelKey: 'workflow.stageFlag.DISSOLVING', cardinality: 'any' }],
  recordFields: [],
  recordRoutes: { unit: false, committee: false },
  stages: [1, 2, 3].map((i) => stage(i)),
};

const PROTECTED = {
  ...TEMPLATE,
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isProtected: true,
  editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'],
  recordActions: [],
};

describe('WorkflowStageListComponent — the stage editor panel (ACC-255 PR 4b)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<WorkflowStageListComponent>;
  let http: HttpTestingController;
  let confirm: jasmine.Spy;

  async function render(opts: { template?: object; manage?: boolean } = {}): Promise<HTMLElement> {
    confirm = jasmine.createSpy('ask');
    TestBed.configureTestingModule({
      imports: [WorkflowStageListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AmConfirmService, useValue: { ask: confirm } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p !== 'workflows:manage' || (opts.manage ?? true) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ templateId: 'template-1' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowStageListComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/template-1`).flush(opts.template ?? TEMPLATE);
    fixture.detectChanges();
    return settle();
  }

  /** Answers the panel's picker reads, and lets ngModel and focus settle. */
  async function settle(): Promise<HTMLElement> {
    fixture.detectChanges();
    http
      .match((r) => !r.url.startsWith(API))
      .forEach((r) => r.flush(r.request.url.endsWith('/roles') ? { data: [], total: 0, page: 1, pageSize: 200 } : []));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const panel = (): HTMLElement | null => el().querySelector('[data-stage-panel]');
  const heading = (): string | null => el().querySelector('[data-panel-heading]')?.textContent?.trim() ?? null;
  const card = (i: number): HTMLButtonElement => el().querySelectorAll<HTMLButtonElement>('[data-strip-card]')[i]!;
  const listName = (i: number): HTMLButtonElement => el().querySelectorAll<HTMLButtonElement>('[data-testid="stage-edit"]')[i]!;

  afterEach(() => http.verify());

  it('a strip card opens its stage in the panel, between the strip and the list, with focus on its heading', async () => {
    await render();
    expect(panel()).toBeNull();
    card(1).click();
    await settle();
    expect(heading()).toBe('Stage 2');
    const strip = el().querySelector('am-workflow-strip')!;
    const list = el().querySelector('app-data-list')!;
    // Between the two, in document order.
    expect(strip.compareDocumentPosition(panel()!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel()!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.activeElement).toBe(el().querySelector('[data-panel-heading]'));
    expect(card(1).getAttribute('aria-current')).toBe('true');
  });

  it('a stage’s name in the list opens it too; the list has no Edit or ⋯ of its own', async () => {
    await render();
    expect(el().querySelector('[data-testid="stage-actions"]')).toBeNull();
    listName(2).click();
    await settle();
    expect(heading()).toBe('Stage 3');
    // The ⋯ (Move up, Move down, Remove) is the panel's.
    expect(panel()!.querySelector('am-row-menu')).not.toBeNull();
  });

  it('Cancel closes the panel and returns focus to whatever opened it', async () => {
    await render();
    listName(0).focus();
    listName(0).click();
    await settle();
    el().querySelector<HTMLButtonElement>('[data-panel-cancel] button')!.click();
    await settle();
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(listName(0));
  });

  it('switching stages with unsaved changes asks first; Discard switches, Cancel stays', async () => {
    await render();
    card(0).click();
    await settle();
    el().querySelector<HTMLInputElement>('[data-check-row="edit_details"] input[type="checkbox"]')!.click();
    fixture.detectChanges();
    card(1).click();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.calls.mostRecent().args[0].header).toBe('Discard changes?');
    expect(heading()).toBe('Stage 1');
    confirm.calls.mostRecent().args[0].accept();
    await settle();
    expect(heading()).toBe('Stage 2');
  });

  it('switching with nothing changed does not ask', async () => {
    await render();
    card(0).click();
    await settle();
    card(2).click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    expect(heading()).toBe('Stage 3');
  });

  it('Add stage opens the panel empty; once added it reopens on the new stage, as the server stored it', async () => {
    await render();
    el().querySelector<HTMLButtonElement>('app-page-header p-button button')!.click();
    await settle();
    expect(heading()).toBe('Add Stage');
    expect(el().querySelector('[data-adding-note]')).not.toBeNull();
    const panelCmp = fixture.componentInstance as unknown as { panel: { form: { controls: { nameEn: { setValue(v: string): void } } }; onSubmit(): void } };
    panelCmp.panel.form.controls.nameEn.setValue('Stage 4');
    panelCmp.panel.onSubmit();
    http.expectOne({ method: 'POST', url: `${API}/template-1/stages` }).flush(stage(4, { actions: ['add_member'] }));
    http.expectOne(`${API}/template-1`).flush({ ...TEMPLATE, stages: [...TEMPLATE.stages, stage(4)] });
    await settle();
    expect(heading()).toBe('Stage 4');
    // The sections, with what the server stored.
    expect(el().querySelector<HTMLInputElement>('[data-check-row="add_member"] input[type="checkbox"]')!.checked).toBeTrue();
  });

  it('a protected workflow offers no Add stage, and its stages no Move or Remove', async () => {
    await render({ template: PROTECTED });
    expect(el().querySelector('app-page-header p-button')).toBeNull();
    card(0).click();
    await settle();
    expect(panel()!.querySelector('am-row-menu')).toBeNull();
  });

  it('only workflows:manage edits: without it no Add, no panel, and the cards and names open nothing', async () => {
    await render({ manage: false });
    expect(el().querySelector('app-page-header p-button')).toBeNull();
    expect(el().querySelectorAll('[data-testid="stage-edit"]').length).toBe(0);
    expect(card(0).disabled).toBeTrue();
    card(0).click();
    await settle();
    expect(panel()).toBeNull();
  });
});
