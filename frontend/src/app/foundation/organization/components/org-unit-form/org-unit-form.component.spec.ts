import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { LanguageService } from '../../../../core/services/language.service';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import { LookupValueDto } from '../../../lookup/services/lookup.service';
import { FormatService } from '../../../../core/formatting';
import { OrgUnitDto } from '../../services/org-unit.service';
import {
  ORG_UNIT_CODE_MAX,
  ORG_UNIT_CODE_PATTERN,
  ORG_UNIT_DESCRIPTION_MAX,
  OrgUnitFormComponent,
} from './org-unit-form.component';

// ACC-149 — the tests that would have caught the regression.
//
// ACC-137 made typeValueId required on CreateOrgUnitDto. This form had never
// sent a type, and `payload as CreateOrgUnitDto` stopped the compiler noticing,
// so every Add Unit returned 400 while tsc and 1495 tests passed.
//
// The cast is gone, which makes the omission a compile error rather than a
// runtime one — that is the structural guard. These tests cover what a type
// error cannot: that the value the user picked actually reaches the payload,
// that an existing unit's type is loaded for editing, and that the list's own
// failure modes are distinguishable from an empty list.

const VALUES: LookupValueDto[] = [
  {
    id: 'lv-dept',
    organizationId: null,
    categoryId: 'cat',
    key: 'department',
    labelEn: 'Department',
    labelAr: 'قسم',
    layer: 'SYSTEM',
    attributes: null,
    isActive: true,
    isHidden: false,
    labelOverrideEn: null,
    labelOverrideAr: null,
    sortOrder: 10,
    createdAt: '',
    updatedAt: '',
  },
];

function unitRow(id: string, parentId: string | null, nameEn: string, extra: Partial<OrgUnitDto> = {}): OrgUnitDto {
  return {
    id,
    nameEn,
    nameAr: null,
    code: id.toUpperCase().slice(0, 10),
    parentId,
    typeValueId: 'lv-dept',
    typeValue: null,
    description: null,
    isActive: true,
    isCodeLocked: false,
    sortOrder: 0,
    ...extra,
  } as unknown as OrgUnitDto;
}

// Hospital > Medical > Pharmacy > Inpatient > Night shift; Medical > Radiology.
const UNITS: OrgUnitDto[] = [
  unitRow('root', null, 'Hospital'),
  unitRow('med', 'root', 'Medical'),
  unitRow('pharm', 'med', 'Pharmacy'),
  unitRow('ip', 'pharm', 'Inpatient'),
  unitRow('night', 'ip', 'Night shift'),
  unitRow('rad', 'med', 'Radiology'),
];

function setup(
  options: { arabic?: boolean; unit?: OrgUnitDto | null; parentId?: string | null; units?: OrgUnitDto[] } = {},
) {
  TestBed.configureTestingModule({
    imports: [OrgUnitFormComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService({ lang: 'en' }),
      {
        provide: LanguageService,
        useValue: {
          isArabic: () => options.arabic ?? false,
          // ACC-160 — the real rule, under this mock's own language flag.
          bilingual: (en: string, ar: string | null | undefined) =>
            pickBilingualName(en, ar, options.arabic ?? false),
        },
      },
      {
        provide: FormatService,
        useValue: {
          count: (key: string, n: number, params: Record<string, unknown> = {}) => `${key}|${n}|${params['unit']}`,
        },
      },
    ],
  });
  TestBed.inject(TranslateService).setTranslation('en', {
    organization: {
      typeRetired: 'retired',
      parentUnavailableSelf: 'this is the unit you are editing',
      parentUnavailableDescendant: 'one of its own sub-units',
      parentHintEdit: 'Sub-units cannot be chosen.',
      movesAlone: 'Moves {{unit}}',
      refusal: { parentCycle: 'Not under itself.' },
      saveFailed: 'Could not save.',
    },
  });

  const fixture = TestBed.createComponent(OrgUnitFormComponent);
  if (options.unit) fixture.componentRef.setInput('unit', options.unit);
  if (options.parentId) fixture.componentRef.setInput('parentId', options.parentId);
  // What the host's footer and dirty guard receive (ACC-120 slice 11).
  const outputs = { ready: [] as OrgUnitFormComponent[], dirty: [] as boolean[] };
  fixture.componentInstance.ready.subscribe((form) => outputs.ready.push(form));
  fixture.componentInstance.dirtyChange.subscribe((dirty) => outputs.dirty.push(dirty));
  fixture.detectChanges();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(`${environment.apiUrl}/organization/units/flat`).flush(options.units ?? UNITS);
  return { fixture, component: fixture.componentInstance, http, outputs };
}

