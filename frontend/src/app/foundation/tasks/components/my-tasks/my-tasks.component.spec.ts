import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { ITaskDto } from '../../services/task.service';
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

const task = (overrides: Partial<ITaskDto>): ITaskDto => ({
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
  managerEscalatedAt: null,
  headEscalatedAt: null,
  createdAt: '2026-09-10T08:00:00.000Z',
  updatedAt: '2026-09-10T08:00:00.000Z',
  ...overrides,
});

describe('MyTasksComponent — due dates (ACC-94)', () => {
  function render(options: { zone: string; language: 'en' | 'ar'; tasks: ITaskDto[] }): HTMLElement {
    TestBed.configureTestingModule({
      imports: [MyTasksComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
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
