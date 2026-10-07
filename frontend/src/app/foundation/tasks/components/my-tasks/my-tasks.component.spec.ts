import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import {
  IMyTaskListItemDto,
  ITaskListItemDto,
  TaskOpenRequestDto,
  TaskPoolDto,
  TaskRequestForDecisionDto,
} from '../../services/task.service';
import { AuthService } from '../../../../core/services/auth.service';
import { MyTasksComponent } from './my-tasks.component';

// ACC-94 — DEFECT 3. The due date rendered through Angular's DatePipe with no
// locale registered: US order ("9/16/26, 12:30 AM" reads as 9 June to half the
// world and 16 September to the other half, but as 9 October to a GCC reader),
// in the BROWSER's time zone rather than the tenant's.
//
// The instant is 21:30 UTC — already the next day in Riyadh. The tenant zone in
// the first case is New York, which is neither this development machine's zone
// (Riyadh) nor CI's (UTC), so the expectation cannot pass by coincidence on
// either.

const task = (overrides: Partial<IMyTaskListItemDto>): IMyTaskListItemDto => ({
  id: 'task-1',
  organizationId: 'org-1',
  title: 'Submit terms of reference',
  description: null,
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
  sourceStageId: null,
  workflowInstanceId: null,
  meetingId: null,
  createdById: 'user-1',
  status: 'PENDING',
  priority: 'HIGH',
  dueAt: '2026-09-15T21:30:00.000Z',
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
  canManage: false,
  evidenceCount: 0,
  pool: null,
  openRequest: null,
  pickedByMe: false,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
  ...overrides,
});

