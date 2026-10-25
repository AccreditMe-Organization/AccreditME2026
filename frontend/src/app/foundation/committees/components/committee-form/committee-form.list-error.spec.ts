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
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { OrgUnitDto, OrgUnitService } from '../../../organization/services/org-unit.service';
import { CommitteeFormComponent } from './committee-form.component';
import { FORMATION_RULES } from '../../testing';

// ACC-240 — a picker whose list fails to load says so in its field's hint slot,
// with Retry, instead of opening an empty list that says nothing. Retry reads
// that list again, and only that list. Read from the REAL translation files.

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
  stageRules: FORMATION_RULES,
  isDissolving: false,
  typeValue: null,
};

describe('CommitteeFormComponent — a picker list that fails to load (ACC-240)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let types: Subject<LookupValueDto[]>[];
  let units: Subject<OrgUnitDto[]>[];
  let committees: Subject<CommitteeListItemDto[]>[];

  /** Each read returns a fresh stream, so a Retry is a second, separate read. */
  const stream = <T,>(bucket: Subject<T>[]) => (): Observable<T> => {
    const s = new Subject<T>();
    bucket.push(s);
    return s;
  };

  function render(lang: 'en' | 'ar' = 'en'): void {
    types = [];
    units = [];
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
        { provide: LookupService, useValue: { getValues: stream(types) } },
        { provide: OrgUnitService, useValue: { getFlat: stream(units) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    fixture = TestBed.createComponent(CommitteeFormComponent);
    fixture.componentRef.setInput('committee', DETAIL);
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
  const retry = (field: string) => document.querySelector(`[data-cf-field="${field}"] [data-testid="field-hint-action"]`) as HTMLButtonElement | null;

  it('the type list fails: its field says so with Retry; the other fields keep their own hints', () => {
    render();
    types[0]!.error(new Error('down'));
    units[0]!.next([]);
    committees[0]!.next([]);
    fixture.detectChanges();

    // Non-vacuity first: a field whose list arrived still shows its own hint.
    expect(message('orgUnitId')).toBe('Active units only');
    expect(message('typeValueId')).toBe("Couldn't load the list. Retry");
    expect(retry('typeValueId')).not.toBeNull();
    expect(retry('orgUnitId')).toBeNull();
  });

  it('Retry reads only the failed list again; the line goes, and the list arrives', () => {
    render();
    types[0]!.error(new Error('down'));
    units[0]!.next([]);
    committees[0]!.next([]);
    fixture.detectChanges();

    retry('typeValueId')!.click();
    fixture.detectChanges();
    expect([types.length, units.length, committees.length]).toEqual([2, 1, 1]);
    expect(retry('typeValueId')).toBeNull();

    types[1]!.next([{ id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: null } as LookupValueDto]);
    fixture.detectChanges();
    expect(message('typeValueId')).toBe('');
    expect(fixture.componentInstance.typesFailed()).toBeFalse();
  });

  it('the units list fails: Owning unit says so instead of "Active units only"', () => {
    render();
    units[0]!.error(new Error('down'));
    fixture.detectChanges();
    expect(message('orgUnitId')).toBe("Couldn't load the list. Retry");
  });

  it('the committees list fails: Parent and Reports to both say so, and one Retry reads it once', () => {
    render();
    committees[0]!.error(new Error('down'));
    fixture.detectChanges();
    expect(message('parentCommitteeId')).toBe("Couldn't load the list. Retry");
    expect(message('reportingToCommitteeId')).toBe("Couldn't load the list. Retry");

    retry('reportingToCommitteeId')!.click();
    fixture.detectChanges();
    expect(committees.length).toBe(2);
    expect(retry('parentCommitteeId')).toBeNull();
  });

  it('…in Arabic', () => {
    render('ar');
    units[0]!.error(new Error('down'));
    fixture.detectChanges();
    expect(message('orgUnitId')).toBe('تعذّر تحميل القائمة. إعادة المحاولة');
  });
});
