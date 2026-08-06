// ACC-26 — proves the two real defects found via live Playwright
// reproduction: (1) role assignment must POST a plain role-id string, not
// the whole option object the p-select was previously binding to (missing
// optionValue="id"), and (2) an array-shaped validation error message must
// never reach the error signal as anything but a string — that's what
// rendered as "[object Object]" before the fix.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import { UserRoleAssignmentComponent } from './user-role-assignment.component';
import { RoleDto } from '../../services/role.service';

const ROLE_A: RoleDto = {
  id: 'role-a',
  organizationId: 'org-1',
  key: 'QUALITY_OFFICER',
  nameEn: 'Quality Officer',
  nameAr: 'مسؤول الجودة',
  description: null,
  isSystem: true,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('UserRoleAssignmentComponent (ACC-26)', () => {
  let fixture: ComponentFixture<UserRoleAssignmentComponent>;
  let component: UserRoleAssignmentComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UserRoleAssignmentComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        ConfirmationService,
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UserRoleAssignmentComponent);
    component = fixture.componentInstance;
    // setInput() (not a direct property assignment) is required to trigger
    // ngOnChanges() for a classic @Input() decorator in a test harness.
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/users/user-1/roles`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/roles`).flush([ROLE_A]);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('sends the role id as a plain string, not the selected option object', () => {
    // Simulates the p-select's post-fix binding (optionValue="id") — before
    // the fix, selectedRoleId held the whole RoleDto object at runtime.
    component.selectedRoleId = ROLE_A.id;

    component.onAssign();

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/roles`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ roleId: 'role-a' });
    expect(typeof req.request.body.roleId).toBe('string');
    req.flush(null, { status: 204, statusText: 'No Content' });

    httpMock.expectOne(`${environment.apiUrl}/users/user-1/roles`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/roles`).flush([ROLE_A]);
  });

  it('extracts a readable string from an array-shaped 400 response instead of storing the raw array', () => {
    component.selectedRoleId = ROLE_A.id;

    component.onAssign();

    const req = httpMock.expectOne(`${environment.apiUrl}/users/user-1/roles`);
    req.flush(
      { message: ['roleId must be a string'], error: 'Bad Request', statusCode: 400 },
      { status: 400, statusText: 'Bad Request' },
    );

    expect(component.error()).toBe('roleId must be a string');
    expect(typeof component.error()).toBe('string');
  });
});
