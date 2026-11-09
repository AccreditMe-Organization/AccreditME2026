import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowInstanceDto, WorkflowMovesDto, WorkflowService } from '../../../workflow/services/workflow.service';
import { WorkflowTemplateService } from '../../../workflow/services/workflow-template.service';
import { ACTIVE_RULES } from '../../testing';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-281 — a member without committees:view opens their own committee's page.
// The page sends only the reads this viewer may make: no committee list (the
// parent, Reports to and stage come with the committee read), no user list
// without users:view, no lookup without lookups:view, no instance read without
// workflows:view. Membership history is loaded: members read all of it.

const COMMITTEE = (over: Partial<CommitteeDetailDto> = {}): CommitteeDetailDto => ({
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Patient Experience Committee',
  nameAr: 'لجنة تجربة المريض',
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: 'c-parent',
  orgUnitId: 'unit-qa',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: 'c-board',
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  isDissolving: false,
  stageRules: ACTIVE_RULES,
  typeValue: null,
  orgUnit: null,
  parent: { id: 'c-parent', nameEn: 'Quality Council', nameAr: 'مجلس الجودة', mayOpen: true },
  reportsTo: { id: 'c-board', nameEn: 'Board of Directors', nameAr: null, mayOpen: false },
  currentStageNameEn: 'Active',
  currentStageNameAr: 'نشطة',
  ...over,
});

// ACC-282 — the committee's workflow, as GET /workflows/instances answers it.
const INSTANCE: WorkflowInstanceDto = {
  id: 'inst-1',
  organizationId: 'org',
  workflowTemplateId: 'tpl-1',
  objectType: 'COMMITTEE',
  objectId: 'c-1',
  status: 'IN_PROGRESS',
  currentStageId: 'stage-active',
  createdAt: '2026-09-01T08:00:00Z',
  updatedAt: '2026-10-10T08:00:00Z',
  unassignedTaskWarnings: [],
};
const MOVES: WorkflowMovesDto = {
  transitionIds: ['t-suspend'],
  moves: [
    { id: 't-suspend', labelEn: 'Suspend Committee', labelAr: null, kind: 'ADVANCE', toStageId: 'stage-suspended', toStageNameEn: 'Suspended', toStageNameAr: null },
  ],
};
const NO_MOVES: WorkflowMovesDto = { transitionIds: [], moves: [] };

