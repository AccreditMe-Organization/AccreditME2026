// ACC-43 — invite-user.component.ts's positionId picker was previously
// unfiltered: a deactivated position (isActive: false) still appeared,
// indistinguishable from an active one, in listPositions()'s raw result.
// assignablePositions() is the fix — same client-side isActive-filter
// convention already used for role pickers (user-role-assignment.
// component.ts, position-form.component.ts's own assignableRoles getter).
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Validators } from '@angular/forms';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { InviteUserComponent } from './invite-user.component';
import { IOrgPositionDto } from '../../../org-position/services/org-position.service';

const ACTIVE_POSITION: IOrgPositionDto = {
  id: 'pos-active',
  organizationId: 'org-1',
  nameEn: 'Specialist',
  nameAr: null,
  grade: 5,
  isSingleAssignee: false,
  isUnitHeadPosition: false,
  roleId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const INACTIVE_POSITION: IOrgPositionDto = {
  ...ACTIVE_POSITION,
  id: 'pos-inactive',
  nameEn: 'Deactivated Position',
  isActive: false,
};

describe('InviteUserComponent (ACC-43)', () => {
  let fixture: ComponentFixture<InviteUserComponent>;
  let component: InviteUserComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InviteUserComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteUserComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/org-positions`).flush([ACTIVE_POSITION, INACTIVE_POSITION]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/flat`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/users?status=ACTIVE`).flush([]);
  });

  afterEach(() => httpMock.verify());

  it('excludes inactive positions from the assignable picker, while keeping the raw list intact', () => {
    expect(component.positions()).toEqual([ACTIVE_POSITION, INACTIVE_POSITION]);
    expect(component.assignablePositions()).toEqual([ACTIVE_POSITION]);
  });
});

// ACC-46 Section 2.3 — mandatory manager, org-unit-scoped picker,
// auto-default to the selected unit's current Head.
describe('InviteUserComponent (ACC-46 Section 2.3)', () => {
  let fixture: ComponentFixture<InviteUserComponent>;
  let component: InviteUserComponent;
  let httpMock: HttpTestingController;

  const ROOT_UNIT = { id: 'unit-root', organizationId: 'org-1', parentId: null, nameEn: 'Root', nameAr: null, code: 'ROOT', type: null, description: null, isActive: true, isCodeLocked: false, sortOrder: 0, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const NON_ROOT_UNIT = { ...ROOT_UNIT, id: 'unit-1', parentId: 'unit-root' };
  const HEAD_POSITION: IOrgPositionDto = { ...ACTIVE_POSITION, id: 'pos-director', isSingleAssignee: true, isUnitHeadPosition: true };

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [InviteUserComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(InviteUserComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/org-positions`).flush([ACTIVE_POSITION, HEAD_POSITION]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/flat`).flush([ROOT_UNIT, NON_ROOT_UNIT]);
    httpMock.expectOne(`${environment.apiUrl}/users?status=ACTIVE`).flush([]);
  });

  afterEach(() => httpMock.verify());

  it('re-fetches managers scoped to the selected org unit, and auto-defaults managerId to its current Head — still editable', () => {
    component.form.controls.primaryOrgUnitId.setValue('unit-1');

    const managersReq = httpMock.expectOne(
      (req) => req.url === `${environment.apiUrl}/users` && req.params.get('orgUnitId') === 'unit-1',
    );
    managersReq.flush([{ id: 'head-user', name: 'Unit Head', primaryOrgUnitId: 'unit-1' }]);

    const headStatusReq = httpMock.expectOne(`${environment.apiUrl}/organization/units/unit-1/head`);
    headStatusReq.flush({ holders: [{ id: 'head-user', name: 'Unit Head', positionId: 'pos-director' }], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null });

    expect(component.form.controls.managerId.value).toBe('head-user');
    expect(component.form.controls.managerId.disabled).toBe(false);
  });

  it('does not auto-default managerId when the selected unit has no current Head', () => {
    component.form.controls.primaryOrgUnitId.setValue('unit-1');

    httpMock.expectOne((req) => req.url === `${environment.apiUrl}/users` && req.params.get('orgUnitId') === 'unit-1').flush([]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/unit-1/head`).flush({ holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null });

    expect(component.form.controls.managerId.value).toBeNull();
  });

  it('requires managerId for an ordinary invite by default', () => {
    component.form.patchValue({ name: 'A', email: 'a@example.com', positionId: 'pos-active', primaryOrgUnitId: 'unit-1' });
    httpMock.expectOne((req) => req.url === `${environment.apiUrl}/users`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/unit-1/head`).flush({ holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null });

    expect(component.form.controls.managerId.hasValidator(Validators.required)).toBe(true);
    expect(component.isRootUnitHeadInvite()).toBe(false);
  });

  it('exempts managerId only when the invitee is the ROOT unit\'s own Head — narrow, not "anyone in root"', () => {
    component.form.patchValue({ name: 'A', email: 'a@example.com', positionId: 'pos-director', primaryOrgUnitId: 'unit-root' });
    httpMock.expectOne((req) => req.url === `${environment.apiUrl}/users`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/unit-root/head`).flush({ holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null });

    expect(component.isRootUnitHeadInvite()).toBe(true);
    expect(component.form.controls.managerId.hasValidator(Validators.required)).toBe(false);
  });

  it('still requires managerId for an ordinary (non-Head) invite into the root unit', () => {
    component.form.patchValue({ name: 'A', email: 'a@example.com', positionId: 'pos-active', primaryOrgUnitId: 'unit-root' });
    httpMock.expectOne((req) => req.url === `${environment.apiUrl}/users`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/organization/units/unit-root/head`).flush({ holders: [], pendingHeadUserId: null, headHandoverEffectiveDate: null, actingHeadUserId: null });

    expect(component.isRootUnitHeadInvite()).toBe(false);
    expect(component.form.controls.managerId.hasValidator(Validators.required)).toBe(true);
  });
});
