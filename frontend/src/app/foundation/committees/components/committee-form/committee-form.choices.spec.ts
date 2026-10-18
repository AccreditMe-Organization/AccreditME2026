import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, Subject } from 'rxjs';
import { CommitteeFormComponent } from './committee-form.component';
import { CommitteeDetailDto, CommitteeListItemDto, CommitteeService, CommitteeTypeValueDto } from '../../services/committee.service';
import { LookupService, LookupValueDto } from '../../../lookup/services/lookup.service';
import { OrgUnitDto, OrgUnitService } from '../../../organization/services/org-unit.service';
import { LanguageService } from '../../../../core/services/language.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';

// ACC-246 — Edit committee shows the committee's own values the moment it opens.
//
// The type picker used to show its placeholder until the dialog's own
// committee_type list arrived (it loads on opening since ACC-238), and opening
// it meanwhile gave an empty list over a value it did not contain. The
// committee's read now carries its own type's label, so the type shows at once,
// in either language, and a type the organisation no longer offers still shows,
// marked. The other pickers keep their value and read "Loading…" until their
// list arrives. Save sends every value unchanged throughout.

const TYPE: CommitteeTypeValueDto = { id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: 'لجنة الجودة', offered: true };
const typeRow = (over: Partial<LookupValueDto> = {}): LookupValueDto =>
  ({ id: 'type-1', key: 'quality', labelEn: 'Quality Committee', labelAr: 'لجنة الجودة', ...over }) as LookupValueDto;

const DETAIL = (over: Partial<CommitteeDetailDto> = {}): CommitteeDetailDto => ({
  id: 'self',
  organizationId: 'org',
  nameEn: 'Patient Safety Committee',
  nameAr: null,
  typeValueId: 'type-1',
  purpose: null,
  quorumCount: 3,
  meetingFrequency: 'MONTHLY',
  parentCommitteeId: 'parent',
  orgUnitId: 'unit-qps',
  termsOfReferenceDocumentId: null,
  reportingToCommitteeId: 'parent',
  formedAt: null,
  dissolvedAt: null,
  isActive: true,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-18T09:00:00.123Z',
  currentStageKey: 'formation',
  isDissolving: false,
  typeValue: TYPE,
  ...over,
});

const LIST_ROW = (id: string, nameEn: string): CommitteeListItemDto =>
  ({ ...DETAIL({ id, nameEn, parentCommitteeId: null, reportingToCommitteeId: null }), memberCount: 0, currentStageNameEn: null, currentStageNameAr: null }) as CommitteeListItemDto;

const UNITS: OrgUnitDto[] = [
  { id: 'root', nameEn: 'Root', nameAr: null, parentId: null, isActive: true } as OrgUnitDto,
  { id: 'unit-qps', nameEn: 'Quality & Patient Safety', nameAr: null, parentId: 'root', isActive: true } as OrgUnitDto,
];