function flushTypes(http: HttpTestingController, values: LookupValueDto[]): void {
  http.expectOne(`${environment.apiUrl}/lookups/categories/org_unit_type/values`).flush(values);
}

describe('OrgUnitFormComponent — the unit type (ACC-149)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('sends typeValueId in the create payload — the regression itself', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);

    component.form.patchValue({
      nameEn: 'Cardiology',
      code: 'CARD',
      parentId: 'med',
      typeValueId: 'lv-dept',
    });
    component.onSubmit();

    const req = http.expectOne(`${environment.apiUrl}/organization/units`);
    expect(req.request.method).toBe('POST');
    // The exact assertion whose absence let a 400 ship.
    expect(req.request.body.typeValueId).toBe('lv-dept');
    req.flush({});
  });

  it('will not submit without a type', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);

    component.form.patchValue({ nameEn: 'Cardiology', code: 'CARD', parentId: 'med' });

    expect(component.form.valid).toBeFalse();
    component.onSubmit();
    http.expectNone(`${environment.apiUrl}/organization/units`);
  });

  it('loads an existing unit type for editing, so it can be changed at all', () => {
    // Without this the type could only ever be set once, by whatever created
    // the unit — which is why the 40 units that have types have them only
    // because a backfill put them there.
    const unit = {
      id: 'u1',
      nameEn: 'Cardiology',
      nameAr: null,
      code: 'CARD',
      parentId: 'med',
      type: 'department',
      typeValueId: 'lv-dept',
      typeValue: { id: 'lv-dept', key: 'department', labelEn: 'Department', labelAr: 'قسم', isRetired: false },
      description: null,
      isActive: true,
      isCodeLocked: false,
      sortOrder: 0,
    } as unknown as OrgUnitDto;

    const { component, http } = setup({ unit });
    flushTypes(http, VALUES);

    expect(component.form.getRawValue().typeValueId).toBe('lv-dept');
  });

  it('keeps a RETIRED value the unit holds, marked, though it is not offered anew', () => {
    // ACC-137's contract applied to a picker: getValues() drops hidden and
    // inactive values, so without this the form would silently show a different
    // type from the one saved — and saving would change it.
    const unit = {
      id: 'u1',
      nameEn: 'Old Ward',
      code: 'OW',
      typeValueId: 'lv-ward',
      typeValue: { id: 'lv-ward', key: 'ward', labelEn: 'Ward', labelAr: 'جناح', isRetired: true },
      isActive: true,
      sortOrder: 0,
    } as unknown as OrgUnitDto;

    const { component, http } = setup({ unit });
    flushTypes(http, VALUES); // the retired value is NOT in the selectable list

    const held = component.typeOptions().find((o) => o.value === 'lv-ward');
    expect(held).toBeDefined();
    expect(held!.label).toContain('retired');
  });

  it('resolves a tenant labelOverride rather than the seeded label', () => {
    const { component, http } = setup();
    flushTypes(http, [{ ...VALUES[0], labelOverrideEn: 'Clinical Department' }]);

    expect(component.typeOptions()[0].label).toBe('Clinical Department');
  });

  // ── organization is never offered (ACC-141) ─────────────────────────────────

  const ORG_VALUE = {
    ...VALUES[0],
    id: 'lv-org',
    key: 'organization',
    labelEn: 'Organization',
    labelAr: 'منشأة',
    sortOrder: 5,
  };

  it('excludes organization from the SELECTION list, unconditionally', () => {
    // Reserved for the root unit, which the system types at bootstrap and which
    // has no edit path — so no picker exists for it and there is no "is this the
    // root" question to ask. One filter, permanently.
    const { component, http } = setup();
    flushTypes(http, [ORG_VALUE, ...VALUES]);

    expect(component.typeOptions().map((o) => o.value)).not.toContain('lv-org');
    expect(component.typeOptions().map((o) => o.value)).toContain('lv-dept');
  });

  it('still shows organization on the ROOT, which holds it — selection and display differ', () => {
    // The test that stops someone later "fixing" a blank root by putting the
    // value back in the picker. Excluding it from SELECTION must not remove it
    // from DISPLAY: the root holds it, and a unit that renders no type reads as
    // missing data.
    const root = {
      id: 'root-1',
      nameEn: 'Al Nakheel Specialist Hospital',
      code: 'NAKHEEL',
      parentId: null,
      typeValueId: 'lv-org',
      typeValue: { id: 'lv-org', key: 'organization', labelEn: 'Organization', labelAr: 'منشأة', isRetired: false },
      isActive: true,
      sortOrder: 0,
    } as unknown as OrgUnitDto;

    const { component, http } = setup({ unit: root });
    flushTypes(http, [ORG_VALUE, ...VALUES]);

    // Excluded from what can be CHOSEN — and NOT re-added as "retired" either,
    // which is what the first version of this did: the filter removed it, the
    // retired-value re-add noticed the root's own value was missing, and put it
    // back labelled retired. Wrong twice over.
    expect(component.typeOptions().map((o) => o.value)).not.toContain('lv-org');

    // The root gets read-only text instead of a picker, because rule 2 says its
    // type has no edit path at all.
    expect(component.isRootUnit()).toBeTrue();
    expect(component.rootTypeLabel()).toBe('Organization');

    // Its saved value is still carried, so opening the form and saving cannot
    // silently retype the organisation, and `required` cannot block the save on
    // a field the user may not touch.
    expect(component.form.getRawValue().typeValueId).toBe('lv-org');
    expect(component.form.get('typeValueId')?.disabled).toBeTrue();
    expect(component.form.valid).toBeTrue();
  });

  // ── the list's own outcomes (gate 6) ────────────────────────────────────────

  it('reports loading, then clears it', () => {
    const { component, http } = setup();
    expect(component.typesLoading()).toBeTrue();

    flushTypes(http, VALUES);
    expect(component.typesLoading()).toBeFalse();
    expect(component.typesError()).toBeNull();
  });

  it('distinguishes a FAILED list from an empty one, and retries only the list', () => {
    // An empty picker and a broken picker look identical to a user, and only
    // one of them is worth retrying.
    const { component, http } = setup();
    http
      .expectOne(`${environment.apiUrl}/lookups/categories/org_unit_type/values`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(component.typesError()).toBeTruthy();
    expect(component.typeOptions().length).toBe(0);

    component.form.patchValue({ nameEn: 'Typed already' });
    component.retryTypes();
    flushTypes(http, VALUES);

    expect(component.typesError()).toBeNull();
    expect(component.typeOptions().length).toBe(1);
    // The retry re-requests the list and nothing else: a half-filled form must
    // survive a failed side request.
    expect(component.form.getRawValue().nameEn).toBe('Typed already');
  });

  it('an empty list is empty, not an error', () => {
    const { component, http } = setup();
    flushTypes(http, []);

    expect(component.typesError()).toBeNull();
    expect(component.typeOptions().length).toBe(0);
  });
});

