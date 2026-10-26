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
import { WorkflowService } from '../../../workflow/services/workflow.service';
import { ACTIVE_RULES } from '../../testing';
import { CommitteeDetailComponent } from './committee-detail.component';

// ACC-265 item 1 — the committee page names its type and owning unit from the
// committee read itself (typeValue, orgUnit). It loads neither the type list
// (GET /lookups/…/committee_type/values, lookups:view) nor the unit list
// (GET /organization/units/flat, org:view), so a reader holding committees:view
// and nothing else sees both names, in either language.

const COMMITTEE = (over: Partial<CommitteeDetailDto> = {}): CommitteeDetailDto => ({
  id: 'c-1',
  organizationId: 'org',
  nameEn: 'Patient Experience Committee',
  nameAr: 'لجنة تجربة المريض',
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-qa',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  isDissolving: false,
  stageRules: ACTIVE_RULES,
  typeValue: { id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: 'لجنة الجودة', offered: true },
  orgUnit: { id: 'unit-qa', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' },
  ...over,
});

describe('CommitteeDetailComponent — the type and owning unit come with the committee (ACC-265)', () => {
  preserveDocumentLanguage();

  let lookupCategories: string[];
  let unitListReads: number;

  function render(committee: CommitteeDetailDto, lang: 'en' | 'ar' = 'en'): HTMLElement {
    lookupCategories = [];
    unitListReads = 0;
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
        // A reader with committees:view and nothing else: no lookups:view, no org:view.
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => p === 'committees:view' } },
        {
          provide: CommitteeService,
          useValue: {
            getById: () => of(committee),
            listCommittees: () => of([]),
            listMembers: () => of([]),
            listMembershipEvents: () => of([]),
            membersPage: () => of({ items: [], total: 0, matching: 0 }),
            subCommittees: () => of({ items: [], total: 0, matching: 0 }),
          },
        },
        {
          provide: LookupService,
          useValue: {
            getValues: (category: string) => {
              lookupCategories.push(category);
              return of([]);
            },
          },
        },
        { provide: UserService, useValue: { listAllUsers: () => of([]) } },
        {
          provide: OrgUnitService,
          useValue: {
            getFlat: () => {
              unitListReads++;
              return of([]);
            },
          },
        },
        { provide: WorkflowService, useValue: { getInstancesByObject: () => of([]) } },
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

  /** The value under a header label: the cell whose first line is that label. */
  function cell(page: HTMLElement, label: string): string | null {
    for (const box of Array.from(page.querySelectorAll<HTMLElement>('div'))) {
      const [head, value] = Array.from(box.children) as HTMLElement[];
      if (box.children.length === 2 && head?.textContent?.trim() === label) return value!.textContent!.trim();
    }
    return null;
  }

  it('names both from the read, and asks for neither list', () => {
    const page = render(COMMITTEE());
    // Non-vacuity: the header rendered its cells.
    expect(cell(page, 'Committee Type')).withContext('type cell rendered').not.toBeNull();

    expect(cell(page, 'Committee Type')).toBe('Quality Committee');
    expect(cell(page, 'Owning Unit')).toBe('Quality Department (إدارة الجودة)');
    expect(lookupCategories).not.toContain('committee_type');
    expect(unitListReads).toBe(0);
  });

  it('in Arabic, the type reads its Arabic label', () => {
    const page = render(COMMITTEE(), 'ar');
    expect(cell(page, ar.committee.type)).toBe('لجنة الجودة');
    expect(cell(page, ar.committee.owningUnit)).toBe('Quality Department (إدارة الجودة)');
  });

  it('a type or unit the organisation does not have reads "—", never an id', () => {
    const page = render(COMMITTEE({ typeValue: null, orgUnit: null }));
    expect(cell(page, 'Committee Type')).toBe('—');
    expect(cell(page, 'Owning Unit')).toBe('—');
    expect(page.textContent).not.toContain('type-1');
    expect(page.textContent).not.toContain('unit-qa');
  });
});