describe('CommitteeDetailComponent — a member without committees:view (ACC-281)', () => {
  preserveDocumentLanguage();

  let calls: string[];

  function render(
    held: string[],
    committee = COMMITTEE(),
    lang: 'en' | 'ar' = 'en',
    workflow: { instances?: WorkflowInstanceDto[]; moves?: WorkflowMovesDto } = {},
  ): HTMLElement {
    calls = [];
    const record =
      <T>(name: string, value: T) =>
      (...args: unknown[]) => {
        calls.push(name + (typeof args[0] === 'string' && name === 'lookups' ? `:${args[0]}` : ''));
        return of(value);
      };
    TestBed.configureTestingModule({
      imports: [CommitteeDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => held.includes(p) } },
        {
          provide: CommitteeService,
          useValue: {
            getById: record('getById', committee),
            listCommittees: record('listCommittees', []),
            listMembers: record('listMembers', []),
            listMembershipEvents: record('listMembershipEvents', []),
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        { provide: LookupService, useValue: { getValues: record('lookups', []) } },
        { provide: UserService, useValue: { listAllUsers: record('listAllUsers', []) } },
        { provide: OrgUnitService, useValue: { getFlat: record('getFlat', []) } },
        {
          provide: WorkflowService,
          useValue: {
            getInstancesByObject: record('getInstancesByObject', workflow.instances ?? []),
            getMoves: record('getMoves', workflow.moves ?? NO_MOVES),
            getStageHistory: record('getStageHistory', { instanceId: 'inst-1', stages: [], visits: [] }),
          },
        },
        // ACC-282 — the buttons read no template (workflows:view); a call here is a regression.
        { provide: WorkflowTemplateService, useValue: { getTemplate: record('getTemplate', null) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    const fixture = TestBed.createComponent(CommitteeDetailComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('sends only the reads a member may make, and still loads Membership history', () => {
    render([]);
    // Non-vacuity: the page did load, through the reads this viewer may make.
    expect(calls).withContext('the committee read').toContain('getById');
    expect(calls).toContain('listMembershipEvents');

    expect(calls).not.toContain('listCommittees');
    expect(calls).not.toContain('listAllUsers');
    expect(calls).not.toContain('lookups:committee_member_role');
    // ACC-282 — whoever may open the committee may read its workflow.
    expect(calls).toContain('getInstancesByObject');
  });

  it('each read gated on a permission is sent once the viewer holds it', () => {
    render(['users:view', 'lookups:view', 'workflows:view']);
    expect(calls).toContain('listAllUsers');
    expect(calls).toContain('lookups:committee_member_role');
    expect(calls).toContain('getInstancesByObject');
    // The committee list is never read: the committee read names what it needed.
    expect(calls).not.toContain('listCommittees');
  });

  it('links the parent only where this viewer may open it, and names Reports to either way', () => {
    const page = render([]);
    const parent = page.querySelector<HTMLElement>('[data-testid="committee-parent"]');
    const reportsTo = page.querySelector<HTMLElement>('[data-testid="committee-reports-to"]');
    expect(parent).withContext('parent rendered').not.toBeNull();
    expect(reportsTo).withContext('Reports to rendered').not.toBeNull();

    expect(parent!.tagName).toBe('A');
    expect(parent!.textContent!.trim()).toBe('Quality Council');
    expect(reportsTo!.tagName).toBe('SPAN');
    expect(reportsTo!.textContent!.trim()).toBe('Board of Directors');
  });

  it('in Arabic, a related committee with no Arabic name reads its English one', () => {
    const page = render([], COMMITTEE(), 'ar');
    expect(page.querySelector('[data-testid="committee-parent"]')!.textContent!.trim()).toBe('مجلس الجودة');
    expect(page.querySelector('[data-testid="committee-reports-to"]')!.textContent!.trim()).toBe('Board of Directors');
  });

  it('with neither, both read "—"', () => {
    const page = render([], COMMITTEE({ parentCommitteeId: null, reportingToCommitteeId: null, parent: null, reportsTo: null }));
    expect(page.querySelector('[data-testid="committee-parent"]')).toBeNull();
    expect(page.querySelector('[data-testid="committee-reports-to"]')).toBeNull();
  });

  it('names the stage from the committee read, with no workflow shown when there is none', () => {
    const page = render([]);
    expect(page.textContent).toContain('Active');
    expect(page.querySelector('[data-lifecycle-card]')).toBeNull();
    expect(calls).not.toContain('getMoves');
  });

  // ACC-282 (Ahmad, 8 Nov) — a member reads the committee's workflow; the buttons
  // are the moves read's, which lists moves only for someone in the stage's pool.
  describe('the workflow, without workflows:view (ACC-282)', () => {
    const button = (page: HTMLElement, label: string) =>
      Array.from(page.querySelectorAll('button')).find((b) => b.textContent?.includes(label)) ?? null;

    it('a member in the pool: the Lifecycle card, Stage history and the move, labelled from the moves read', () => {
      const page = render([], COMMITTEE(), 'en', { instances: [INSTANCE], moves: MOVES });
      // Non-vacuity: the workflow did load.
      expect(calls).withContext('the instance read').toContain('getInstancesByObject');
      expect(page.querySelector('[data-lifecycle-card]')).withContext('the Lifecycle card').not.toBeNull();
      expect(page.querySelector('[data-stage-history]')).withContext('Stage history').not.toBeNull();
      expect(calls).toContain('getStageHistory');
      expect(calls).toContain('getMoves');

      expect(button(page, 'Suspend Committee')).withContext('the move').not.toBeNull();
      expect(calls).not.toContain('getTemplate');
    });

    it('a member outside the pool: the Lifecycle card and Stage history, and no move', () => {
      const page = render([], COMMITTEE(), 'en', { instances: [INSTANCE], moves: NO_MOVES });
      expect(page.querySelector('[data-lifecycle-card]')).not.toBeNull();
      expect(page.querySelector('[data-stage-history]')).not.toBeNull();
      expect(calls).toContain('getMoves');
      expect(button(page, 'Suspend Committee')).toBeNull();
      expect(calls).not.toContain('getTemplate');
    });
  });
});
