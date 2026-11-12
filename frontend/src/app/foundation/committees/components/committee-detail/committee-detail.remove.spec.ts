import { ComponentFixture, TestBed } from '@angular/core/testing';
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
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeMemberDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { CommitteeDetailComponent } from './committee-detail.component';
import { ACTIVE_RULES } from '../../testing';

// ACC-240 (lane A's handover) — Remove member asks the question by the person's
// name and states the server's consequence: no date is sent, so the membership
// ends today, and a LEFT event keeps it in the history.
// ACC-298 — it asks in a dialog with a required reason
// (CommitteeRemoveMemberDialogComponent, whose own spec covers the field, the
// request and the refusals). This spec covers the page's half: Remove opens
// that dialog for the right person, and a removal reloads what the page shows.
// Read from the REAL translation files.

const COMMITTEE: CommitteeDetailDto = {
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Infection Control Committee',
  nameAr: 'لجنة مكافحة العدوى',
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 3,
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
  stageRules: ACTIVE_RULES,
  isDissolving: false,
  typeValue: null,
  orgUnit: null, parent: null, reportsTo: null, currentStageNameEn: null, currentStageNameAr: null,
};

const MEMBER: CommitteeMemberDto = {
  id: 'm-1',
  organizationId: 'org',
  committeeId: 'c-1',
  userId: 'u-1',
  roleValueId: 'role-1',
  joinedAt: '2026-09-01T00:00:00Z',
  leftAt: null,
  isActive: true,
};

describe('CommitteeDetailComponent — Remove member opens the reason dialog (ACC-240, ACC-298)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<CommitteeDetailComponent>;
  let reads: { members: number; events: number };

  function page(lang: 'en' | 'ar'): CommitteeDetailComponent {
    reads = { members: 0, events: 0 };
    TestBed.configureTestingModule({
      imports: [CommitteeDetailComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE),
            listCommittees: () => of([]),
            listMembers: () => {
              reads.members++;
              return of([MEMBER]);
            },
            listMembershipEvents: () => {
              reads.events++;
              return of([]);
            },
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        { provide: LookupService, useValue: { getValues: () => of([]) } },
        { provide: UserService, useValue: { listAllUsers: () => of([{ id: 'u-1', name: 'Sara Al-Mutairi' }]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    fixture = TestBed.createComponent(CommitteeDetailComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    TestBed.resetTestingModule();
  });

  /** What the open dialog shows: its title, its consequence line, its button. */
  const shown = () => ({
    header: document.querySelector('.p-dialog-title')?.textContent?.trim(),
    message: document.querySelector('[data-testid="remove-member-consequence"]')?.textContent?.trim(),
    accept: document.querySelector('[data-testid="remove-member-submit"]')?.textContent?.trim(),
  });

  it('English: opens the dialog for that person, says the membership ends today and stays in the history', () => {
    const p = page('en');
    expect(shown().header).withContext('closed before Remove').toBeUndefined();
    p.onRemoveMember(MEMBER);
    fixture.detectChanges();
    expect(p.removeTarget()).toEqual({ memberId: 'm-1', name: 'Sara Al-Mutairi' });
    expect(shown()).toEqual({
      header: 'Remove Sara Al-Mutairi from this committee?',
      message: "Their membership ends today and stays in the committee's history.",
      accept: 'Remove',
    });
  });

  it('Arabic: the same, in Arabic, with the name as stored (a person has one name)', () => {
    const p = page('ar');
    p.onRemoveMember(MEMBER);
    fixture.detectChanges();
    expect(shown()).toEqual({
      header: 'إزالة Sara Al-Mutairi من هذه اللجنة؟',
      message: 'تنتهي العضوية اليوم وتبقى في سجل اللجنة.',
      accept: 'إزالة',
    });
  });

  it('a removal reloads the members and their history', () => {
    const p = page('en');
    const before = { ...reads };
    p.onMemberRemoved();
    expect(reads).toEqual({ members: before.members + 1, events: before.events + 1 });
  });
});
