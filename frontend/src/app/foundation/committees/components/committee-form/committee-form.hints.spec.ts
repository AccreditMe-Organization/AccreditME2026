import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, Subject } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupService } from '../../../lookup/services/lookup.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { CommitteeFormComponent } from './committee-form.component';

// ACC-240 — Parent committee and Reports to say what they are for, then
// ACC-233's line saying what their list leaves out (Ahmad, 22 Oct: both). A
// failed list replaces both, and so does Reports to's "Filled in from Parent
// committee". Read from the REAL translation files, with the literal sentences
// pinned so a wording change is a decision a spec sees.

const DETAIL: CommitteeDetailDto = {
  id: 'self',
  organizationId: 'org',
  nameEn: 'Patient Safety Committee',
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: null,
  orgUnitId: 'unit-qps',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: null,
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-18T09:00:00.123Z',
  currentStageKey: 'formation',
  isDissolving: false,
  typeValue: null,
};

const OTHER = { ...DETAIL, id: 'c-9', nameEn: 'Medical Executive Committee', memberCount: 9, currentStageNameEn: null, currentStageNameAr: null } as unknown as CommitteeListItemDto;

const HINT = {
  en: {
    parent: 'The committee this one is a sub-committee of.',
    reportsTo: 'Where its minutes and recommendations go for decisions.',
  },
  ar: {
    parent: 'اللجنة التي تتبع لها هذه اللجنة كلجنة فرعية.',
    reportsTo: 'اللجنة التي تُرفع إليها محاضرها وتوصياتها لاتخاذ القرار.',
  },
};

describe('CommitteeFormComponent — what Parent committee and Reports to are for (ACC-240)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let committees: Subject<CommitteeListItemDto[]>[];

  const stream = <T,>(bucket: Subject<T>[]) => (): Observable<T> => {
    const s = new Subject<T>();
    bucket.push(s);
    return s;
  };

  function render(lang: 'en' | 'ar', committee: CommitteeDetailDto | null): void {
    committees = [];
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        {
          provide: CommitteeService,
          useValue: { listCommittees: stream(committees), update: () => of(DETAIL), create: () => of(DETAIL), getById: () => of(DETAIL) },
        },
        { provide: LookupService, useValue: { getValues: () => of([]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    fixture = TestBed.createComponent(CommitteeFormComponent);
    fixture.componentRef.setInput('committee', committee);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  }

  afterEach(() => {
    fixture?.destroy();
    TestBed.resetTestingModule();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  const message = (field: string) =>
    (document.querySelector(`[data-cf-field="${field}"] .am-field__message`)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  for (const lang of ['en', 'ar'] as const) {
    const files = { en, ar }[lang].committee.form;

    it(`editing [${lang}]: each says what it is for, then what its list leaves out`, () => {
      render(lang, DETAIL);
      committees[0]!.next([OTHER]);
      fixture.detectChanges();
      expect(message('parentCommitteeId')).toBe(`${HINT[lang].parent} ${files.parentLeftOut}`);
      expect(message('reportingToCommitteeId')).toBe(`${HINT[lang].reportsTo} ${files.reportsToLeftOut}`);
    });

    it(`adding [${lang}]: the same, with the new committee's list line`, () => {
      render(lang, null);
      committees[0]!.next([OTHER]);
      fixture.detectChanges();
      expect(message('parentCommitteeId')).toBe(`${HINT[lang].parent} ${files.leftOutNew}`);
      expect(message('reportingToCommitteeId')).toBe(`${HINT[lang].reportsTo} ${files.leftOutNew}`);
    });

    it(`a failed list [${lang}]: "Couldn't load the list." replaces both lines`, () => {
      render(lang, DETAIL);
      committees[0]!.error(new Error('down'));
      fixture.detectChanges();
      for (const field of ['parentCommitteeId', 'reportingToCommitteeId']) {
        const m = message(field);
        expect(m.startsWith(files.listFailed)).withContext(`${field}: ${m}`).toBeTrue();
        expect(m).not.toContain(field === 'parentCommitteeId' ? HINT[lang].parent : HINT[lang].reportsTo);
      }
    });

    it(`Reports to filled in from the parent [${lang}]: that line replaces the hint`, () => {
      render(lang, DETAIL);
      committees[0]!.next([OTHER]);
      fixture.detectChanges();
      fixture.componentInstance.form.controls.parentCommitteeId.setValue('c-9');
      fixture.detectChanges();
      expect(message('reportingToCommitteeId')).toBe(files.reportsToFilledIn);
      expect(message('parentCommitteeId')).toBe(`${HINT[lang].parent} ${files.parentLeftOut}`);
    });
  }
});
