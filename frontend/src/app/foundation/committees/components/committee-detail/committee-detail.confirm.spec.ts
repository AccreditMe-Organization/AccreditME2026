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
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { CommitteeDetailDto, CommitteeMemberDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { CommitteeDetailComponent } from './committee-detail.component';
import { ACTIVE_RULES } from '../../testing';

// ACC-240 (lane A's handover) — Remove member asks the question by the person's
// name and states the server's consequence: no date is sent, so the membership
// ends today (committees.service.ts:397, :401–403), and a LEFT event keeps it
// in the history (:406–413). Read from the REAL translation files.

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
  orgUnit: null,
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

describe('CommitteeDetailComponent — the Remove member confirm (ACC-240)', () => {
  preserveDocumentLanguage();
  let asked: AmConfirmOptions[];

  function page(lang: 'en' | 'ar'): CommitteeDetailComponent {
    asked = [];
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
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'c-1' }) }, queryParamMap: of(convertToParamMap({})) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(COMMITTEE),
            listCommittees: () => of([]),
            listMembers: () => of([MEMBER]),
            listMembershipEvents: () => of([]),
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
    const fixture = TestBed.createComponent(CommitteeDetailComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  afterEach(() => TestBed.resetTestingModule());

  const said = () => {
    expect(asked.length).withContext('asked exactly once').toBe(1);
    const o = asked[0]!;
    return { tone: o.tone, header: o.header, message: o.message, accept: o.acceptLabel };
  };

  it('English: names the person, says the membership ends today and stays in the history, and is destructive', () => {
    page('en').onRemoveMember(MEMBER);
    expect(said()).toEqual({
      tone: 'destructive',
      header: 'Remove Sara Al-Mutairi from this committee?',
      message: "Their membership ends today and stays in the committee's history.",
      accept: 'Remove',
    });
  });

  it('Arabic: the same, in Arabic, with the name as stored (a person has one name)', () => {
    page('ar').onRemoveMember(MEMBER);
    expect(said()).toEqual({
      tone: 'destructive',
      header: 'إزالة Sara Al-Mutairi من هذه اللجنة؟',
      message: 'تنتهي العضوية اليوم وتبقى في سجل اللجنة.',
      accept: 'إزالة',
    });
  });
});