describe('OrgUnitFormComponent — the code rule (ACC-120 slice 11)', () => {
  it("copies the server's code rule exactly (create-org-unit.dto.ts: @MaxLength(10), /^[A-Z0-9-]+$/)", () => {
    // If the DTO changes, this changes with it, never one without the other.
    expect(ORG_UNIT_CODE_PATTERN.source).toBe('^[A-Z0-9-]+$');
    expect(ORG_UNIT_CODE_PATTERN.flags).toBe('');
    expect(ORG_UNIT_CODE_MAX).toBe(10);
    expect(ORG_UNIT_DESCRIPTION_MAX).toBe(1000);
  });
});

describe('OrgUnitFormComponent — the Add / Edit unit dialog (ACC-120 slice 11)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  const PHARMACY = UNITS.find((u) => u.id === 'pharm')!;
  const RADIOLOGY = UNITS.find((u) => u.id === 'rad')!;

  interface FlatOption {
    value: string;
    unavailable?: boolean;
    unavailableReason?: string;
    items?: FlatOption[];
  }
  function flatten(nodes: FlatOption[], out: FlatOption[] = []): FlatOption[] {
    for (const n of nodes) {
      out.push(n);
      flatten(n.items ?? [], out);
    }
    return out;
  }

  // ── the code rule: the server's, character for character ────────────────

  it('refuses an underscore, which the server refuses too', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);
    component.form.controls.code.setValue('PHARM_IP');
    expect(component.form.controls.code.hasError('pattern')).toBeTrue();
  });

  it('refuses 11 characters; the input takes the 11th so the rule can say why', () => {
    const { fixture, component, http } = setup();
    flushTypes(http, VALUES);
    component.form.controls.code.setValue('ABCDEFGHIJK');
    expect(component.form.controls.code.hasError('maxlength')).toBeTrue();
    // No native maxlength: it would drop the 11th character without a word.
    const input = fixture.nativeElement.querySelector('#org-unit-code') as HTMLInputElement;
    expect(input.hasAttribute('maxlength')).toBeFalse();
  });

  it('accepts capitals, digits and hyphens up to 10', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);
    component.form.controls.code.setValue('PHARM-IP-2');
    expect(component.form.controls.code.valid).toBeTrue();
  });

  it('uppercases as you type, and the counter follows', () => {
    const { fixture, component, http } = setup();
    flushTypes(http, VALUES);
    const input = fixture.nativeElement.querySelector('#org-unit-code') as HTMLInputElement;
    input.value = 'pharm-ip';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expect(input.value).toBe('PHARM-IP');
    expect(component.form.controls.code.value).toBe('PHARM-IP');
    expect(component.codeLength()).toBe(8);
    const counter = fixture.nativeElement.querySelector('[data-testid="field-counter"]') as HTMLElement;
    expect(counter.textContent?.trim()).toBe('8 / 10');
  });

  it('fills the code from the English name with no underscore, at most 10, until the code is typed', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);
    component.form.controls.nameEn.setValue('Night_Shift Pharmacy Team');
    component.onNameEnInput();
    expect(component.form.controls.code.value).toBe('NIGHTSHIFT');
    expect(component.form.controls.code.valid).toBeTrue();
  });

  // ── description ──────────────────────────────────────────────────────────

  it('counts the description against 1000, amber from 900', () => {
    const { fixture, component, http } = setup();
    flushTypes(http, VALUES);
    const description = () => {
      const all = Array.from(fixture.nativeElement.querySelectorAll('[data-testid="field-counter"]')) as HTMLElement[];
      return all[all.length - 1];
    };
    component.form.controls.description.setValue('x'.repeat(899));
    fixture.detectChanges();
    expect(description().textContent?.trim()).toBe('899 / 1000');
    expect(description().classList).not.toContain('am-field__counter--warn');
    component.form.controls.description.setValue('x'.repeat(900));
    fixture.detectChanges();
    expect(description().classList).toContain('am-field__counter--warn');
    component.form.controls.description.setValue('x'.repeat(1001));
    expect(component.form.controls.description.hasError('maxlength')).toBeTrue();
  });

  // ── sortOrder is gone ─────────────────────────────────────────────────────

  it('has no Sort Order field and sends no sortOrder, on create or update', () => {
    const { fixture, component, http } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    expect(fixture.nativeElement.textContent).not.toContain('Sort Order');
    expect(fixture.nativeElement.querySelector('p-inputnumber')).toBeNull();
    expect('sortOrder' in component.form.controls).toBeFalse();
    component.onSubmit();
    const req = http.expectOne(`${environment.apiUrl}/organization/units/pharm`);
    expect('sortOrder' in req.request.body).toBeFalse();
    req.flush({});
  });

  // ── the parent ───────────────────────────────────────────────────────────

  it('the parent field says it is loading until the units arrive', () => {
    TestBed.configureTestingModule({
      imports: [OrgUnitFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        { provide: LanguageService, useValue: { isArabic: () => false, bilingual: (en: string, ar: string | null) => pickBilingualName(en, ar, false) } },
        { provide: FormatService, useValue: { count: () => '' } },
      ],
    });
    const fixture = TestBed.createComponent(OrgUnitFormComponent);
    fixture.componentRef.setInput('unit', PHARMACY);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    const parentField = () =>
      (fixture.nativeElement as HTMLElement).querySelector('app-overlay-select[formcontrolname="parentId"]')!.closest('am-field')!;
    expect(fixture.componentInstance.unitsLoading()).toBeTrue();
    expect(parentField().querySelector('.am-field__spinner')).not.toBeNull();
    http.expectOne(`${environment.apiUrl}/organization/units/flat`).flush(UNITS);
    flushTypes(http, VALUES);
    fixture.detectChanges();
    expect(fixture.componentInstance.unitsLoading()).toBeFalse();
    expect(parentField().querySelector('.am-field__spinner')).toBeNull();
  });

  it('Add unit: the parent is required, none chosen yet', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);
    expect(component.form.controls.parentId.value).toBeNull();
    expect(component.form.controls.parentId.hasError('required')).toBeTrue();
  });

  it('Add sub-unit: the parent is prefilled, and still changeable', () => {
    const { component, http } = setup({ parentId: 'pharm' });
    flushTypes(http, VALUES);
    expect(component.form.controls.parentId.value).toBe('pharm');
    expect(component.form.controls.parentId.enabled).toBeTrue();
  });

  it('Edit: the unit and every unit below it are listed but unavailable, each with its reason', () => {
    const { component, http } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    const options = flatten(component.parentOptions() as FlatOption[]);
    const by = (id: string) => options.find((n) => n.value === id)!;
    expect(by('pharm').unavailable).toBeTrue();
    expect(by('pharm').unavailableReason).toBe('this is the unit you are editing');
    expect(by('ip').unavailable).toBeTrue();
    expect(by('ip').unavailableReason).toBe('one of its own sub-units');
    expect(by('night').unavailable).toBeTrue();
    expect(by('night').unavailableReason).toBe('one of its own sub-units');
    expect(by('rad').unavailable).toBeUndefined();
    expect(by('med').unavailable).toBeUndefined();
    expect(by('root').unavailable).toBeUndefined();
  });

  it('Add: nothing is unavailable, since nothing is moving', () => {
    const { component, http } = setup({ parentId: 'pharm' });
    flushTypes(http, VALUES);
    expect(flatten(component.parentOptions() as FlatOption[]).some((n) => n.unavailable)).toBeFalse();
  });

  it('Edit: no "Moves" line until the parent changes; then it counts every unit below', () => {
    const { component, http } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    expect(component.parentHint()).toBe('Sub-units cannot be chosen.');
    component.form.controls.parentId.setValue('rad');
    // Pharmacy has Inpatient, and Inpatient has Night shift: two go with it.
    expect(component.parentHint()).toBe('orgUnit.movesWith|2|Pharmacy');
    component.form.controls.parentId.setValue('med');
    expect(component.parentHint()).toBe('Sub-units cannot be chosen.');
  });

  it('Edit: a unit with nothing below it says "Moves {unit}"', () => {
    const { component, http } = setup({ unit: RADIOLOGY });
    flushTypes(http, VALUES);
    component.form.controls.parentId.setValue('pharm');
    expect(component.parentHint()).toBe('Moves Radiology');
  });

  it('Add: never a "Moves" line', () => {
    const { component, http } = setup({ parentId: 'pharm' });
    flushTypes(http, VALUES);
    component.form.controls.parentId.setValue('rad');
    expect(component.parentHint()).toBe('');
  });

  it("the server's cycle refusal is said from its code, in the reader's language", () => {
    const { component, http } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    component.form.controls.parentId.setValue('rad');
    component.onSubmit();
    http
      .expectOne(`${environment.apiUrl}/organization/units/pharm`)
      .flush(
        { statusCode: 409, message: 'English text', error: 'Conflict', code: 'ORG_UNIT_PARENT_CYCLE' },
        { status: 409, statusText: 'Conflict' },
      );
    expect(component.saveError()).toBe('Not under itself.');
    expect(component.saving()).toBeFalse();
  });

  // ── the host's footer drives the form ────────────────────────────────────

  it('Add unit names its primary action "Add unit"', () => {
    const { component, http } = setup();
    flushTypes(http, VALUES);
    expect(component.submitLabelKey()).toBe('organization.addUnit');
  });

  it('Add sub-unit names its primary action "Add sub-unit"', () => {
    const { component, http } = setup({ parentId: 'pharm' });
    flushTypes(http, VALUES);
    expect(component.submitLabelKey()).toBe('organization.addSubUnit');
  });

  it('Edit names its primary action "Save"', () => {
    const { component, http } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    expect(component.submitLabelKey()).toBe('common.save');
  });

  it('hands the host itself once, and is not dirty until something changes', () => {
    const { component, http, outputs } = setup({ unit: PHARMACY });
    flushTypes(http, VALUES);
    expect(outputs.ready).toEqual([component]);
    expect(outputs.dirty).toEqual([]);
    component.form.controls.nameEn.markAsDirty();
    component.form.controls.nameEn.setValue('Pharmacy Services');
    expect(outputs.dirty[outputs.dirty.length - 1]).toBeTrue();
  });

  it('a Save on an invalid form shows what is missing and sends nothing', () => {
    const { fixture, component, http } = setup();
    flushTypes(http, VALUES);
    component.onSubmit();
    fixture.detectChanges();
    expect(component.showErrors()).toBeTrue();
    expect(fixture.nativeElement.querySelectorAll('[aria-invalid="true"]').length).toBeGreaterThan(0);
    http.expectNone(`${environment.apiUrl}/organization/units`);
  });

  it('the root: the parent is read-only text, and a save keeps it unchanged', () => {
    const root = { ...UNITS[0], typeValueId: 'lv-org' } as OrgUnitDto;
    const { fixture, component, http } = setup({ unit: root });
    flushTypes(http, VALUES);
    expect(component.form.controls.parentId.disabled).toBeTrue();
    expect(fixture.nativeElement.querySelector('app-overlay-select[formcontrolname="parentId"]')).toBeNull();
    component.onSubmit();
    const req = http.expectOne(`${environment.apiUrl}/organization/units/root`);
    expect(req.request.body.parentId).toBeUndefined();
    expect(req.request.body.typeValueId).toBe('lv-org');
    req.flush({});
  });
});

