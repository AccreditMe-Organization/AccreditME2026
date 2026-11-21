import { ALL_KINDS, WHO_RULES } from '../stage-who/stage-who-options.testing';
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
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ReviewStagesDto } from '../../services/workflow-template.service';
import { WorkflowStageListComponent } from './workflow-stage-list.component';

// ACC-245 PR 3b — the stages page of the protected committee change request
// workflow (Workflow Setup §3 and §13): "Add review stage" where Add Stage sits
// elsewhere, shown while the server's canAdd holds; at the maximum, one line
// saying why not; an added stage marked "Review stage" in the list and the
// strip, with its people in the server's sentence; every move the app's.

const API = `${environment.apiUrl}/workflow-templates`;

const move = (id: string, from: string, to: string, labelEn: string, kind = 'ADVANCE') => ({
  id,
  fromStageId: from,
  toStageId: to,
  labelEn,
  labelAr: null,
  validatorConfig: null,
  kind,
  mover: 'APP',
  appMove: { key: 'x', en: 'When the request is approved.', ar: 'عند اعتماد الطلب.' },
});

const stage = (id: string, nameEn: string, order: number, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  workflowTemplateId: 'template-cr',
  nameEn,
  nameAr: null,
  description: null,
  order,
  slaWorkingHours: null,
  isInitial: order === 10,
  isFinal: false,
  escalationConfig: null,
  actions: [],
  flags: [],
  liveCount: 0,
  transitions: [],
  ...over,
});

const REVIEW_STAGES = (over: Partial<ReviewStagesDto> = {}): ReviewStagesDto => ({
  canAdd: true,
  max: 9,
  count: 1,
  after: [
    { id: 'st-draft', nameEn: 'Draft', nameAr: 'مسودة' },
    { id: 'st-legal', nameEn: 'Legal review', nameAr: 'المراجعة القانونية' },
  ],
  who: { modes: ['ANY_ONE'], assigneeKinds: ['SPECIFIC_USER', 'POSITION_IN_UNIT', 'ORG_UNIT_HEAD', 'COMMITTEE'] },
  ...over,
});

const TEMPLATE = (reviewStages: ReviewStagesDto = REVIEW_STAGES()) => ({
  id: 'template-cr',
  organizationId: 'org-a',
  nameEn: 'Committee change request',
  nameAr: null,
  objectType: 'COMMITTEE_CHANGE_REQUEST',
  isDefault: true,
  isActive: true,
  isProtected: true,
  editableStageFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig'],
  recordActions: [],
  stageFlags: [{ key: 'APPLIES_APPROVED_CHANGE', labelKey: 'workflow.stageFlag.APPLIES_APPROVED_CHANGE', cardinality: 'exactlyOne' }],
  recordFields: [],
  recordRoutes: { unit: true, committee: true },
  assigneeKinds: ALL_KINDS,
  whoRules: WHO_RULES,
  reviewStages,
  stages: [
    stage('st-draft', 'Draft', 10, { transitions: [move('t-submit', 'st-draft', 'st-legal', 'Submit for review')] }),
    stage('st-legal', 'Legal review', 11, {
      nameAr: 'المراجعة القانونية',
      reviewStage: true,
      editableFields: ['nameEn', 'nameAr', 'description', 'slaWorkingHours', 'escalationConfig', 'who'],
      whoSentence: { en: 'Whoever holds Legal Counsel in Legal Affairs.', ar: 'من يشغل منصب المستشار القانوني في الشؤون القانونية.' },
      transitions: [move('t-approve', 'st-legal', 'st-review', 'Approve'), move('t-return', 'st-legal', 'st-returned', 'Return', 'RETURN')],
    }),
    stage('st-review', 'Under review', 20, { transitions: [move('t-apply', 'st-review', 'st-approved', 'Approve and apply')] }),
    stage('st-approved', 'Approved', 30, { isFinal: true, flags: ['APPLIES_APPROVED_CHANGE'] }),
  ],
});

