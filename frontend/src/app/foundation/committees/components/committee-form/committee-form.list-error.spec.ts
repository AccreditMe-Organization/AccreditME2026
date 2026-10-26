import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, Subject } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { CommitteeDetailDto, CommitteeFormChoicesDto, CommitteeListItemDto, CommitteeService } from '../../services/committee.service';
import { LookupValueDto } from '../../../lookup/services/lookup.service';
import { CommitteeFormComponent } from './committee-form.component';
import { FORMATION_RULES } from '../../testing';

// ACC-240 — a picker whose list fails to load says so in its field's hint slot,
// with Retry, instead of opening an empty list that says nothing. Retry reads
// that list again, and only that list. Read from the REAL translation files.
//
// ACC-255 (plan §10.5) — the committee types and the unit tree come in ONE read,
// GET /committees/form-choices, so they fail together and one Retry reads both.
// The committees list is its own read.

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
  orgUnit: null,
};

describe('CommitteeFormComponent — a picker list that fails to load (ACC-240)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let choices: Subject<CommitteeFormChoicesDto>[];
  let committees: Subject<CommitteeListItemDto[]>[];

  /** Each read returns a fresh stream, so a Retry is a second, separate read. */
  const stream = <T,>(bucket: Subject<T>[]) => (): Observable<T> => {
    const s = new Subject<T>();
    bucket.push(s);
    return s;
  };

  function render(lang: 'en' | 'ar' = 'en'): void {
    choices = [];
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
          useValue: {
            listCommittees: stream(committees),
            formChoices: stream(choices),
            update: () => of(DETAIL),
            create: () => of(DETAIL),
            getById: () => of(DETAIL),
          },
        },
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

  it('the choices read fails: Committee type and Owning unit say so with Retry; Parent and Reports to keep their own hints', () => {
    render();
    choices[0]!.error(new Error('down'));
    committees[0]!.next([]);
    fixture.detectChanges();

    // Non-vacuity first: a field whose list arrived still shows its own hint.
    expect(message('parentCommitteeId')).not.toBe("Couldn't load the list. Retry");
    expect(retry('parentCommitteeId')).toBeNull();
    expect(message('typeValueId')).toBe("Couldn't load the list. Retry");
    expect(message('orgUnitId')).toBe("Couldn't load the list. Retry");
    expect(retry('typeValueId')).not.toBeNull();
    expect(retry('orgUnitId')).not.toBeNull();
  });

  it('Retry on either reads the choices once again; both lines go, both lists arrive, the committees are not read again', () => {
    render();
    choices[0]!.error(new Error('down'));
    committees[0]!.next([]);
    fixture.detectChanges();

    retry('typeValueId')!.click();
    fixture.detectChanges();
    expect([choices.length, committees.length]).toEqual([2, 1]);
    expect(retry('typeValueId')).toBeNull();
    expect(retry('orgUnitId')).toBeNull();

    choices[1]!.next({
      committeeTypes: [{ id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: null } as LookupValueDto],
      orgUnits: [],
    });
    fixture.detectChanges();
    expect(message('typeValueId')).toBe('');
    expect(message('orgUnitId')).toBe('Active units only');
    expect(fixture.componentInstance.typesFailed()).toBeFalse();
    expect(fixture.componentInstance.unitsFailed()).toBeFalse();
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
    choices[0]!.error(new Error('down'));
    fixture.detectChanges();
    expect(message('orgUnitId')).toBe('تعذّر تحميل القائمة. إعادة المحاولة');
  });
});
