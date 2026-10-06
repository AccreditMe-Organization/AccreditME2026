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
import { ITaskListItemDto } from '../../services/task.service';
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

const task = (overrides: Partial<ITaskListItemDto>): ITaskListItemDto => ({
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
  evidenceCount: 0,
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
  ...overrides,
});

describe('MyTasksComponent — due dates (ACC-94)', () => {
  function render(options: { zone: string; language: 'en' | 'ar'; tasks: ITaskListItemDto[] }): HTMLElement {
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

  function render(tasks: ITaskListItemDto[], language: 'en' | 'ar' = 'en') {
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

  it('shows PENDING as "Assigned" and offers Start, Add link, Reject and Complete', () => {
    const { el } = render([task({ dueAt: FUTURE })]);

    expect(statusCell(el)).toBe('Assigned');
    expect(button(el, 'Start “Submit terms of reference”')).not.toBeNull();
    expect(button(el, 'Add link evidence to “Submit terms of reference”')).not.toBeNull();
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