describe('MyTasksComponent — due dates (ACC-94)', () => {
  function render(options: { zone: string; language: 'en' | 'ar'; tasks: IMyTaskListItemDto[] }): HTMLElement {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        // The reject and link dialogs ask before discarding typed work; the
        // app provides this at root (app.config.ts).
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(options.language);
    TestBed.inject(TestFormatContext).zone.set(options.zone);

    const fixture = TestBed.createComponent(MyTasksComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/tasks/my-tasks`).flush(options.tasks);
    // ACC-167 — nothing waiting in the viewer's pools.
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/tasks/available`).flush([]);
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/tasks/requests/awaiting-decision`).flush([]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  // The due date is the fourth column: source, title, priority, due, status.
  const dueCells = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('tbody tr')).map((row) => row.querySelectorAll('td')[3]?.textContent?.trim());

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('shows the due date unambiguously, in the tenant time zone, 24-hour', () => {
    expect(dueCells(render({ zone: 'America/New_York', language: 'en', tasks: [task({})] }))).toEqual([
      '15 Sep 2026, 17:30',
    ]);
  });

  it('puts the same instant on the next day for a Riyadh tenant', () => {
    expect(dueCells(render({ zone: 'Asia/Riyadh', language: 'en', tasks: [task({})] }))).toEqual([
      '16 Sep 2026, 00:30',
    ]);
  });

  it('writes the month in Arabic, with Latin digits, in an Arabic session', () => {
    expect(dueCells(render({ zone: 'Asia/Riyadh', language: 'ar', tasks: [task({})] }))).toEqual([
      '16 سبتمبر 2026، 00:30',
    ]);
  });

  it('shows — for a task with no due date', () => {
    expect(dueCells(render({ zone: 'Asia/Riyadh', language: 'en', tasks: [task({ dueAt: null })] }))).toEqual(['—']);
  });
});

// ACC-163 — the assignee's actions, the overdue flag and the evidence rule.
describe('MyTasksComponent — statuses and actions (ACC-163)', () => {
  const API = `${environment.apiUrl}/tasks`;
  const PAST = '2026-01-01T09:00:00.000Z';
  const FUTURE = '2099-01-01T09:00:00.000Z';

  let http: HttpTestingController;

  function render(
    tasks: IMyTaskListItemDto[],
    language: 'en' | 'ar' = 'en',
    available: ITaskListItemDto[] = [],
    awaiting: TaskRequestForDecisionDto[] = [],
  ) {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        // The reject and link dialogs ask before discarding typed work; the
        // app provides this at root (app.config.ts).
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MyTasksComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/my-tasks`).flush(tasks);
    http.expectOne(`${API}/available`).flush(available);
    http.expectOne(`${API}/requests/awaiting-decision`).flush(awaiting);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  // Each tag's own text, joined with " " — read per tag because two tags
  // side by side concatenate with no separator in textContent.
  const statusCell = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('tbody tr td')[4]?.querySelectorAll('p-tag') ?? [])
      .map((tag) => tag.textContent?.trim())
      .join(' ');

  afterEach(() => http.verify());

  it('shows PENDING as "Assigned" and offers Start, Add evidence, Reject and Complete', () => {
    const { el } = render([task({ dueAt: FUTURE })]);

    expect(statusCell(el)).toBe('Assigned');
    expect(button(el, 'Start “Submit terms of reference”')).not.toBeNull();
    expect(button(el, 'Add evidence to “Submit terms of reference”')).not.toBeNull();
    expect(button(el, 'Reject “Submit terms of reference”')).not.toBeNull();
    expect(button(el, 'Complete “Submit terms of reference”')).not.toBeNull();
  });

  it('does not offer Start on a task already in progress', () => {
    const { el } = render([task({ status: 'IN_PROGRESS', dueAt: FUTURE })]);

    expect(statusCell(el)).toBe('In progress');
    expect(button(el, 'Start “Submit terms of reference”')).toBeNull();
    expect(button(el, 'Reject “Submit terms of reference”')).not.toBeNull();
  });

  // Q8 — overdue is a flag beside the status. A legacy OVERDUE row is an
  // Assigned task past its due time, and reads exactly so.
  it('shows a legacy OVERDUE row as Assigned with an Overdue badge, and lets it be started', () => {
    const { el } = render([task({ status: 'OVERDUE', dueAt: PAST })]);

    expect(statusCell(el)).toBe('Assigned Overdue');
    expect(button(el, 'Start “Submit terms of reference”')).not.toBeNull();
  });

  it('shows the Overdue badge beside In progress — both facts at once', () => {
    const { el } = render([task({ status: 'IN_PROGRESS', dueAt: PAST })]);

    expect(statusCell(el)).toBe('In progress Overdue');
  });

  it('shows no Overdue badge, and no actions, on a completed task past its due date', () => {
    const { el } = render([task({ status: 'COMPLETED', dueAt: PAST })]);

    expect(statusCell(el)).toBe('Completed');
    expect(el.querySelectorAll('tbody tr td')[5]?.querySelectorAll('button').length).toBe(0);
  });

  it('disables Complete, and says why on the row, while required evidence is missing', () => {
    const { el } = render([task({ requiresEvidence: true, evidenceCount: 0, dueAt: FUTURE })]);

    const complete = button(el, 'Complete “Submit terms of reference” — add evidence first');
    expect(complete).not.toBeNull();
    expect(complete!.disabled).toBe(true);
    expect(el.textContent).toContain('Evidence required · none added yet');
    expect(el.textContent).toContain('Add evidence before completing');
  });

  it('enables Complete once evidence has been added, and counts it', () => {
    const { el } = render([task({ requiresEvidence: true, evidenceCount: 2, dueAt: FUTURE })]);

    expect(button(el, 'Complete “Submit terms of reference”')!.disabled).toBe(false);
    expect(el.textContent).toContain('Evidence required · 2 added');
    expect(el.textContent).not.toContain('Add evidence before completing');
  });

  it('counts evidence with the Arabic plural form', () => {
    const { el } = render([task({ requiresEvidence: true, evidenceCount: 2, dueAt: FUTURE })], 'ar');

    expect(el.textContent).toContain('الدليل مطلوب · أُضيف دليلان');
  });

  it('Start posts to /start and reloads the list', () => {
    const { fixture, el } = render([task({ dueAt: FUTURE })]);

    button(el, 'Start “Submit terms of reference”')!.click();
    const req = http.expectOne(`${API}/task-1/start`);
    expect(req.request.method).toBe('POST');
    req.flush(task({ status: 'IN_PROGRESS' }));
    http.expectOne(`${API}/my-tasks`).flush([]);
    fixture.detectChanges();
  });

  it('the Overdue filter asks the server for overdue tasks, not for a status', () => {
    const { fixture } = render([]);

    fixture.componentInstance.selectedFilter = 'OVERDUE';
    fixture.componentInstance.loadTasks();

    const req = http.expectOne((r) => r.url === `${API}/my-tasks`);
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.has('status')).toBe(false);
    req.flush([]);
  });

  it('the Assigned filter asks for status PENDING', () => {
    const { fixture } = render([]);

    fixture.componentInstance.selectedFilter = 'PENDING';
    fixture.componentInstance.loadTasks();

    const req = http.expectOne((r) => r.url === `${API}/my-tasks`);
    expect(req.request.params.get('status')).toBe('PENDING');
    req.flush([]);
  });

  // The filter's template used to be unnamed, which PrimeNG ignores — so it
  // rendered the raw option values in both languages.
  it("labels the filter in the reader's language, never with raw status values", () => {
    const { el } = render([], 'ar');

    const text = el.querySelector('p-selectbutton')?.textContent ?? '';
    expect(text).toContain('مُسندة');
    expect(text).toContain('متأخرة');
    expect(text).not.toContain('PENDING');
    expect(text).not.toContain('OVERDUE');
  });
});

