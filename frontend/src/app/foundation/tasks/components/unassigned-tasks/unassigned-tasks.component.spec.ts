// ACC-34 item 4 — proves the two real behaviors this view exists for:
// (1) it fetches and renders GET /tasks/unassigned (a list no other task
// view can ever show, since unassigned tasks have no assignees), and
// (2) reassigning refreshes the list.
//
// ACC-163 — the reassign FORM moved into the shared TaskReassignDialogComponent
// (the committee record hosts it too), so the request shape, validation and
// header are proven in task-reassign-dialog.component.spec.ts. This file
// proves the hosting: the right task reaches the dialog, and a reassignment
// reloads the list.
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ConfirmationService } from 'primeng/api';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { environment } from '../../../../../environments/environment';
import { UnassignedTasksComponent } from './unassigned-tasks.component';
import { ITaskDto } from '../../services/task.service';
import { TaskReassignDialogComponent } from '../task-reassign-dialog/task-reassign-dialog.component';

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
  requiresEvidence: false,
  rejectedReason: null,
  rejectedAt: null,
  rejectedById: null,
  assignedOrgUnitId: null,
  assignedPositionId: null,
  assignedCommitteeId: null,
  assignedCommitteeRoleValueId: null,
  pooledAt: null,
  poolEscalateAt: null,
  poolEscalatedAt: null,
  heldAt: null,
  onHoldUntil: null,
  heldFromStatus: null,
  slaStartAt: null,
  slaLimitAt: null,
  slaExtendedTo: null,
  cancelledReason: null,
  cancelledAt: null,
  cancelledById: null,
  reopenedReason: null,
  reopenedAt: null,
  reopenedById: null,
  managerEscalatedAt: null,
  headEscalatedAt: null,
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
        ConfirmationService,
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
    fixture.detectChanges();
  });

  afterEach(() => httpMock.verify());

  const dialog = (): TaskReassignDialogComponent =>
    fixture.debugElement.query(By.directive(TaskReassignDialogComponent)).componentInstance;

  it('renders the fetched unassigned tasks', () => {
    expect(component.tasks()).toEqual([UNASSIGNED_TASK]);
  });

  // The picker is the dialog's own, and it loads on opening — not on page
  // load, when most viewers reassign nothing. ACC-167: it asks for the
  // assignment picker's units, for this task, never the tenant's user list.
  it('opens the shared reassign dialog for the chosen task, which then loads its picker', () => {
    httpMock.expectNone((r) => r.url.includes('/assignment/units'));

    component.onOpenReassign(UNASSIGNED_TASK);
    fixture.detectChanges();

    expect(dialog().visible()).toBe(true);
    expect(dialog().task()).toEqual(UNASSIGNED_TASK);
    const units = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/tasks/assignment/units`);
    expect(units.request.params.get('taskId')).toBe(UNASSIGNED_TASK.id);
    units.flush([]);
    httpMock.expectNone((r) => r.url.startsWith(`${environment.apiUrl}/users`));
  });

  it('refreshes the unassigned list once the dialog reports a reassignment', () => {
    dialog().reassigned.emit();

    httpMock.expectOne(`${environment.apiUrl}/tasks/unassigned`).flush([]);
    expect(component.tasks()).toEqual([]);
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
        ConfirmationService,
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
