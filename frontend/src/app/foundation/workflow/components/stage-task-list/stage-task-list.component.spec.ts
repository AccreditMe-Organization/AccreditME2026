import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { FormatService } from '../../../../core/formatting';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import {
  StageTaskDefinitionListItemDto,
  WorkflowStageDto,
  WorkflowTemplateDto,
} from '../../services/workflow-template.service';
import { StageTaskListComponent, StageTaskSummary } from './stage-task-list.component';

// ACC-208 — "Tasks on entry" (drawing section 1): the header's arithmetic, a
// row in words, who may change it, keyboard reorder, and delete.

const API = `${environment.apiUrl}/workflow-templates`;

const STAGE: WorkflowStageDto = {
  id: 'stage-1',
  workflowTemplateId: 'template-1',
  nameEn: 'Terms Review',
  nameAr: 'مراجعة الشروط',
  description: null,
  order: 20,
  slaWorkingHours: 40,
  isInitial: false,
  isFinal: false,
  approvalMode: 'SINGLE',
  parallelThreshold: null,
  committeeId: null,
  assigneeStrategy: 'ROLE',
  assigneeUserId: null,
  assigneeRoleId: null,
  assigneeCommitteeRoleValueId: null,
  assigneePositionId: null,
  assigneeOrgUnitId: null,
  escalationConfig: null,
};

const TEMPLATE: WorkflowTemplateDto = {
  id: 'template-1',
  organizationId: 'org',
  nameEn: 'Committee Management',
  nameAr: null,
  objectType: 'COMMITTEE',
  isDefault: true,
  isActive: true,
  createdAt: '',
  updatedAt: '',
  recordRoutes: { unit: true, committee: true },
  taskDueHours: { LOW: 80, MEDIUM: 40, HIGH: 16, CRITICAL: 4 },
};

function definition(over: Partial<StageTaskDefinitionListItemDto>): StageTaskDefinitionListItemDto {
  return {
    id: 'def-1',
    stageId: 'stage-1',
    order: 10,
    titleEn: 'Check the terms',
    titleAr: null,
    description: null,
    isMandatory: true,
    requiresEvidence: false,
    priority: 'HIGH',
    assignKind: 'POSITION',
    orgUnitId: 'unit-1',
    positionId: 'pos-1',
    userId: null,
    committeeId: null,
    committeeRoleValueId: null,
    orgUnit: { id: 'unit-1', nameEn: 'Cardiology', nameAr: 'أمراض القلب' },
    position: { id: 'pos-1', nameEn: 'Quality Officer', nameAr: 'مسؤول الجودة' },
    user: null,
    committee: null,
    committeeRole: null,
    dueAfterHours: 16,
    createdAt: '',
    updatedAt: '',
    warning: null,
    createdTaskCount: 0,
    ...over,
  };
}

const THREE = [
  definition({ id: 'def-1', titleEn: 'Interview the staff involved', titleAr: 'مقابلة الموظفين المعنيين', requiresEvidence: true }),
  definition({
    id: 'def-2',
    titleEn: 'Collect the records',
    userId: 'u-nora',
    user: { id: 'u-nora', name: 'Nora Al-Otaibi' },
    createdTaskCount: 7,
  }),
  definition({
    id: 'def-3',
    titleEn: 'Inform the committee',
    isMandatory: false,
    priority: 'CRITICAL',
    dueAfterHours: 4,
    assignKind: 'COMMITTEE_ROLE',
    orgUnitId: null,
    positionId: null,
    orgUnit: null,
    position: null,
    committeeId: 'c-1',
    committeeRoleValueId: 'role-sec',
    committee: { id: 'c-1', nameEn: 'Quality Assurance Committee', nameAr: null },
    committeeRole: { id: 'role-sec', labelEn: 'Secretary', labelAr: 'أمين السر' },
    warning: 'POOL_EMPTY',
  }),
];

