import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { CommitteeDetailDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { COMMITTEE_STAGE_KEYS_FOR_TEST, committeeHeaderOffers } from '../../committee-stage';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-238 — the committee page offers Edit in Formation ONLY, decided by the
// stage KEY, never the name. Terms Review shows the locked line instead, to the
// people who could edit in Formation. Rendered: the real page template, with
// the committee in each stage of its seeded lifecycle and in a stage a tenant
// added (no key).
//
// The API still accepts a direct edit in any stage until ACC-241; this is the
// screens' half.

const COMMITTEE = (stageKey: string | null): CommitteeDetailDto => ({
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Patient Experience Committee',
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 0,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-root',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  currentStageKey: stageKey,
  isDissolving: stageKey === 'dissolution_pending' || stageKey === 'dissolved',
});

describe('CommitteeDetailComponent — the header by stage key (ACC-238)', () => {
  let fixture: ComponentFixture<CommitteeDetailComponent>;

  function render(stageKey: string | null, canEditDetails = true): HTMLElement {
    TestBed.configureTestingModule({
      imports: [CommitteeDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => (p === 'committees:edit_details' ? canEditDetails : false) } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE(stageKey)),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of([]),
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([]) } },
        { provide: UserService, useValue: { listAllUsers: () => of([]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    fixture = TestBed.createComponent(CommitteeDetailComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('offers Edit in Formation, and no locked line', () => {
    const page = render('formation');
    expect(page.querySelector('[data-testid="committee-edit"]')).not.toBeNull();
    expect(page.querySelector('[data-testid="committee-locked-line"]')).toBeNull();
  });

  for (const key of COMMITTEE_STAGE_KEYS_FOR_TEST.filter((k) => k !== 'formation')) {
    it(`offers no Edit in ${key}`, () => {
      const page = render(key);
      expect(page.querySelector('[data-testid="committee-edit"]')).withContext(key).toBeNull();
    });
  }

  it('offers no Edit in a stage a tenant added (no key)', () => {
    expect(render(null).querySelector('[data-testid="committee-edit"]')).toBeNull();
  });

  it('Terms Review shows the locked line to holders of committees:edit_details', () => {
    const line = render('terms_review').querySelector('[data-testid="committee-locked-line"]');
    expect(line?.textContent?.trim()).toBe('committee.lockedTermsReview');
  });

  it('…and neither Edit nor the line to anyone without it', () => {
    const page = render('terms_review', false);
    expect(page.querySelector('[data-testid="committee-locked-line"]')).toBeNull();
    TestBed.resetTestingModule();
    expect(render('formation', false).querySelector('[data-testid="committee-edit"]')).toBeNull();
  });

  it('the locked line appears in Terms Review only', () => {
    for (const key of COMMITTEE_STAGE_KEYS_FOR_TEST) {
      expect(committeeHeaderOffers(key, true).lockedLine).withContext(key).toBe(key === 'terms_review');
    }
  });
});
