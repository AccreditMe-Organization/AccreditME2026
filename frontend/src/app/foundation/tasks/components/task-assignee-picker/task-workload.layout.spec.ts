import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskDto } from '../../services/task.service';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../task-form/task-form-steps.component';
import { TaskReassignDialogComponent, TaskRejection } from '../task-reassign-dialog/task-reassign-dialog.component';

// ACC-199 — the 420px body cap (ACC-111), MEASURED and not assumed (ACC-120):
// New task, step 1, and Reassign, with "✦ Suggest someone" in every state —
// counts only, the button, working, the hint, a refusal — in both languages,
// in the real dialog shell with the real theme, font and translations. No task
// is created: every request is answered by the test.
//
// THE WORST CASE: the longest person names in the realistic seed, its longest
// position in each language (org-position.seed.ts and the fixtures), and
// two-digit counts with an overdue clause. Reassign
// in its tallest state: a rejected task with a two-line reason, and the
// reason's required error showing.
//
// And the person rows: the counts sit at the row's end edge, so a row with
// counts is exactly as tall as one without.
//
// NON-VACUITY FIRST (ACC-120): each measure asserts the body is laid out, the
// state is on screen, and the real font is the one measured.

const API = environment.apiUrl;
const CAP = 420;
const FLOOR = 150;
// ACC-120 — a fit with less than a line to spare is not a pass: one longer
// name, one wider word, and it is over. Every state keeps a meta line of room.
const HEADROOM = 20;
const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };

const NAME_CHOSEN = 'Dr. Shaikha Al-Rumaithi';
const NAME_OTHER = 'Prof. Adel Al-Mansoori';
const POSITION = { en: 'Chief Executive Officer', ar: 'نائب المدير العام' };

function people(withWorkload: boolean) {
  const w = (open: number, overdue: number, canSuggest: boolean) => (withWorkload ? { openCount: open, overdueCount: overdue, canSuggest } : null);
  return [
    { id: 'chosen', name: NAME_CHOSEN, positionNameEn: POSITION.en, positionNameAr: POSITION.ar, workload: w(12, 13, true) },
    { id: 'other', name: NAME_OTHER, positionNameEn: POSITION.en, positionNameAr: POSITION.ar, workload: w(4, 0, false) },
    { id: 'third', name: 'Khalid Al-Zahrani', positionNameEn: POSITION.en, positionNameAr: POSITION.ar, workload: w(7, 1, true) },
  ];
}

const HINT = {
  interactionId: 'log-7',
  chosen: { userId: 'chosen', openCount: 12, overdueCount: 13 },
  // The longest sentence: both clauses, "none overdue or due within 2 working days".
  suggestion: { userId: 'other', name: NAME_OTHER, positionNameEn: POSITION.en, positionNameAr: POSITION.ar, openCount: 14, overdueCount: 0, dueSoonCount: 0 },
  dueSoonSeen: true,
};

@Component({
  standalone: true,
  imports: [TaskFormComponent, TaskFormFooterComponent, TaskFormStepsComponent, EditDialogComponent],
  template: `
    <ng-template #steps><app-task-form-steps [form]="formRef()" /></ng-template>
    <ng-template #footer><app-task-form-footer [form]="formRef()" /></ng-template>
    <ng-template #body>
      <app-task-form
        lockedSourceType="COMMITTEE"
        lockedSourceId="cmt-1"
        lockedSourceLabel="Infection Control Committee"
        (ready)="formRef.set($event)"
      />
    </ng-template>
    <app-edit-dialog
      [visible]="true"
      header="New task"
      context="on Infection Control Committee"
      [content]="body"
      [headerExtra]="steps"
      [footer]="footer"
    />
  `,
})
class NewTaskHost {
  readonly formRef = signal<TaskFormComponent | null>(null);
}

const TASK = { id: 'task-1', title: 'Review incident report', sourceType: 'COMMITTEE', sourceId: 'cmt-1', priority: 'HIGH' } as ITaskDto;
const REJECTION: TaskRejection = {
  byName: 'Dr. Khalifa Al-Muhairi',
  reason: 'Pharmacy holds the stock records for ward 6A and should check them first; I cannot do this until they reply.',
};

@Component({
  standalone: true,
  imports: [TaskReassignDialogComponent],
  template: `<app-task-reassign-dialog [visible]="true" [task]="task" [rejection]="rejection" committeeName="Infection Control Committee" />`,
})
class ReassignHost {
  readonly task = TASK;
  readonly rejection = REJECTION;
}

