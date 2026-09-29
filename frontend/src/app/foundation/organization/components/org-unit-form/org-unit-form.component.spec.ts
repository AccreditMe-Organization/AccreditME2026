import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { LanguageService } from '../../../../core/services/language.service';
import { LookupValueDto } from '../../../lookup/services/lookup.service';
import { OrgUnitDto } from '../../services/org-unit.service';
import { OrgUnitFormComponent } from './org-unit-form.component';

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

const UNITS: OrgUnitDto[] = [];

function setup(options: { arabic?: boolean; unit?: OrgUnitDto | null } = {}) {
  TestBed.configureTestingModule({
    imports: [OrgUnitFormComponent],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideTranslateService({ lang: 'en' }),
      { provide: LanguageService, useValue: { isArabic: () => options.arabic ?? false } },
    ],
  });
  TestBed.inject(TranslateService).setTranslation('en', {
    organization: { typeRetired: 'retired' },
  });

  const fixture = TestBed.createComponent(OrgUnitFormComponent);
  if (options.unit) fixture.componentRef.setInput('unit', options.unit);
  fixture.detectChanges();

  const http = TestBed.inject(HttpTestingController);
  http.expectOne(`${environment.apiUrl}/organization/units/flat`).flush(UNITS);
  return { fixture, component: fixture.componentInstance, http };
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
      typeValueId: 'lv-dept',
      sortOrder: 0,
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

    component.form.patchValue({ nameEn: 'Cardiology', code: 'CARD', sortOrder: 0 });

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
      parentId: null,
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