describe('CommitteeFormComponent — the committee’s own values show at once (ACC-246)', () => {
  let fixture: ComponentFixture<CommitteeFormComponent>;
  let component: CommitteeFormComponent;
  let types: Subject<LookupValueDto[]>;
  let units: Subject<OrgUnitDto[]>;
  let committees: Subject<CommitteeListItemDto[]>;
  let update: jasmine.Spy;
  let consoleErrors: string[];

  function render(committee: CommitteeDetailDto | null): void {
    types = new Subject();
    units = new Subject();
    committees = new Subject();
    update = jasmine.createSpy('update').and.callFake((): Observable<unknown> => of(committee));
    TestBed.configureTestingModule({
      imports: [CommitteeFormComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: CommitteeService, useValue: { listCommittees: () => committees, update, create: update, getById: () => of(committee) } },
        { provide: LookupService, useValue: { getValues: () => types } },
        { provide: OrgUnitService, useValue: { getFlat: () => units } },
      ],
    });
    fixture = TestBed.createComponent(CommitteeFormComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', committee);
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();
  }

  const trigger = (field: string) =>
    document.querySelector(`[data-cf-field="${field}"] .am-overlay-select-trigger`)?.textContent?.trim() ?? '<none>';
  const panelOptions = () =>
    Array.from(document.querySelectorAll('.am-overlay-select-panel [cdkoption]')).map((o) => o.textContent?.trim());
  const sent = () => update.calls.mostRecent().args[1] as Record<string, unknown>;

  /** Every list arrives, in the order the server happens to answer. */
  function arrive(typeRows: LookupValueDto[] = [typeRow()]): void {
    types.next(typeRows);
    units.next(UNITS);
    committees.next([LIST_ROW('parent', 'Quality Council'), LIST_ROW('self', 'Patient Safety Committee')]);
    fixture.detectChanges();
  }

  beforeEach(() => {
    consoleErrors = [];
    const original = console.error;
    spyOn(console, 'error').and.callFake((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(' '));
      original.apply(console, args);
    });
  });

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.cdk-overlay-container').forEach((c) => (c.innerHTML = ''));
  });

  it('the type shows the moment the dialog opens, before its list arrives, and opens on its own option', () => {
    render(DETAIL());

    expect(trigger('typeValueId')).toBe('Quality Committee');
    (document.querySelector('[data-cf-field="typeValueId"] .am-overlay-select-trigger') as HTMLElement).click();
    fixture.detectChanges();
    expect(panelOptions()).toEqual(['Quality Committee']);
    expect(consoleErrors.filter((e) => e.includes('Listbox'))).toEqual([]);
  });

  it('…and in Arabic', () => {
    render(null);
    TestBed.inject(LanguageService).use('ar');
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();
    fixture.componentRef.setInput('committee', DETAIL());
    fixture.componentRef.setInput('visible', true);
    fixture.detectChanges();

    expect(trigger('typeValueId')).toBe('لجنة الجودة');
    TestBed.inject(TranslateService).use('en');
  });

  it('the list arriving changes nothing a person sees, and Save sends every value unchanged', () => {
    render(DETAIL());
    arrive();

    expect(trigger('typeValueId')).toBe('Quality Committee');
    expect(component.committeeTypeOptions().map((o) => o.id)).toEqual(['type-1']);
    component.submit();
    expect(sent()).toEqual(jasmine.objectContaining({ typeValueId: 'type-1', orgUnitId: 'unit-qps', parentCommitteeId: 'parent', reportingToCommitteeId: 'parent' }));
  });

  it('Save pressed before any list has arrived still sends the saved values, none of them cleared', () => {
    render(DETAIL());

    component.submit();

    expect(update).toHaveBeenCalledTimes(1);
    expect(sent()).toEqual(jasmine.objectContaining({ typeValueId: 'type-1', orgUnitId: 'unit-qps', parentCommitteeId: 'parent', reportingToCommitteeId: 'parent' }));
  });

  it('a type the organisation no longer offers shows, marked, and Save keeps it', () => {
    render(DETAIL({ typeValue: { ...TYPE, offered: false } }));
    expect(trigger('typeValueId')).toBe('Quality Committee (committee.form.notOffered)');

    arrive([typeRow({ id: 'type-2', key: 'safety', labelEn: 'Safety Committee', labelAr: null })]);

    expect(trigger('typeValueId')).toBe('Quality Committee (committee.form.notOffered)');
    expect(component.committeeTypeOptions().map((o) => o.id)).toEqual(['type-2', 'type-1']);
    component.submit();
    expect(sent()['typeValueId']).toBe('type-1');
  });

  it('…and is offered to no other committee: Add committee lists only what is offered', () => {
    render(null);
    arrive([typeRow({ id: 'type-2', key: 'safety', labelEn: 'Safety Committee', labelAr: null })]);

    expect(component.committeeTypeOptions().map((o) => o.id)).toEqual(['type-2']);
  });

  it('Owning unit, Parent and Reports to read "Loading…" and cannot open until their lists arrive — never "None" over a saved value', () => {
    render(DETAIL());

    for (const field of ['orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId']) {
      expect(trigger(field)).withContext(field).toBe('common.loading');
      expect(component.form.get(field)!.disabled).withContext(field).toBeTrue();
    }
    expect(component.form.getRawValue()).toEqual(jasmine.objectContaining({ orgUnitId: 'unit-qps', parentCommitteeId: 'parent', reportingToCommitteeId: 'parent' }));

    arrive();

    expect(trigger('orgUnitId')).toBe('Quality & Patient Safety');
    expect(trigger('parentCommitteeId')).toBe('Quality Council');
    expect(trigger('reportingToCommitteeId')).toBe('Quality Council');
    for (const field of ['orgUnitId', 'parentCommitteeId', 'reportingToCommitteeId']) {
      expect(component.form.get(field)!.enabled).withContext(field).toBeTrue();
    }
  });

  it('a list that fails releases its picker (an empty list, never "Loading…" for ever)', () => {
    render(DETAIL());
    units.error(new Error('down'));
    fixture.detectChanges();

    expect(component.form.controls.orgUnitId.enabled).toBeTrue();
    expect(trigger('orgUnitId')).toBe('committee.selectOwningUnit');
    expect(component.form.controls.orgUnitId.value).toBe('unit-qps');
  });

  it('an owning unit since deactivated still shows, marked, rather than the placeholder', () => {
    render(DETAIL());
    types.next([typeRow()]);
    units.next([UNITS[0]!, { ...UNITS[1]!, isActive: false }]);
    committees.next([]);
    fixture.detectChanges();

    expect(trigger('orgUnitId')).toBe('Quality & Patient Safety (committee.form.notOffered)');
    component.submit();
    expect(sent()['orgUnitId']).toBe('unit-qps');
  });

  it('Add committee: the type reads "Loading…" until its list arrives, then the placeholder', () => {
    render(null);
    expect(trigger('typeValueId')).toBe('common.loading');
    expect(component.form.controls.typeValueId.disabled).toBeTrue();

    arrive();

    expect(trigger('typeValueId')).toBe('committee.selectType');
    expect(component.form.controls.typeValueId.enabled).toBeTrue();
  });
});
