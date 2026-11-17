import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { CommitteeDetailDto, CommitteeMemberRowDto, CommitteeService, CommitteeStageRulesDto } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { NO_STAGE_RULES, committeeOffers } from '../../committee-offers';
import { FORMATION_RULES, SEEDED_STAGE_RULES, TERMS_REVIEW_RULES, tenantStageRules } from '../../testing';
import { CommitteeMembersPanelComponent } from '../committee-members-panel/committee-members-panel.component';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-238 / ACC-255 PR 3 — the committee page offers what the SERVER says the
// committee's current stage allows (`stageRules`), with each action's own
// permission: Edit, the Terms Review locked line, and the members panel's Add,
// Change role and Remove. Rendered: the real page template, with the committee
// in each seeded stage (as the server answers it after PR 2) and in stages a
// tenant configured, so a rule read from a key or a name would show.

const COMMITTEE = (stageRules: CommitteeStageRulesDto): CommitteeDetailDto => ({
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
  isDissolving: stageRules.flags.includes('DISSOLVING'),
  stageRules,
  typeValue: null,
  orgUnit: null, parent: null, reportsTo: null, currentStageNameEn: null, currentStageNameAr: null, mayWrite: true,
});

const ALL = ['committees:edit_details', 'committees:add_member', 'committees:remove_member', 'committees:change_member_role'];

