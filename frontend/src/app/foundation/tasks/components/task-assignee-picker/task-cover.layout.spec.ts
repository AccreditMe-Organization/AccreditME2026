import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { ITaskDto } from '../../services/task.service';
import { TaskFormComponent } from '../task-form/task-form.component';
import { TaskFormFooterComponent } from '../task-form/task-form-footer.component';
import { TaskFormStepsComponent } from '../task-form/task-form-steps.component';
import { TaskReassignDialogComponent, TaskRejection } from '../task-reassign-dialog/task-reassign-dialog.component';

// ACC-302 — the 420px body cap (ACC-111), MEASURED and not assumed (ACC-120),
// with the outcome line saying a covered person is out of office and who the
// task will go to: New task, step 1, and Reassign in its tallest state (a
// rejected task with a two-line reason, the reason's required error showing),
// in both languages, in the real dialog shell with the real theme, font
// (useLayoutFonts, ACC-305) and translations. No task is created: every
// request is answered by the test.
//
// THE WORST CASE: the longest person names in the realistic seed for both the
// person and the cover, its longest position in each language, and the
// person's record counts on the row (ACC-199). Two ways to a cover: the person
// chosen, and a one-holder position whose holder is covered.
//
// NON-VACUITY FIRST (ACC-120): each measure asserts the body is laid out, the
// cover sentence is on screen, and no "✦ Suggest someone" is.

const API = environment.apiUrl;
const CAP = 420;
const FLOOR = 150;
const HEADROOM = 20;
const FAR = { dueAt: '2100-01-01T00:00:00.000Z', limitAt: '2100-01-01T00:00:00.000Z' };

const NAME_AWAY = 'Dr. Shaikha Al-Rumaithi';
const NAME_COVER = 'Prof. Adel Al-Mansoori';
const POSITION = { en: 'Chief Executive Officer', ar: 'نائب المدير العام' };
const COVER = { userId: 'cover', name: NAME_COVER };

/** The away person past the hint's threshold on the record — the server still says canSuggest: false. */
const PEOPLE = [
  { id: 'away', name: NAME_AWAY, positionNameEn: POSITION.en, positionNameAr: POSITION.ar, workload: { openCount: 12, overdueCount: 13, canSuggest: false }, cover: COVER },
  { id: 'other', name: 'Khalid Al-Zahrani', positionNameEn: POSITION.en, positionNameAr: POSITION.ar, workload: { openCount: 4, overdueCount: 0, canSuggest: false }, cover: null },
];

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
  at: '2026-10-05T09:12:00.000Z',
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

type Group = { controls: Record<'scope' | 'target' | 'userId', { setValue(v: string | null): void }> };

