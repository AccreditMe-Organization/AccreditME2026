// ACC-43 — invite-user.component.ts's positionId picker was previously
// unfiltered: a deactivated position (isActive: false) still appeared,
// indistinguishable from an active one, in listPositions()'s raw result.
// assignablePositions() is the fix — same client-side isActive-filter
// convention already used for role pickers (user-role-assignment.
// component.ts, position-form.component.ts's own assignableRoles getter).
import { TestBed, ComponentFixture } from '@angular/core/testing';
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