// CC-125a — on a phone the Code helper is read, not drawn, so the rule must show
// as the error the moment a refused character is typed (not only on Save).
describe('OrgUnitFormComponent — the code rule on a phone (ACC-120 slice 11)', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  function onPhone(phone: boolean) {
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((q: string) =>
      q.startsWith('(max-width: 767.98')
        ? ({ matches: phone, media: q, addEventListener: () => undefined, removeEventListener: () => undefined } as unknown as MediaQueryList)
        : real(q),
    );
    TestBed.resetTestingModule();
    const ctx = setup();
    flushTypes(ctx.http, VALUES);
    ctx.fixture.detectChanges();
    const el = ctx.fixture.nativeElement as HTMLElement;
    const input = el.querySelector('#org-unit-code') as HTMLInputElement;
    const field = input.closest('am-field') as HTMLElement;
    const type = (value: string) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      ctx.fixture.detectChanges();
    };
    const message = () => field.querySelector('.am-field__message') as HTMLElement;
    const text = () => field.querySelector('.am-field__message-text') as HTMLElement;
    return { ...ctx, input, field, type, message, text };
  }

  function codeTranslations(): void {
    TestBed.inject(TranslateService).setTranslation(
      'en',
      {
        organization: {
          codeHint: 'Up to 10 · capitals, numbers, hyphens',
          codePatternError: 'Only A–Z, 0–9 and -',
          codeTooLong: 'Up to 10 characters',
        },
      },
      true,
    );
  }

  it('at 390 the helper is visually hidden, still in aria-describedby, and the counter stays', () => {
    const { component, fixture, input, field, text } = onPhone(true);
    codeTranslations();
    fixture.detectChanges();
    expect(component.phone()).toBeTrue();
    expect(text().classList).toContain('sr-only');
    expect(text().textContent?.trim()).toBe('Up to 10 · capitals, numbers, hyphens');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described).toContain((field.querySelector('.am-field__message') as HTMLElement).id);
    expect(field.querySelector('[data-testid="field-counter"]')).not.toBeNull();
  });

  it('at 390 an underscore shows the rule as the error at once, drawn, without leaving the field', () => {
    const { fixture, type, message, text } = onPhone(true);
    codeTranslations();
    type('PHARM_');
    expect(message().classList).toContain('am-field__message--error');
    expect(message().getAttribute('role')).toBe('alert');
    expect(text().textContent?.trim()).toBe('Only A–Z, 0–9 and -');
    expect(text().classList).not.toContain('sr-only');
    // Corrected, the error goes and the helper is hidden again.
    type('PHARM-');
    fixture.detectChanges();
    expect(message().classList).not.toContain('am-field__message--error');
    expect(text().classList).toContain('sr-only');
  });

  it('at 390 an 11th character shows the limit as the error at once', () => {
    const { input, type, message, text } = onPhone(true);
    codeTranslations();
    type('ABCDEFGHIJK');
    expect(input.value).toBe('ABCDEFGHIJK');
    expect(message().classList).toContain('am-field__message--error');
    expect(text().textContent?.trim()).toBe('Up to 10 characters');
  });

  it('on a desktop the helper is drawn', () => {
    const { component, fixture, text } = onPhone(false);
    codeTranslations();
    fixture.detectChanges();
    expect(component.phone()).toBeFalse();
    expect(text().classList).not.toContain('sr-only');
  });
});