describe('CommitteeDetailComponent — the header and members panel by the stage’s rules (ACC-255)', () => {
  let fixture: ComponentFixture<CommitteeDetailComponent>;

  function render(
    stageRules: CommitteeStageRulesDto,
    held: readonly string[] = ALL,
    opts: { mayWrite?: boolean; members?: CommitteeMemberRowDto[] } = {},
  ): HTMLElement {
    const members = opts.members ?? [];
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
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => held.includes(p) } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of({ ...COMMITTEE(stageRules), mayWrite: opts.mayWrite ?? true }),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of([]),
            membersPage: () => of({ items: members, total: members.length, matching: members.length }),
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

  const has = (page: HTMLElement, testId: string): boolean => !!page.querySelector(`[data-testid="${testId}"]`);
  const panel = (): CommitteeMembersPanelComponent =>
    fixture.debugElement.query(By.directive(CommitteeMembersPanelComponent)).componentInstance as CommitteeMembersPanelComponent;

  // What each seeded stage offers someone holding every committee permission.
  const EXPECTED: Record<string, { edit: boolean; lockedLine: boolean; members: boolean }> = {
    Formation: { edit: true, lockedLine: false, members: true },
    'Terms Review': { edit: false, lockedLine: true, members: true },
    Active: { edit: false, lockedLine: false, members: true },
    Suspended: { edit: false, lockedLine: false, members: true },
    'Dissolution Pending': { edit: false, lockedLine: false, members: true },
    // ACC-255 PR 2 (Q-A): a dissolved committee's members can't be changed.
    Dissolved: { edit: false, lockedLine: false, members: false },
  };

  for (const { stage, rules } of SEEDED_STAGE_RULES) {
    it(`${stage}: Edit, the locked line and the member actions as the server's rules say`, () => {
      const page = render(rules);
      const want = EXPECTED[stage]!;
      expect(has(page, 'committee-edit')).withContext('Edit').toBe(want.edit);
      expect(has(page, 'committee-locked-line')).withContext('locked line').toBe(want.lockedLine);
      expect(has(page, 'committee-members-add')).withContext('Add Member').toBe(want.members);
      expect(panel().canChangeRole()).withContext('Change role').toBe(want.members);
      expect(panel().canRemove()).withContext('Remove').toBe(want.members);
    });
  }

  it('the locked line reads the Terms Review sentence', () => {
    const line = render(TERMS_REVIEW_RULES).querySelector('[data-testid="committee-locked-line"]');
    expect(line?.textContent?.trim()).toBe('committee.lockedTermsReview');
  });

  it('without the permissions, nothing is offered even where the stage allows it', () => {
    const page = render(FORMATION_RULES, []);
    expect(has(page, 'committee-edit')).toBeFalse();
    expect(has(page, 'committee-locked-line')).toBeFalse();
    expect(has(page, 'committee-members-add')).toBeFalse();
    expect(panel().canChangeRole()).toBeFalse();
    expect(panel().canRemove()).toBeFalse();
  });

  it('each member action follows its own permission', () => {
    render(FORMATION_RULES, ['committees:remove_member']);
    expect(panel().canAddMember()).toBeFalse();
    expect(panel().canChangeRole()).toBeFalse();
    expect(panel().canRemove()).toBeTrue();
  });

  it('a stage a tenant configured is offered by its rules, whatever it is called: in force, allowing an edit', () => {
    const page = render(tenantStageRules(['edit_details'], ['IN_FORCE']));
    expect(has(page, 'committee-edit')).toBeTrue();
    expect(has(page, 'committee-members-add')).toBeFalse();
  });

  it('…and a tenant stage that allows only removing members offers exactly that', () => {
    const page = render(tenantStageRules(['remove_member'], ['IN_FORCE']));
    expect(has(page, 'committee-edit')).toBeFalse();
    expect(has(page, 'committee-locked-line')).toBeFalse();
    expect(has(page, 'committee-members-add')).toBeFalse();
    expect(panel().canRemove()).toBeTrue();
  });

  // ACC-283 — the server's mayWrite. A unit head who only oversees the committee
  // reads it false: whatever they hold, the page offers no write, because the
  // server would refuse each one (assertMayWriteCommittee). A member holding the
  // same permissions reads it true and is offered every write the stage allows.
  describe('mayWrite (ACC-283)', () => {
    const MEMBER: CommitteeMemberRowDto = {
      id: 'm-1', userId: 'u-1', name: 'Huda Al-Qahtani', roleValueId: 'r-sec', roleLabelEn: 'Secretary', roleLabelAr: 'أمين السر', joinedAt: '2026-03-01T00:00:00.000Z',
    };
    const rowMenus = (page: HTMLElement): number => page.querySelectorAll('[data-committee-panels] am-row-menu').length;
    const show = (mayWrite: boolean): HTMLElement => {
      const page = render(FORMATION_RULES, ALL, { mayWrite, members: [MEMBER] });
      fixture.detectChanges();
      // Non-vacuity: the member row is drawn, so a missing ⋯ is the rule, not an empty panel.
      expect(page.textContent).withContext('the member row renders').toContain('Huda Al-Qahtani');
      return page;
    };

    it('an overseeing head with every write permission sees no Edit, Add member or row ⋯', () => {
      const page = show(false);
      expect(has(page, 'committee-edit')).withContext('Edit').toBeFalse();
      expect(has(page, 'committee-locked-line')).withContext('locked line').toBeFalse();
      expect(has(page, 'committee-members-add')).withContext('Add member').toBeFalse();
      expect(panel().canChangeRole()).withContext('Change role').toBeFalse();
      expect(panel().canRemove()).withContext('Remove').toBeFalse();
      expect(rowMenus(page)).withContext('row ⋯').toBe(0);
    });

    it('a member with the same permissions sees Edit, Add member and the row ⋯', () => {
      const page = show(true);
      expect(has(page, 'committee-edit')).withContext('Edit').toBeTrue();
      expect(has(page, 'committee-members-add')).withContext('Add member').toBeTrue();
      expect(panel().canChangeRole()).withContext('Change role').toBeTrue();
      expect(panel().canRemove()).withContext('Remove').toBeTrue();
      expect(rowMenus(page)).withContext('row ⋯').toBe(1);
    });

    it('Terms Review: the locked line is for someone who could edit, so an overseeing head is not told it', () => {
      expect(has(render(TERMS_REVIEW_RULES, ALL, { mayWrite: true }), 'committee-locked-line')).withContext('member').toBeTrue();
      TestBed.resetTestingModule();
      expect(has(render(TERMS_REVIEW_RULES, ALL, { mayWrite: false }), 'committee-locked-line')).withContext('head').toBeFalse();
    });
  });

  describe('committeeOffers()', () => {
    const everything = { editDetails: true, addMember: true, removeMember: true, changeMemberRole: true };

    it('the locked line is "no edit here, not in force, not being dissolved"', () => {
      expect(committeeOffers(tenantStageRules([]), everything, true).lockedLine).toBeTrue();
      expect(committeeOffers(tenantStageRules([], ['IN_FORCE']), everything, true).lockedLine).toBeFalse();
      expect(committeeOffers(tenantStageRules([], ['DISSOLVING']), everything, true).lockedLine).toBeFalse();
      expect(committeeOffers(tenantStageRules(['edit_details']), everything, true).lockedLine).toBeFalse();
    });

    it('a committee with no rules offers nothing to edit or change', () => {
      for (const rules of [null, undefined, NO_STAGE_RULES]) {
        const offers = committeeOffers(rules, everything, true);
        expect([offers.edit, offers.addMember, offers.removeMember, offers.changeMemberRole]).toEqual([false, false, false, false]);
      }
    });
  });
});