// ACC-167 — Available to pick up, Pick, and Release.
describe('MyTasksComponent — pools (ACC-167)', () => {
  const API = `${environment.apiUrl}/tasks`;
  const FUTURE = '2099-01-01T09:00:00.000Z';
  const POOL: TaskPoolDto = {
    kind: 'POSITION',
    positionNameEn: 'Quality Officer',
    positionNameAr: 'مسؤول الجودة',
    orgUnitNameEn: 'Pharmacy',
    orgUnitNameAr: 'الصيدلية',
    roleLabelEn: null,
    roleLabelAr: null,
    committeeNameEn: null,
    committeeNameAr: null,
  };

  let http: HttpTestingController;

  function render(
    mine: IMyTaskListItemDto[],
    available: ITaskListItemDto[],
    language: 'en' | 'ar' = 'en',
    awaiting: TaskRequestForDecisionDto[] = [],
  ) {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MyTasksComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/my-tasks`).flush(mine);
    http.expectOne(`${API}/available`).flush(available);
    http.expectOne(`${API}/requests/awaiting-decision`).flush(awaiting);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

  afterEach(() => http.verify());

  it('has no Available section for someone with nothing waiting', () => {
    const { el } = render([], []);

    expect(el.textContent).not.toContain('Available to pick up');
  });

  it('lists what is waiting in the viewer\'s pools, naming the pool, with Pick up', () => {
    const { el } = render([], [task({ id: 'pool-1', title: 'Collect the sample', pool: POOL, dueAt: FUTURE })]);

    expect(el.textContent).toContain('Available to pick up');
    expect(el.textContent).toContain('Assigned to Quality Officer, Pharmacy');
    expect(button(el, 'Pick up “Collect the sample”')).not.toBeNull();
  });

  it('names the pool in Arabic, with the Arabic comma', () => {
    const { el } = render([], [task({ id: 'pool-1', pool: POOL, dueAt: FUTURE })], 'ar');

    expect(el.textContent).toContain('مسؤول الجودة، الصيدلية');
  });

  it('Pick up posts to /pick and reloads both lists', () => {
    const { el } = render([], [task({ id: 'pool-1', title: 'Collect the sample', pool: POOL, dueAt: FUTURE })]);

    button(el, 'Pick up “Collect the sample”')!.click();
    const req = http.expectOne(`${API}/pool-1/pick`);
    expect(req.request.method).toBe('POST');
    req.flush({});
    http.expectOne(`${API}/my-tasks`).flush([]);
    http.expectOne(`${API}/available`).flush([]);
    http.expectOne(`${API}/requests/awaiting-decision`).flush([]);
  });

  // Someone else was first: the server's own sentence, and the row leaves.
  it('says so when someone else picked it up first, and reloads', () => {
    const { fixture, el } = render([], [task({ id: 'pool-1', title: 'Collect the sample', pool: POOL, dueAt: FUTURE })]);

    button(el, 'Pick up “Collect the sample”')!.click();
    http
      .expectOne(`${API}/pool-1/pick`)
      .flush({ message: 'This task has already been picked up' }, { status: 409, statusText: 'Conflict' });
    http.expectOne(`${API}/my-tasks`).flush([]);
    http.expectOne(`${API}/available`).flush([]);
    http.expectOne(`${API}/requests/awaiting-decision`).flush([]);
    fixture.detectChanges();

    expect(el.textContent).toContain('This task has already been picked up');
  });

  it('offers Release on a task the viewer picked up, and says where it came from', () => {
    const { el } = render([task({ pool: POOL, pickedByMe: true, dueAt: FUTURE })], []);

    expect(button(el, 'Release “Submit terms of reference”')).not.toBeNull();
    expect(el.textContent).toContain('Picked up · Quality Officer, Pharmacy');
  });

  // A person the assigner chose directly rejects instead; the server refuses
  // their release too.
  it('does not offer Release on a task given to the viewer directly, even one with a pool', () => {
    const { el } = render([task({ pool: POOL, pickedByMe: false, dueAt: FUTURE })], []);

    expect(button(el, 'Release “Submit terms of reference”')).toBeNull();
    expect(button(el, 'Reject “Submit terms of reference”')).not.toBeNull();
  });
});

// ACC-173 — requests for more time and holds.
describe('MyTasksComponent — requests and holds (ACC-173)', () => {
  const API = `${environment.apiUrl}/tasks`;
  const FUTURE = '2099-01-01T09:00:00.000Z';
  const ME = 'user-me';

  let http: HttpTestingController;

  function render(mine: IMyTaskListItemDto[], awaiting: TaskRequestForDecisionDto[] = [], language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AuthService, useValue: { currentUser: () => ({ id: ME }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(MyTasksComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/my-tasks`).flush(mine);
    http.expectOne(`${API}/available`).flush([]);
    http.expectOne(`${API}/requests/awaiting-decision`).flush(awaiting);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const button = (el: HTMLElement, label: string) =>
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const T = 'Submit terms of reference';

  const pending = (overrides: Partial<TaskOpenRequestDto> = {}): TaskOpenRequestDto => ({
    id: 'req-1',
    type: 'EXTENSION',
    requestedDueAt: '2099-02-01T13:00:00.000Z',
    holdUntil: null,
    requestedById: ME,
    requestedByName: 'Me',
    reason: 'Waiting on the lab',
    createdAt: '2026-10-06T08:00:00.000Z',
    ...overrides,
  });

  afterEach(() => http.verify());

  it('offers "Request more time" and "Ask to put on hold" on an Assigned task with nothing pending', () => {
    const { el } = render([task({ dueAt: FUTURE })]);
    expect(button(el, `Request more time on “${T}”`)).not.toBeNull();
    expect(button(el, `Ask to put “${T}” on hold`)).not.toBeNull();
  });

  it('shows a pending request on the row, with Withdraw for the person who asked — and no second request', () => {
    const { el } = render([task({ dueAt: FUTURE, openRequest: pending() })]);

    expect(el.textContent).toContain('More time requested · to');
    expect(button(el, `Withdraw the request on “${T}”`)).not.toBeNull();
    expect(button(el, `Request more time on “${T}”`)).toBeNull();
  });

  it('offers no Withdraw on a request a co-assignee made', () => {
    const { el } = render([task({ dueAt: FUTURE, openRequest: pending({ requestedById: 'someone-else' }) })]);
    expect(button(el, `Withdraw the request on “${T}”`)).toBeNull();
  });

  it('Withdraw posts to the request and reloads', () => {
    const { el } = render([task({ dueAt: FUTURE, openRequest: pending() })]);

    button(el, `Withdraw the request on “${T}”`)!.click();
    const req = http.expectOne(`${API}/task-1/requests/req-1/withdraw`);
    expect(req.request.method).toBe('POST');
    req.flush({});
    http.expectOne(`${API}/my-tasks`).flush([]);
  });

  it('an on-hold row says until when, offers Resume now and evidence — and nothing else', () => {
    const { el } = render([
      task({ status: 'ON_HOLD', heldFromStatus: 'IN_PROGRESS', onHoldUntil: '2099-01-10T05:00:00.000Z', dueAt: FUTURE }),
    ]);

    expect(el.textContent).toContain('On hold until 10 Jan 2099');
    expect(el.textContent).toContain('On hold');
    expect(button(el, `Resume “${T}” now`)).not.toBeNull();
    expect(button(el, `Add evidence to “${T}”`)).not.toBeNull();
    for (const label of [`Start “${T}”`, `Complete “${T}”`, `Reject “${T}”`, `Request more time on “${T}”`]) {
      expect(button(el, label)).toBeNull();
    }
  });

  it('an on-hold task past its due date is not flagged overdue — its SLA is paused', () => {
    const { el } = render([task({ status: 'ON_HOLD', onHoldUntil: FUTURE, dueAt: '2026-01-01T09:00:00.000Z' })]);
    // The status cell: its own tags, one by one ("Overdue" is also a filter).
    const tags = Array.from(el.querySelectorAll('tbody tr td')[4]?.querySelectorAll('p-tag') ?? []).map((t) =>
      t.textContent?.trim(),
    );
    expect(tags).toEqual(['On hold']);
  });

  it('Resume now posts to /resume and reloads', () => {
    const { el } = render([task({ status: 'ON_HOLD', onHoldUntil: FUTURE, dueAt: FUTURE })]);

    button(el, `Resume “${T}” now`)!.click();
    const req = http.expectOne(`${API}/task-1/resume`);
    expect(req.request.method).toBe('POST');
    req.flush({});
    http.expectOne(`${API}/my-tasks`).flush([]);
  });

  describe('Waiting for your decision', () => {
    const inbox = (overrides: Partial<TaskRequestForDecisionDto> = {}): TaskRequestForDecisionDto => ({
      ...pending({ requestedById: 'sara', requestedByName: 'Sara' }),
      task: {
        id: 'task-9',
        title: 'Collect the sample',
        sourceType: 'COMMITTEE',
        sourceId: 'c1',
        status: 'PENDING',
        priority: 'MEDIUM',
        dueAt: FUTURE,
      },
      ...overrides,
    });

    it('renders nothing when nothing is waiting', () => {
      const { el } = render([]);
      expect(el.textContent).not.toContain('Waiting for your decision');
    });

    it('lists what was asked, by whom and why, with Review', () => {
      const { el } = render([], [inbox()]);

      expect(el.textContent).toContain('Waiting for your decision');
      expect(el.textContent).toContain('Sara asks for the due date to move to');
      expect(el.textContent).toContain('Reason: Waiting on the lab');
      expect(button(el, 'Review the request on “Collect the sample”')).not.toBeNull();
    });

    it('names a hold request in Arabic', () => {
      const { el } = render([], [inbox({ type: 'ON_HOLD', requestedDueAt: null, holdUntil: '2099-01-10T05:00:00.000Z' })], 'ar');
      expect(el.textContent).toContain('بانتظار قرارك');
      expect(el.textContent).toContain('يطلب Sara إيقافها مؤقتًا حتى');
    });
  });
});

