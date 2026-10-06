import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { provideRouter } from '@angular/router';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { ITaskDto } from '../../services/task.service';
import { TaskFormComponent } from './task-form.component';

// ACC-174 — the SLA limit on New task, and Edit: New task's own form given a
// task. Dates are far off and relative, so no test depends on today.

const API = `${environment.apiUrl}/tasks`;
const DAY = 24 * 60 * 60 * 1000;
const inDays = (d: number) => new Date(Date.now() + d * DAY);

const window = (dueAt: Date, limitAt: Date = dueAt) => ({ dueAt: dueAt.toISOString(), limitAt: limitAt.toISOString() });

const TASK = {
  id: 'task-1',
  title: 'Collect the audit sample',
  description: 'From ward 3',
  status: 'PENDING',
  priority: 'MEDIUM',
  dueAt: inDays(4).toISOString(),
  sourceType: 'COMMITTEE',
  sourceId: 'committee-1',
} as ITaskDto;

const CALENDAR = {
  id: 'cal-1',
  organizationId: 'org-1',
  timezone: 'Asia/Riyadh',
  workingDays: [0, 1, 2, 3, 4, 5, 6],
  workingHoursStart: '08:00',
  workingHoursEnd: '16:00',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('TaskFormComponent — the SLA limit and Edit (ACC-174)', () => {
  let fixture: ComponentFixture<TaskFormComponent>;
  let component: TaskFormComponent;
  let http: HttpTestingController;

  function setup(task: ITaskDto | null, preview: Record<string, unknown>, language: 'en' | 'ar' = 'en') {
    TestBed.configureTestingModule({
      imports: [TaskFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        provideRouter([]),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(TaskFormComponent);
    component = fixture.componentInstance;
    if (task) fixture.componentRef.setInput('task', task);
    fixture.detectChanges();

    http.match(`${API}/assignment/units`).forEach((r) => r.flush([]));
    http.match(`${environment.apiUrl}/working-calendar`).forEach((r) => r.flush(CALENDAR));
    http.match((r) => r.url.startsWith(`${environment.apiUrl}/working-calendar/holidays`)).forEach((r) => r.flush([]));
    http.expectOne(task ? `${API}/${task.id}/sla-preview` : `${API}/sla-preview`).flush(preview);
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  describe('New task', () => {
    const limit = inDays(3);
    const lowLimit = inDays(6);
    const preview = {
      CRITICAL: window(inDays(0.5)),
      HIGH: window(inDays(1)),
      MEDIUM: window(limit),
      LOW: window(lowLimit),
    };

    it("stops the calendar at the chosen priority's limit, and moves it with the priority", () => {
      setup(null, preview);
      expect(component.limit()).toEqual(limit);
      component.form.controls.priority.setValue('LOW');
      expect(component.limit()).toEqual(lowLimit);
    });

    it('refuses a due date past the limit — an error, like a past one — and withholds Create', () => {
      setup(null, preview);
      component.form.controls.title.setValue('Chase the lab');
      component.onDayPicked(inDays(5));
      fixture.detectChanges();

      expect(component.afterLimit()).toBe(true);
      expect(component.form.controls.dueDate.hasError('afterLimit')).toBe(true);
      expect(component.canCreateFromStep1()).toBe(false);
      expect(document.body.textContent).toContain('Past the SLA limit');

      component.form.controls.priority.setValue('LOW');
      expect(component.afterLimit()).toBe(false);
      expect(component.form.controls.dueDate.hasError('afterLimit')).toBe(false);
    });
  });

  describe('Edit', () => {
    const mediumLimit = inDays(5);
    const preview = {
      CRITICAL: window(inDays(-2)),
      HIGH: window(inDays(1)),
      MEDIUM: window(inDays(4), mediumLimit),
      LOW: window(inDays(9)),
    };

    it("loads the task's own preview and fields, and starts clean", () => {
      setup(TASK, preview);
      expect(component.isEdit()).toBe(true);
      expect(component.form.getRawValue()).toEqual(
        jasmine.objectContaining({ title: 'Collect the audit sample', description: 'From ward 3', priority: 'MEDIUM' }),
      );
      expect(component.form.dirty).toBe(false);
      expect(component.limit()).toEqual(mediumLimit);
    });

    it('sends only what changed — a title edit sends the title alone', () => {
      setup(TASK, preview);
      const saved = jasmine.createSpy('saved');
      component.saved.subscribe(saved);
      component.form.controls.title.setValue('  Collect the corrected sample  ');
      component.onSubmit();

      const req = http.expectOne(`${API}/task-1`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ title: 'Collect the corrected sample' });
      req.flush({});
      expect(saved).toHaveBeenCalled();
    });

    // Found in the browser pass: the control was marked dirty AFTER setValue(),
    // so the change event reported a clean form and Escape discarded silently.
    it('a change to the due date alone reports the form dirty, so Escape asks first', () => {
      setup(TASK, preview);
      const dirty: boolean[] = [];
      component.dirtyChange.subscribe((d) => dirty.push(d));
      component.onDayPicked(inDays(2));
      expect(dirty.at(-1)).toBe(true);
    });

    it('changing nothing sends nothing', () => {
      setup(TASK, preview);
      const saved = jasmine.createSpy('saved');
      component.saved.subscribe(saved);
      component.onSubmit();
      http.expectNone(`${API}/task-1`);
      expect(saved).toHaveBeenCalled();
    });

    it('a new priority shows the recomputed due date before saving, and sends the priority alone', () => {
      setup(TASK, preview);
      component.form.controls.priority.setValue('LOW');
      fixture.detectChanges();

      expect(component.recomputedText()).toContain('With this priority, the due date becomes');
      expect(document.body.textContent).toContain('With this priority, the due date becomes');

      component.onSubmit();
      expect(http.expectOne(`${API}/task-1`).request.body).toEqual({ priority: 'LOW' });
    });

    it('a recomputed due date already past is not refused — the server answers for it (C4)', () => {
      setup(TASK, preview);
      component.form.controls.priority.setValue('CRITICAL');
      expect(component.isPast()).toBe(false);
      expect(component.afterLimit()).toBe(false);
      expect(component.form.invalid).toBe(false);
    });

    it('a due date the person sets is refused past the limit, and sent within it', () => {
      setup(TASK, preview);
      component.onDayPicked(inDays(7)); // limit is 5 days out
      expect(component.afterLimit()).toBe(true);
      expect(component.form.invalid).toBe(true);
      component.onSubmit();
      http.expectNone(`${API}/task-1`);

      component.onDayPicked(inDays(2));
      expect(component.afterLimit()).toBe(false);
      const chosen = component.form.controls.dueDate.value!;
      component.onSubmit();
      expect(http.expectOne(`${API}/task-1`).request.body).toEqual({ dueDate: chosen.toISOString() });
    });

    it("an overdue task's own due date does not block saving a title", () => {
      setup({ ...TASK, dueAt: inDays(-1).toISOString() } as ITaskDto, preview);
      expect(component.isPast()).toBe(false);
      component.form.controls.title.setValue('Renamed');
      component.onSubmit();
      expect(http.expectOne(`${API}/task-1`).request.body).toEqual({ title: 'Renamed' });
    });

    it('an ON_HOLD task: due date and priority are locked with a reason; the title still saves', () => {
      setup({ ...TASK, status: 'ON_HOLD' } as ITaskDto, preview);
      fixture.detectChanges();
      expect(component.dueLocked()).toBe(true);
      expect(component.form.controls.priority.disabled).toBe(true);
      expect(document.body.textContent).toContain('Resume the task to change its due date or priority.');

      component.form.controls.title.setValue('Renamed');
      component.onSubmit();
      expect(http.expectOne(`${API}/task-1`).request.body).toEqual({ title: 'Renamed' });
    });

    it("shows the server's refusal instead of failing silently", () => {
      setup(TASK, preview);
      component.form.controls.title.setValue('Renamed');
      component.onSubmit();
      http
        .expectOne(`${API}/task-1`)
        .flush({ message: 'A completed task cannot be edited' }, { status: 409, statusText: 'Conflict' });
      expect(component.saveError()).toBe('A completed task cannot be edited');
    });

    it('reads in Arabic', () => {
      setup(TASK, preview, 'ar');
      component.form.controls.priority.setValue('LOW');
      fixture.detectChanges();
      expect(document.body.textContent).toContain('بهذه الأولوية يصبح موعد الاستحقاق');
    });
  });
});