describe('"✦ Suggest someone" — the 420px body cap, New task step 1 and Reassign (ACC-199)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let fixture: ComponentFixture<unknown>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function configure(language: 'en' | 'ar', host: unknown): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [host as never],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = TestBed.inject(LanguageService).isRtl() ? 'rtl' : 'ltr';
    http = TestBed.inject(HttpTestingController);
  }

  function body(): HTMLElement {
    const el = document.querySelector<HTMLElement>('.am-dialog__body');
    expect(el).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
    return el!;
  }

  async function measure(label: string, language: 'en' | 'ar', onScreen: string): Promise<number> {
    await settle();
    await document.fonts.ready;
    await settle();
    expect(document.fonts.check('13px "IBM Plex Sans Arabic"')).withContext('measured in a fallback font').toBe(true);
    expect(document.querySelector(onScreen)).withContext(`${label} [${language}]: ${onScreen} is not on screen`).not.toBeNull();
    const height = body().scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px against the ${CAP}px cap`).toBeLessThanOrEqual(CAP);
    expect(height)
      .withContext(`${label} [${language}] body ${height}px leaves less than a line under the cap`)
      .toBeLessThanOrEqual(CAP - HEADROOM);
    return height;
  }

  /** Unit, position, people (with or without counts). */
  async function choose(group: { controls: Record<'scope' | 'target' | 'userId', { setValue(v: string | null): void }> }, withWorkload = true): Promise<void> {
    group.controls.scope.setValue('unit-1');
    await settle();
    http.expectOne((r) => r.url === `${API}/tasks/assignment/positions`).flush([
      { id: 'pos-1', nameEn: POSITION.en, nameAr: POSITION.ar, isSingleAssignee: false, holderCount: 3 },
    ]);
    group.controls.target.setValue('pos-1');
    await settle();
    http.expectOne((r) => r.url === `${API}/tasks/assignees`).flush(people(withWorkload));
    await settle();
  }

  const press = async (): Promise<TestRequest> => {
    document.querySelector<HTMLButtonElement>('.am-wh__suggest')!.click();
    await settle();
    return http.expectOne({ method: 'POST', url: `${API}/tasks/assignment/workload-hint` });
  };

  /** Every state, in order, for a picker whose group is `group`. */
  async function everyState(
    label: string,
    language: 'en' | 'ar',
    group: { controls: Record<'scope' | 'target' | 'userId', { setValue(v: string | null): void }> },
  ): Promise<void> {
    await choose(group);
    group.controls.userId.setValue('other'); // not past the threshold: counts, no button
    await measure(`${label} · counts only`, language, '.am-picker__person');
    expect(document.querySelector('.am-wh__suggest')).toBeNull();

    group.controls.userId.setValue('chosen');
    await settle();
    http.expectOne(`${API}/tasks/assignment/workload-hint/availability`).flush({ available: true });
    await measure(`${label} · button showing`, language, '.am-wh__suggest');

    const req = await press();
    await measure(`${label} · working`, language, '.am-wh__suggest[aria-busy="true"]');

    req.flush(HINT);
    await measure(`${label} · hint`, language, '.am-wh--ai');
    // Non-vacuity: the longest sentence is the one measured.
    expect(document.querySelector('.am-wh__text')!.textContent).toContain(language === 'ar' ? 'أو مستحق خلال' : 'none overdue or due within');
    // The line sits BELOW the Person field, never over it, in both layouts.
    const control = document.querySelector('.am-picker__person .am-overlay-select-trigger')!.getBoundingClientRect();
    const line = document.querySelector('app-task-workload-hint')!.getBoundingClientRect();
    expect(line.top).withContext(`${label} [${language}]: the hint overlaps the Person field`).toBeGreaterThanOrEqual(control.bottom);

    // The refusals, on the next person past the threshold (each person's
    // answer is kept; a failure is not). A failed call first, with Try again…
    group.controls.userId.setValue('third');
    await settle();
    (await press()).flush({ statusCode: 502, message: 'x', code: 'AI_PROVIDER_FAILED' }, { status: 502, statusText: 'Bad Gateway' });
    await measure(`${label} · refusal, failed with Try again`, language, '.am-wh__refusal--failed .am-wh__action');

    // …then Try again, answered "credits used up" — the longest sentence.
    document.querySelector<HTMLButtonElement>('.am-wh__refusal--failed .am-wh__action')!.click();
    await settle();
    http.expectOne({ method: 'POST', url: `${API}/tasks/assignment/workload-hint` }).flush(
      { statusCode: 409, message: 'x', code: 'AI_CREDITS_EXHAUSTED', renewsAt: '2026-10-21T00:00:00.000Z' },
      { status: 409, statusText: 'Conflict' },
    );
    await measure(`${label} · refusal, credits used up`, language, '.am-wh__refusal');
  }

  afterAll(() => console.log(`ACC-199 measurements\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      afterEach(() => http.verify());

      it('New task, step 1: every state fits', async () => {
        configure(language, NewTaskHost);
        fixture = TestBed.createComponent(NewTaskHost);
        fixture.detectChanges();
        await settle();
        http.expectOne(`${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
        http.expectOne(`${API}/working-calendar`).flush({
          id: 'cal-1',
          organizationId: 'org-1',
          timezone: 'Asia/Riyadh',
          workingDays: [0, 1, 2, 3, 4],
          workingHoursStart: '07:30',
          workingHoursEnd: '17:00',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        });
        http.expectOne(`${API}/working-calendar/holidays`).flush([]);
        http.expectOne(`${API}/tasks/sla-preview`).flush({ CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR });
        http.expectOne(`${API}/tasks/draft/availability`).flush({ available: false });
        const form = (fixture.componentInstance as NewTaskHost).formRef()!;
        form.form.patchValue({ title: 'Restock and check hand rub on ward 6A' });
        await everyState('New task', language, form.form.controls.assignTo);
      });

      it('Reassign, its tallest state (a rejected task, the reason\'s error showing): every state fits', async () => {
        configure(language, ReassignHost);
        fixture = TestBed.createComponent(ReassignHost);
        fixture.detectChanges();
        await settle();
        http.expectOne((r) => r.url === `${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
        await settle();
        const dialog = fixture.debugElement.query((d) => d.componentInstance instanceof TaskReassignDialogComponent)
          .componentInstance as TaskReassignDialogComponent;
        // The reason's required error: Reassign pressed with no reason.
        dialog.showErrors.set(true);
        dialog.form.controls.reason.markAsTouched();
        await everyState('Reassign', language, dialog.form.controls.assignTo);
        expect(document.querySelector('.am-field__message--error')).withContext('the reason\'s error is not showing').not.toBeNull();
      });

      it('the person rows: counts at the end edge add no height', async () => {
        configure(language, NewTaskHost);
        fixture = TestBed.createComponent(NewTaskHost);
        fixture.detectChanges();
        await settle();
        http.expectOne(`${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: null }]);
        http.expectOne(`${API}/working-calendar`).flush({ id: 'c', organizationId: 'o', timezone: 'Asia/Riyadh', workingDays: [0, 1, 2, 3, 4], workingHoursStart: '07:30', workingHoursEnd: '17:00', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
        http.expectOne(`${API}/working-calendar/holidays`).flush([]);
        http.expectOne(`${API}/tasks/sla-preview`).flush({ CRITICAL: FAR, HIGH: FAR, MEDIUM: FAR, LOW: FAR });
        http.expectOne(`${API}/tasks/draft/availability`).flush({ available: false });
        const group = (fixture.componentInstance as NewTaskHost).formRef()!.form.controls.assignTo;

        const rowHeights = async (): Promise<{ rows: number[]; counts: number }> => {
          document.querySelector<HTMLElement>('.am-picker__person .am-overlay-select-trigger')!.click();
          await settle();
          await document.fonts.ready;
          const rows = Array.from(document.querySelectorAll<HTMLElement>('.am-overlay-select-option')).map((r) => Math.round(r.getBoundingClientRect().height));
          const counts = document.querySelectorAll('.am-picker__counts').length;
          document.querySelector<HTMLElement>('.am-picker__person .am-overlay-select-trigger')!.click();
          await settle();
          return { rows, counts };
        };

        await choose(group, true);
        const withCounts = await rowHeights();
        // Non-vacuity: the counts really were drawn in the rows measured.
        expect(withCounts.counts).withContext('no counts were drawn').toBe(3);
        group.controls.target.setValue(null);
        await settle();
        group.controls.target.setValue('pos-1');
        await settle();
        http.expectOne((r) => r.url === `${API}/tasks/assignees`).flush(people(false));
        await settle();
        const withoutCounts = await rowHeights();
        expect(withoutCounts.counts).toBe(0);

        // Non-vacuity: the rows exist and are laid out.
        expect(withCounts.rows.length).toBe(3);
        expect(Math.min(...withCounts.rows)).toBeGreaterThan(20);
        measured.push(`person rows [${language}]: with counts ${withCounts.rows.join('/')}, without ${withoutCounts.rows.join('/')}`);
        expect(withCounts.rows).withContext('a row with counts is taller than one without').toEqual(withoutCounts.rows);
      });
    });
  }
});