// ACC-174 — the creator's own actions: canManage says WHO, the status WHICH.
describe('MyTasksComponent — edit, cancel and reopen (ACC-174)', () => {
  const API = `${environment.apiUrl}/tasks`;
  const FUTURE = '2099-01-01T09:00:00.000Z';
  const T = 'Submit terms of reference';
  let http: HttpTestingController;

  function render(mine: IMyTaskListItemDto[], language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'user-me' }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(MyTasksComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/my-tasks`).flush(mine);
    http.expectOne(`${API}/available`).flush([]);
    http.expectOne(`${API}/requests/awaiting-decision`).flush([]);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const button = (el: HTMLElement, label: string) => el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const edit = `Edit “${T}”`;
  const cancel = `Cancel “${T}”`;
  const reopen = `Reopen “${T}”`;

  afterEach(() => http.verify());

  it('offers Edit and Cancel on an open task the viewer may manage', () => {
    const el = render([task({ dueAt: FUTURE, canManage: true })]);
    expect(button(el, edit)).not.toBeNull();
    expect(button(el, cancel)).not.toBeNull();
    expect(button(el, reopen)).toBeNull();
  });

  it('offers none of them where the viewer may not manage the task', () => {
    const el = render([task({ dueAt: FUTURE, canManage: false })]);
    for (const label of [edit, cancel, reopen]) expect(button(el, label)).toBeNull();
  });

  it("offers no Cancel on a workflow step's task — it ends with its step", () => {
    const el = render([task({ dueAt: FUTURE, canManage: true, sourceStageId: 's1', workflowInstanceId: 'i1' })]);
    expect(button(el, edit)).not.toBeNull();
    expect(button(el, cancel)).toBeNull();
  });

  it('offers Reopen, and only Reopen, on a completed task', () => {
    const el = render([task({ status: 'COMPLETED', dueAt: FUTURE, canManage: true })]);
    expect(button(el, reopen)).not.toBeNull();
    expect(button(el, edit)).toBeNull();
    expect(button(el, cancel)).toBeNull();
  });

  it('offers Edit on a rejected or on-hold task — both are open', () => {
    for (const status of ['REJECTED', 'ON_HOLD']) {
      TestBed.resetTestingModule();
      const el = render([task({ status, dueAt: FUTURE, onHoldUntil: FUTURE, canManage: true })]);
      expect(button(el, edit)).withContext(status).not.toBeNull();
      http.verify();
    }
  });

  it("says why a cancelled task was cancelled, in both languages", () => {
    const cancelled = task({ status: 'CANCELLED', dueAt: FUTURE, cancelledReason: 'The audit was postponed' });
    expect(render([cancelled]).textContent).toContain('Cancelled: The audit was postponed');
    http.verify();
    TestBed.resetTestingModule();
    expect(render([cancelled], 'ar').textContent).toContain('أُلغيت: The audit was postponed');
  });
});
