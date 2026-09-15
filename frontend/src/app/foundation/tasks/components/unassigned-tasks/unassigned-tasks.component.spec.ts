// ACC-34 item 4 — proves the two real behaviors this view exists for:
// (1) it fetches and renders GET /tasks/unassigned (a list no other task
// view can ever show, since unassigned tasks have no assignees), and
// (2) the inline reassign form calls POST /tasks/:id/reassign with the
// exact ReassignTaskDto shape and refreshes the list on success.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { UnassignedTasksComponent } from './unassigned-tasks.component';
import { ITaskDto } from '../../services/task.service';
import { IUserDto } from '../../../user/services/user.service';

const UNASSIGNED_TASK: ITaskDto = {
  id: 'task-1',
  organizationId: 'org-a',
  title: 'Review incident report',
  description: null,
  sourceType: 'DOCUMENT',
  sourceId: 'doc-1',
  sourceStageId: null,
  workflowInstanceId: null,
  meetingId: null,
  createdById: 'creator-1',
  status: 'UNASSIGNED',
  priority: 'MEDIUM',
  dueAt: null,
  dueDateOverridden: false,
  slaBreachedAt: null,
  completedAt: null,
  completedById: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const USER_A: IUserDto = {
  id: 'user-a',
  organizationId: 'org-a',
  email: 'a@example.com',
  name: 'User A',
  avatarUrl: null,
  status: 'ACTIVE',
  language: null,
  positionId: null,
  primaryOrgUnitId: null,
  managerId: null,
  outOfOfficeFrom: null,
  outOfOfficeTo: null,
  actingUserId: null,
  actingOrgUnitId: null,
  actingOrgUnitUntil: null,
  lastLoginAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('UnassignedTasksComponent (ACC-34)', () => {
  let fixture: ComponentFixture<UnassignedTasksComponent>;
  let component: UnassignedTasksComponent;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [UnassignedTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideRouter([]),
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(UnassignedTasksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/tasks/unassigned`).flush([UNASSIGNED_TASK]);
    // ACC-78 — listAllUsers() asks for the backend's page-size cap, and the
    // endpoint returns the shared envelope rather than a bare array.
    httpMock
      .expectOne(`${environment.apiUrl}/users?status=ACTIVE&pageSize=200`)
      .flush({ data: [USER_A], total: 1, page: 1, pageSize: 200 });
    httpMock.expectOne(`${environment.apiUrl}/organization/units/flat`).flush([]);
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  it('renders the fetched unassigned tasks', () => {
    expect(component.tasks()).toEqual([UNASSIGNED_TASK]);
  });

  it('reassign sends the exact ReassignTaskDto shape and refreshes the list on success', () => {
    component.onOpenReassign(UNASSIGNED_TASK);
    component.reassignForm.setValue({ newAssigneeUserIds: [USER_A.id], reason: 'Covering for absence' });

    component.onSubmitReassign();

    const req = httpMock.expectOne(`${environment.apiUrl}/tasks/task-1/reassign`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      newAssigneeUserIds: [USER_A.id],
      reason: 'Covering for absence',
    });
    req.flush({ ...UNASSIGNED_TASK, status: 'PENDING' });

    // Reassign success triggers a refresh of the unassigned list.
    httpMock.expectOne(`${environment.apiUrl}/tasks/unassigned`).flush([]);

    expect(component.reassignVisible()).toBe(false);
    expect(component.tasks()).toEqual([]);
  });

  it('does not submit when the reassign form is invalid (no assignees, no reason)', () => {
    component.onOpenReassign(UNASSIGNED_TASK);

    component.onSubmitReassign();

    expect(component.reassignForm.invalid).toBe(true);
    httpMock.expectNone(`${environment.apiUrl}/tasks/task-1/reassign`);
  });
});

// ACC-82 — the receiving end of a Setup health Fix link.
describe('UnassignedTasksComponent — Setup health Fix link (ACC-82)', () => {
  let httpMock: HttpTestingController;
  let navigate: jasmine.Spy;

  const open = (queryParams: Record<string, string>, tasks: ITaskDto[]): UnassignedTasksComponent => {
    TestBed.configureTestingModule({
      imports: [UnassignedTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } } },
      ],
    });
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    httpMock = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(UnassignedTasksComponent);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/tasks/unassigned`).flush(tasks);
    httpMock.match(() => true).forEach((r) => r.flush(r.request.url.includes('/users') ? { data: [], total: 0, page: 1, pageSize: 200 } : []));
    return fixture.componentInstance;
  };

  afterEach(() => httpMock.verify());

  it('opens the named task’s reassign dialog, and removes the parameter so it does not reopen', () => {
    const component = open({ reassign: 'task-1' }, [UNASSIGNED_TASK]);

    expect(component.reassignVisible()).toBe(true);
    expect(navigate).toHaveBeenCalledOnceWith(
      [],
      jasmine.objectContaining({ queryParams: { reassign: null }, replaceUrl: true }),
    );

    // A refresh after the reassign must not open it a second time.
    component.reassignVisible.set(false);
    component.loadTasks();
    httpMock.expectOne(`${environment.apiUrl}/tasks/unassigned`).flush([UNASSIGNED_TASK]);
    expect(component.reassignVisible()).toBe(false);
  });

  it('opens nothing when the task is no longer unassigned', () => {
    const component = open({ reassign: 'task-already-assigned' }, [UNASSIGNED_TASK]);
    expect(component.reassignVisible()).toBe(false);
  });

  it('opens nothing without the parameter', () => {
    const component = open({}, [UNASSIGNED_TASK]);
    expect(component.reassignVisible()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