describe('WorkflowStageListComponent — review stages (ACC-245 PR 3b)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<WorkflowStageListComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];

  async function render(opts: { template?: object; manage?: boolean; language?: 'en' | 'ar' } = {}): Promise<HTMLElement> {
    asked = [];
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
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p !== 'workflows:manage' || (opts.manage ?? true) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ templateId: 'template-cr' }), queryParamMap: convertToParamMap({}) } },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    TestBed.inject(LanguageService).use(opts.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(WorkflowStageListComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/template-cr`).flush(opts.template ?? TEMPLATE());
    return settle();
  }

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
  const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const addReview = (): HTMLElement | null => el().querySelector('[data-testid="add-review-stage"]');

  afterEach(() => http.verify());

  it('"Add review stage" sits where Add Stage sits elsewhere, and Add Stage never shows here', async () => {
    await render();
    expect(text(addReview())).toBe('Add review stage');
    expect(Array.from(el().querySelectorAll('p-button')).map((b) => text(b))).not.toContain('Add Stage');
    expect(el().querySelector('[data-testid="review-stage-limit"]')).toBeNull();
  });

  it('it opens the panel empty, as a review stage', async () => {
    await render();
    (addReview()!.querySelector('button') as HTMLButtonElement).click();
    await settle();
    expect(text(el().querySelector('[data-panel-heading]'))).toBe('Add review stage');
    expect(el().querySelector('[data-goes-after]')).not.toBeNull();
  });

  it('at the maximum the button is gone, and one line says why, with the server\'s max', async () => {
    // A maximum the static refusal text does not say, so the line is the server's.
    await render({ template: TEMPLATE(REVIEW_STAGES({ canAdd: false, max: 7, count: 7 })) });
    expect(addReview()).toBeNull();
    expect(text(el().querySelector('[data-testid="review-stage-limit"]'))).toBe('A change request can go through up to 7 review stages.');
  });

  it("canAdd alone decides the button: false below the maximum shows neither it nor the line", async () => {
    await render({ template: TEMPLATE(REVIEW_STAGES({ canAdd: false, count: 3 })) });
    expect(addReview()).toBeNull();
    expect(el().querySelector('[data-testid="review-stage-limit"]')).toBeNull();
  });

  it('without workflows:manage, neither', async () => {
    await render({ manage: false, template: TEMPLATE(REVIEW_STAGES({ canAdd: false, count: 9 })) });
    expect(addReview()).toBeNull();
    expect(el().querySelector('[data-testid="review-stage-limit"]')).toBeNull();
  });

  it('a workflow with no reviewStages (any other) offers neither', async () => {
    const { reviewStages: _omit, ...other } = TEMPLATE();
    void _omit;
    await render({ template: { ...other, isProtected: false } });
    expect(addReview()).toBeNull();
  });

  it('the list marks the added stage "Review stage", with its people in the server\'s sentence; keyed stages carry neither', async () => {
    await render();
    const rows = Array.from(el().querySelectorAll('[data-cell="stage"]'));
    const legal = rows.find((r) => text(r.querySelector('[data-stage-name]')) === 'Legal review')!;
    expect(text(legal.querySelector('[data-review-chip]'))).toBe('Review stage');
    expect(text(legal.querySelector('[data-review-who]'))).toBe('Whoever holds Legal Counsel in Legal Affairs.');
    const draft = rows.find((r) => text(r.querySelector('[data-stage-name]')) === 'Draft')!;
    expect(draft.querySelector('[data-review-chip]')).toBeNull();
    expect(draft.querySelector('[data-review-who]')).toBeNull();
  });

  it('the strip: the added stage carries the chip, and every move on the path is drawn as the app\'s, with its legend', async () => {
    await render();
    const cards = Array.from(el().querySelectorAll('[data-strip-card]'));
    expect(cards.map((c) => !!c.querySelector('[data-strip-review]'))).toEqual([false, true, false, false]);
    expect(Array.from(el().querySelectorAll('[data-strip-app]')).map((l) => text(l))).toEqual(['Submit for review', 'Approve', 'Approve and apply']);
    expect(text(el().querySelector('[data-strip-app-key]'))).toBe('Done by the app');
  });

  it('in Arabic: the chip, the who line and the button', async () => {
    await render({ language: 'ar' });
    expect(text(addReview())).toBe('إضافة مرحلة مراجعة');
    expect(text(el().querySelector('[data-review-chip]'))).toBe('مرحلة مراجعة');
    expect(text(el().querySelector('[data-review-who]'))).toBe('من يشغل منصب المستشار القانوني في الشؤون القانونية.');
  });

  it('a review stage removed from its panel closes the panel and reads the workflow again', async () => {
    await render();
    (el().querySelector('[data-strip-card][data-stage-id="st-legal"]') as HTMLButtonElement).click();
    await settle();
    (el().querySelector('[data-panel-remove]') as HTMLButtonElement).click();
    asked[0]!.accept!();
    http.expectOne(`${API}/stages/st-legal`).flush(null);
    http.expectOne(`${API}/template-cr`).flush(TEMPLATE(REVIEW_STAGES({ count: 0 })));
    await settle();
    expect(el().querySelector('[data-stage-panel]')).toBeNull();
  });
});