describe('Out of office — the 420px body cap with the cover line, New task step 1 and Reassign (ACC-302)', () => {
  useLayoutFonts({ rtl: true });
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

  /** The cover sentence, as the screen says it in this language. */
  function coverSentence(language: 'en' | 'ar'): string {
    return language === 'ar' ? `${NAME_AWAY} خارج المكتب` : `${NAME_AWAY} is out of office. This task will go to ${NAME_COVER}.`;
  }

  async function measure(label: string, language: 'en' | 'ar'): Promise<number> {
    await settle();
    await settle();
    // Non-vacuity: the cover sentence is the line measured, and no hint is offered.
    expect(body().textContent).withContext(`${label} [${language}]: the cover sentence is not on screen`).toContain(coverSentence(language));
    expect(document.querySelector('.am-wh__suggest')).withContext(`${label} [${language}]: Suggest someone is showing`).toBeNull();
    const height = body().scrollHeight;
    measured.push(`${label} [${language}]: ${height}px`);
    expect(height).withContext(`${label} [${language}] is not laid out`).toBeGreaterThan(FLOOR);
    expect(height).withContext(`${label} [${language}] body ${height}px against the ${CAP}px cap`).toBeLessThanOrEqual(CAP);
    expect(height)
      .withContext(`${label} [${language}] body ${height}px leaves less than a line under the cap`)
      .toBeLessThanOrEqual(CAP - HEADROOM);
    return height;
  }

  /** Unit, then a position (one-holder or not), then its people. */
  async function choose(group: Group, singleHolder: boolean): Promise<void> {
    group.controls.scope.setValue('unit-1');
    await settle();
    http.expectOne((r) => r.url === `${API}/tasks/assignment/positions`).flush([
      { id: 'pos-1', nameEn: POSITION.en, nameAr: POSITION.ar, isSingleAssignee: singleHolder, holderCount: singleHolder ? 1 : 2 },
    ]);
    group.controls.target.setValue('pos-1');
    await settle();
    http.expectOne((r) => r.url === `${API}/tasks/assignees`).flush(singleHolder ? [PEOPLE[0]] : PEOPLE);
    await settle();
  }

  async function bothWays(label: string, language: 'en' | 'ar', group: Group): Promise<void> {
    await choose(group, false);
    group.controls.userId.setValue('away');
    await measure(`${label} · a covered person chosen`, language);

    group.controls.userId.setValue(null);
    group.controls.target.setValue(null);
    await settle();
    group.controls.scope.setValue(null);
    await settle();
    await choose(group, true);
    await measure(`${label} · a one-holder position, its holder covered`, language);
  }

  function newTaskOpens(): void {
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
  }

  afterAll(() => console.log(`ACC-302 measurements\n${measured.join('\n')}`));

  for (const language of ['en', 'ar'] as const) {
    describe(language, () => {
      afterEach(() => http.verify());

      it('New task, step 1: the cover line fits', async () => {
        configure(language, NewTaskHost);
        fixture = TestBed.createComponent(NewTaskHost);
        fixture.detectChanges();
        await settle();
        newTaskOpens();
        const form = (fixture.componentInstance as NewTaskHost).formRef()!;
        form.form.patchValue({ title: 'Restock and check hand rub on ward 6A' });
        await bothWays('New task', language, form.form.controls.assignTo);
      });

      it("Reassign, its tallest state (a rejected task, the reason's error showing): the cover line fits", async () => {
        configure(language, ReassignHost);
        fixture = TestBed.createComponent(ReassignHost);
        fixture.detectChanges();
        await settle();
        http.expectOne((r) => r.url === `${API}/tasks/assignment/units`).flush([{ id: 'unit-1', parentId: null, nameEn: 'Cardiology', nameAr: 'أمراض القلب' }]);
        await settle();
        const dialog = fixture.debugElement.query((d) => d.componentInstance instanceof TaskReassignDialogComponent)
          .componentInstance as TaskReassignDialogComponent;
        dialog.showErrors.set(true);
        dialog.form.controls.reason.markAsTouched();
        await bothWays('Reassign', language, dialog.form.controls.assignTo);
        expect(document.querySelector('.am-field__message--error')).withContext("the reason's error is not showing").not.toBeNull();
      });

      it('the person rows: a covered row says so on its own line; the others are unchanged', async () => {
        configure(language, NewTaskHost);
        fixture = TestBed.createComponent(NewTaskHost);
        fixture.detectChanges();
        await settle();
        newTaskOpens();
        const group = (fixture.componentInstance as NewTaskHost).formRef()!.form.controls.assignTo;
        await choose(group, false);
        document.querySelector<HTMLElement>('.am-picker__person .am-overlay-select-trigger')!.click();
        await settle();
        const rows = Array.from(document.querySelectorAll<HTMLElement>('.am-overlay-select-option'));
        expect(rows.length).toBe(2);
        const covered = rows.find((r) => r.textContent!.includes(NAME_AWAY))!;
        const plain = rows.find((r) => !r.textContent!.includes(NAME_AWAY))!;
        expect(covered.querySelector('[data-testid="picker-cover"]')!.textContent!.trim()).toBe(
          language === 'ar' ? `خارج المكتب · تُسند إلى ${NAME_COVER}` : `Out of office · goes to ${NAME_COVER}`,
        );
        expect(plain.querySelector('[data-testid="picker-cover"]')).toBeNull();
        const heights = rows.map((r) => Math.round(r.getBoundingClientRect().height));
        expect(Math.min(...heights)).toBeGreaterThan(20);
        measured.push(`person rows [${language}]: covered ${Math.round(covered.getBoundingClientRect().height)}px, plain ${Math.round(plain.getBoundingClientRect().height)}px (the list is an overlay, not the body)`);
        document.querySelector<HTMLElement>('.am-picker__person .am-overlay-select-trigger')!.click();
        await settle();
      });
    });
  }
});