@Component({
  standalone: true,
  imports: [StageTaskListComponent],
  template: `
    <app-stage-task-list
      [stage]="stage()"
      [template]="template"
      [canManage]="canManage()"
      (summaryChanged)="summaries.push($event)"
    />
  `,
})
class HostComponent {
  readonly stage = signal<WorkflowStageDto>(STAGE);
  readonly canManage = signal(true);
  readonly template = TEMPLATE;
  readonly summaries: StageTaskSummary[] = [];
}

describe('StageTaskListComponent (ACC-208)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;

  function setup(options: { rows?: StageTaskDefinitionListItemDto[]; stage?: Partial<WorkflowStageDto>; canManage?: boolean; language?: 'en' | 'ar' } = {}) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(options.language ?? 'en');
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.stage.set({ ...STAGE, ...options.stage });
    fixture.componentInstance.canManage.set(options.canManage ?? true);
    fixture.detectChanges();
    http.expectOne(`${API}/stages/stage-1/task-definitions`).flush(options.rows ?? THREE);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const text = (selector: string) => el.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
    const rows = () => Array.from(el.querySelectorAll<HTMLElement>('[data-stage-task]'));
    const button = (label: string) =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.getAttribute('aria-label') === label || b.textContent?.trim() === label);
    return { fixture, el, text, rows, button };
  }

  afterEach(() => http.verify());

  describe('the header line', () => {
    it('states the deadline and the longest task', () => {
      const { text } = setup();
      expect(text('[data-stage-tasks-summary]')).toBe('Stage deadline: 40 working hours · longest task: 16');
    });

    it('says when there is no deadline', () => {
      const { text } = setup({ stage: { slaWorkingHours: null } });
      expect(text('[data-stage-tasks-summary]')).toBe('No deadline · longest task: 16');
    });

    it('shows the empty state, with Add, when the stage creates nothing', () => {
      const { text, el } = setup({ rows: [] });
      expect(text('[data-stage-tasks-summary]')).toBe('Stage deadline: 40 working hours · no tasks');
      expect(text('[data-stage-tasks-empty] p')).toBe('No tasks are created when a record enters this stage.');
      expect(el.querySelector('[data-stage-tasks-empty] button')).not.toBeNull();
    });

    it('turns into a worded danger line when tasks would be late', () => {
      const { text, el } = setup({ stage: { slaWorkingHours: 12 } });
      expect(text('[data-stage-tasks-summary]')).toBe(
        'Stage deadline: 12 working hours · longest task: 16 · 2 tasks would be late',
      );
      expect(el.querySelector('.am-stage-tasks__summary--late')).not.toBeNull();
    });

    // D4 — the backend refuses definitions on a final stage.
    it('replaces Add with a sentence on a final stage', () => {
      const { text, el } = setup({ rows: [], stage: { isFinal: true } });
      expect(text('[data-stage-tasks-final]')).toBe(
        "A final stage can't create tasks: the record is complete when it arrives.",
      );
      expect(el.querySelector('[data-stage-tasks-empty]')).toBeNull();
      expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes('Add task'))).toBeFalse();
    });

    it('patches the stage row with what it loaded', () => {
      const { fixture } = setup();
      expect(fixture.componentInstance.summaries.at(-1)).toEqual({ taskDefinitionCount: 3, longestTaskHours: 16 });
    });
  });

  describe('a row', () => {
    it('reads as the drawing does: title, Arabic under it, chips, priority and the assignment in words', () => {
      const { rows } = setup();
      const [first, second, third] = rows().map((r) => r.textContent?.replace(/\s+/g, ' ').trim());
      expect(first).toContain('Interview the staff involved');
      expect(first).toContain('مقابلة الموظفين المعنيين');
      expect(first).toContain('Mandatory');
      expect(first).toContain('Evidence required');
      expect(first).toContain('High · due in 16 working hours');
      expect(first).toContain('Quality Officer, Cardiology');
      expect(second).toContain('Quality Officer, Cardiology · Nora Al-Otaibi');
      expect(third).toContain('Optional');
      expect(third).toContain('Critical · due in 4 working hours');
      expect(third).toContain('Secretary of the Quality Assurance Committee');
    });

    it('carries the warning chip only where the server said so', () => {
      const { rows } = setup();
      expect(rows().map((r) => !!r.querySelector('[data-stage-task-warning]'))).toEqual([false, false, true]);
      expect(rows()[2].querySelector('[data-stage-task-warning]')?.textContent).toContain('Nobody has this role');
    });

    // D3 — who holds a relative route is known only when a record enters.
    it('words the relative routes, with no chip', () => {
      const { rows } = setup({
        rows: [
          definition({ id: 'r1', assignKind: 'RECORD_UNIT_POSITION', orgUnitId: null, orgUnit: null }),
          definition({
            id: 'r2',
            assignKind: 'RECORD_COMMITTEE_ROLE',
            orgUnitId: null,
            positionId: null,
            orgUnit: null,
            position: null,
            committeeRoleValueId: 'role-sec',
            committeeRole: { id: 'role-sec', labelEn: 'Secretary', labelAr: null },
          }),
        ],
      });
      expect(rows()[0].textContent).toContain("Quality Officer in the record's unit");
      expect(rows()[1].textContent).toContain("Secretary of the record's committee");
      expect(rows().some((r) => r.querySelector('[data-stage-task-warning]'))).toBeFalse();
    });
  });

  describe('who may change it', () => {
    it('shows no action to someone without workflows:manage', () => {
      const { el } = setup({ canManage: false });
      expect(el.querySelectorAll('am-icon-button').length).toBe(0);
      expect(Array.from(el.querySelectorAll('button')).some((b) => b.textContent?.includes('Add task'))).toBeFalse();
    });

    it('names each action after its task, and leaves out the arrows that cannot move', () => {
      const { rows } = setup();
      const labels = (row: HTMLElement) =>
        Array.from(row.querySelectorAll('am-icon-button button')).map((b) => b.getAttribute('aria-label'));
      expect(labels(rows()[0])).toEqual([
        'Move down: Interview the staff involved',
        'Edit Interview the staff involved',
        'Delete Interview the staff involved',
      ]);
      expect(labels(rows()[1])).toEqual([
        'Move up: Collect the records',
        'Move down: Collect the records',
        'Edit Collect the records',
        'Delete Collect the records',
      ]);
      expect(labels(rows()[2])[0]).toBe('Move up: Inform the committee');
      expect(labels(rows()[2])).not.toContain('Move down: Inform the committee');
    });
  });

  describe('reordering by keyboard', () => {
    it('sends the new order, keeps focus on the moved row, and announces the move', async () => {
      const { fixture, el, rows } = setup();
      const down = rows()[0].querySelector<HTMLButtonElement>('[data-move="def-1:down"] button')!;
      down.focus();
      down.click();

      const req = http.expectOne(`${API}/stages/stage-1/task-definitions/order`);
      expect(req.request.body).toEqual({ ids: ['def-2', 'def-1', 'def-3'] });
      req.flush([THREE[1], THREE[0], THREE[2]]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rows().map((r) => r.getAttribute('data-stage-task'))).toEqual(['def-2', 'def-1', 'def-3']);
      expect(document.activeElement).toBe(el.querySelector('[data-move="def-1:down"] button'));
      expect(el.querySelector('[data-stage-tasks-announcement]')?.textContent?.trim()).toBe(
        '“Interview the staff involved” moved to position 2 of 3',
      );
    });

    it("moves focus to the row's other arrow when the one pressed has gone", async () => {
      const { fixture, el, rows } = setup();
      rows()[1].querySelector<HTMLButtonElement>('[data-move="def-2:up"] button')!.click();
      http.expectOne(`${API}/stages/stage-1/task-definitions/order`).flush([THREE[1], THREE[0], THREE[2]]);
      fixture.detectChanges();
      await fixture.whenStable();

      // def-2 is now first: it has no ↑, so focus is on its ↓.
      expect(el.querySelector('[data-move="def-2:up"]')).toBeNull();
      expect(document.activeElement).toBe(el.querySelector('[data-move="def-2:down"] button'));
    });

    it('reloads and says so when someone else changed the list first', () => {
      const { fixture, el, rows } = setup();
      rows()[0].querySelector<HTMLButtonElement>('[data-move="def-1:down"] button')!.click();
      http
        .expectOne(`${API}/stages/stage-1/task-definitions/order`)
        .flush({ statusCode: 400, code: 'STAGE_TASK_ORDER_MISMATCH', message: 'x' }, { status: 400, statusText: 'Bad Request' });
      http.expectOne(`${API}/stages/stage-1/task-definitions`).flush(THREE.slice(0, 2));
      fixture.detectChanges();

      expect(rows().length).toBe(2);
      expect(el.querySelector('.am-stage-tasks__action-error')?.textContent?.trim()).toBe(
        'Someone else changed this list, so it has been reloaded.',
      );
    });
  });

  describe('delete', () => {
    it('says what stays, how many tasks it already made and the longest task after, then deletes', async () => {
      const { fixture, rows } = setup();
      rows()[1].querySelectorAll<HTMLButtonElement>('am-icon-button button')[3].click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      const dialog = document.querySelector('.p-dialog') as HTMLElement;
      expect(dialog).withContext('the delete dialog did not open').not.toBeNull();
      const dialogText = dialog.textContent?.replace(/\s+/g, ' ') ?? '';
      expect(dialogText).toContain('Delete this task?');
      expect(dialogText).toContain('Committee Management · Terms Review · task 2 of 3');
      expect(dialogText).toContain(
        "Delete “Collect the records”? New records entering this stage won't get it. Tasks already created from it stay.",
      );
      expect(dialog.querySelector('[data-delete-created]')?.textContent?.trim()).toBe('7 tasks · they stay');
      expect(dialog.querySelector('[data-delete-longest]')?.textContent?.trim()).toBe('16 working hours');

      (dialog.querySelector('[data-delete-confirm] button') as HTMLButtonElement).click();
      const req = http.expectOne(`${API}/task-definitions/def-2`);
      expect(req.request.method).toBe('DELETE');
      req.flush(null);
      fixture.detectChanges();

      expect(rows().map((r) => r.getAttribute('data-stage-task'))).toEqual(['def-1', 'def-3']);
      expect(fixture.componentInstance.summaries.at(-1)).toEqual({ taskDefinitionCount: 2, longestTaskHours: 16 });
    });
  });

  describe('in Arabic', () => {
    it('leads with the Arabic title, falls back to English, and counts hours in Arabic', () => {
      const { rows, text } = setup({ language: 'ar' });
      const first = rows()[0].textContent?.replace(/\s+/g, ' ') ?? '';
      expect(first).toContain('مقابلة الموظفين المعنيين');
      expect(first).not.toContain('Interview the staff involved');
      // No Arabic title: the English one stands.
      expect(rows()[1].textContent).toContain('Collect the records');
      expect(first).toContain('عالية · مستحقة خلال 16 ساعة عمل');
      expect(first).toContain('مسؤول الجودة، أمراض القلب');
      expect(text('[data-stage-tasks-summary]')).toBe('مهلة المرحلة: 40 ساعة عمل · أطول مهمة: 16');
    });

    it('uses every Arabic plural form for working hours', () => {
      setup({ language: 'ar', rows: [] });
      const format = (n: number) => TestBed.inject(FormatService).count('workflow.workingHours', n);
      expect([1, 2, 3, 11, 100].map(format)).toEqual([
        'ساعة عمل واحدة',
        'ساعتا عمل',
        '3 ساعات عمل',
        '11 ساعة عمل',
        '100 ساعة عمل',
      ]);
    });
  });

  it('offers Retry when the list cannot load', () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/stages/stage-1/task-definitions`).flush('down', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-stage-tasks-error]')?.textContent).toContain("Couldn't load this stage's tasks.");

    (el.querySelector('[data-stage-tasks-error] button') as HTMLButtonElement).click();
    http.expectOne(`${API}/stages/stage-1/task-definitions`).flush(THREE);
    fixture.detectChanges();
    expect(el.querySelectorAll('[data-stage-task]').length).toBe(3);
  });
});
