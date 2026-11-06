import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable } from 'rxjs';
import { MyWorkEvents } from './my-work-events';
import { TaskService } from '../../foundation/tasks/services/task.service';
import { WorkflowService } from '../../foundation/workflow/services/workflow.service';
import { ChangeRequestService } from '../../foundation/committees/change-requests/change-request.service';

// ACC-279 — every action that can change a work count says so once its request
// SUCCEEDS, and never when it fails; the counts service reloads on it (no timer).
describe('MyWorkEvents wiring (ACC-279)', () => {
  let http: HttpTestingController;
  let changed: number;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    changed = 0;
    TestBed.inject(MyWorkEvents).changes$.subscribe(() => changed++);
  });

  afterEach(() => http.verify());

  const actions: Record<string, () => Observable<unknown>> = {
    'task complete': () => TestBed.inject(TaskService).complete('t-1'),
    'task reject': () => TestBed.inject(TaskService).reject('t-1', { reason: 'Not mine' } as never),
    'task pick up': () => TestBed.inject(TaskService).pick('t-1'),
    'task release': () => TestBed.inject(TaskService).release('t-1', { reason: 'Busy' } as never),
    'task reassign': () => TestBed.inject(TaskService).reassign('t-1', {} as never),
    'task cancel': () => TestBed.inject(TaskService).cancel('t-1', { reason: 'Moot' } as never),
    'task reopen': () => TestBed.inject(TaskService).reopen('t-1', {} as never),
    'request approve': () => TestBed.inject(TaskService).approveRequest('t-1', 'r-1'),
    'request decline': () => TestBed.inject(TaskService).declineRequest('t-1', 'r-1', 'No'),
    'workflow move': () => TestBed.inject(WorkflowService).triggerTransition('i-1', {} as never),
    'workflow vote': () => TestBed.inject(WorkflowService).submitApproval('e-1', {} as never),
    'workflow cancel': () => TestBed.inject(WorkflowService).cancelInstance('i-1', 'Moot'),
    'change request approve': () => TestBed.inject(ChangeRequestService).approve('cr-1'),
    'change request return': () => TestBed.inject(ChangeRequestService).returnForChanges('cr-1', 'Fix it'),
    'change request reject': () => TestBed.inject(ChangeRequestService).reject('cr-1', 'No'),
    'change request withdraw': () => TestBed.inject(ChangeRequestService).withdraw('cr-1'),
  };

  for (const [name, act] of Object.entries(actions)) {
    it(`${name}: says so once on success, not on failure`, () => {
      act().subscribe({ error: () => undefined });
      http.match(() => true).forEach((r) => r.flush({}));
      expect(changed).withContext('after success').toBe(1);

      act().subscribe({ error: () => undefined });
      http.match(() => true).forEach((r) => r.flush({ message: 'no' }, { status: 409, statusText: 'Conflict' }));
      expect(changed).withContext('after failure').toBe(1);
    });
  }

  it('a read says nothing', () => {
    TestBed.inject(TaskService).getAvailable().subscribe();
    http.match(() => true).forEach((r) => r.flush([]));
    expect(changed).toBe(0);
  });
});
