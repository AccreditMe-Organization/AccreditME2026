import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { environment } from '../../../../../environments/environment';
import en from '../../../../../assets/i18n/en.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { ITaskDto } from '../../services/task.service';
import { COMMITTEE_SCOPE } from '../task-assignee-picker/task-assignee-picker.component';
import { TaskReassignDialogComponent, TaskRejection } from './task-reassign-dialog.component';

// ACC-163 — the reassign dialog, extracted from Unassigned tasks so the
// committee record can host it for a rejected task's creator (Q4).
//
// ACC-167 — who the task goes to is now chosen with the assignment picker
// (unit, position, optional person; or a committee role), and sent as
// `assignTo`. The picker passes the task's id, and nothing here reads the
// tenant's user list: that is ACC-166's fix, and the test that proves it is
// "never asks for /users".

const TASK = {
  id: 'task-1',
  title: 'Review incident report',
  sourceType: 'DOCUMENT',
  sourceId: 'doc-1',
} as ITaskDto;
const COMMITTEE_TASK = { ...TASK, sourceType: 'COMMITTEE', sourceId: 'committee-1' } as ITaskDto;

const API = `${environment.apiUrl}/tasks`;
const REASSIGN_URL = `${API}/task-1/reassign`;

@Component({
  standalone: true,
  imports: [TaskReassignDialogComponent],
  template: `
    <app-task-reassign-dialog
      [visible]="visible()"
      (visibleChange)="visible.set($event)"
      [task]="task()"
      [rejection]="rejection()"
      [recordName]="recordName()"
      [committeeName]="committeeName()"
      (reassigned)="reassignedCount = reassignedCount + 1"
    />
  `,
})
class HostComponent {
  readonly visible = signal(true);
  readonly rejection = signal<TaskRejection | null>(null);
  readonly recordName = signal<string | null>(null);
  readonly committeeName = signal<string | null>(null);
  readonly task = signal<ITaskDto>(TASK);
  reassignedCount = 0;
}

describe('TaskReassignDialogComponent (ACC-163, ACC-167)', () => {
  let http: HttpTestingController;

  function setup(
    options: {
      rejection?: TaskRejection;
      task?: ITaskDto;
      unitsStatus?: number;
      permissions?: string[];
      recordName?: string;
      committeeName?: string;
    } = {},
  ) {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => (options.permissions ?? []).includes(p) },
        },
      ],
    });
    // The real English file: these tests read what a user reads.
    loadTranslationsForTest({ en });
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(HostComponent);
    if (options.rejection) fixture.componentInstance.rejection.set(options.rejection);
    if (options.task) fixture.componentInstance.task.set(options.task);
    if (options.recordName) fixture.componentInstance.recordName.set(options.recordName);
    if (options.committeeName) fixture.componentInstance.committeeName.set(options.committeeName);
    fixture.detectChanges();

    const units = http.expectOne((r) => r.url === `${API}/assignment/units`);
    expect(units.request.params.get('taskId')).toBe('task-1');
    if (options.unitsStatus) {
      units.flush({ message: 'Task not found' }, { status: options.unitsStatus, statusText: 'Not Found' });
    } else {
      units.flush([{ id: 'unit-1', parentId: null, nameEn: 'Pharmacy', nameAr: null }]);
    }
    fixture.detectChanges();

    const dialog = fixture.debugElement.query(By.directive(TaskReassignDialogComponent))
      .componentInstance as TaskReassignDialogComponent;
    return { fixture, dialog };
  }

  // Choosing a unit fetches its positions; choosing a position fetches its
  // holders. Both answered here, each asked with the task's id.
  function choosePosition(dialog: TaskReassignDialogComponent): void {
    dialog.form.controls.assignTo.controls.scope.setValue('unit-1');
    const positions = http.expectOne((r) => r.url === `${API}/assignment/positions`);
    expect(positions.request.params.get('orgUnitId')).toBe('unit-1');
    expect(positions.request.params.get('taskId')).toBe('task-1');
    positions.flush([{ id: 'pos-1', nameEn: 'Pharmacist', nameAr: null, isSingleAssignee: false, holderCount: 3 }]);

    dialog.form.controls.assignTo.controls.target.setValue('pos-1');
    http.expectOne((r) => r.url === `${API}/assignees`).flush([]);
  }

  afterEach(() => http.verify());

  it('sends assignTo and the trimmed reason, then tells the host and closes', () => {
    const { fixture, dialog } = setup();

    choosePosition(dialog);
    dialog.form.controls.reason.setValue('  Pharmacy owns this ');
    dialog.submit();

    const req = http.expectOne(REASSIGN_URL);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({
      assignTo: { kind: 'POSITION', orgUnitId: 'unit-1', positionId: 'pos-1' },
      reason: 'Pharmacy owns this',
    });
    req.flush({ ...TASK, status: 'PENDING' });

    expect(fixture.componentInstance.reassignedCount).toBe(1);
    expect(fixture.componentInstance.visible()).toBe(false);
  });

  it('sends the chosen person with the target', () => {
    const { dialog } = setup();

    choosePosition(dialog);
    dialog.form.controls.assignTo.controls.userId.setValue('user-a');
    dialog.form.controls.reason.setValue('Sarah has the context');
    dialog.submit();

    expect(http.expectOne(REASSIGN_URL).request.body.assignTo).toEqual({
      kind: 'POSITION',
      orgUnitId: 'unit-1',
      positionId: 'pos-1',
      userId: 'user-a',
    });
  });

  // ACC-199 — "Assign … instead" was pressed: the claim goes with the save while
  // that person is still the one chosen, and not once someone else is.
  it('sends the AI suggestion claim only while the suggested person is still chosen', () => {
    const { dialog } = setup();

    choosePosition(dialog);
    dialog.workloadFollowed.set({ id: 'log-7', userId: 'user-a' });
    dialog.form.controls.assignTo.controls.userId.setValue('user-a');
    dialog.form.controls.reason.setValue('Sarah has room');
    dialog.submit();
    const first = http.expectOne(REASSIGN_URL);
    expect(first.request.body.aiWorkloadHint).toEqual({ id: 'log-7' });
    first.flush({ ...TASK, status: 'PENDING' });
  });

  it('sends no AI suggestion claim when someone else was chosen after it', () => {
    const { dialog } = setup();

    choosePosition(dialog);
    dialog.workloadFollowed.set({ id: 'log-7', userId: 'user-a' });
    dialog.form.controls.assignTo.controls.userId.setValue('user-b');
    dialog.form.controls.reason.setValue('Omar instead');
    dialog.submit();
    expect(http.expectOne(REASSIGN_URL).request.body).not.toEqual(jasmine.objectContaining({ aiWorkloadHint: jasmine.anything() }));
  });

  // A reassignment has to name somewhere: a unit alone is not a target.
  it('does not submit without a unit, a position and a reason', () => {
    const { dialog } = setup();

    dialog.submit();
    expect(dialog.form.invalid).toBe(true);
    expect(dialog.showErrors()).toBe(true);

    dialog.form.controls.assignTo.controls.scope.setValue('unit-1');
    http.expectOne((r) => r.url === `${API}/assignment/positions`).flush([]);
    dialog.form.controls.reason.setValue('x');
    dialog.submit();

    expect(dialog.form.controls.assignTo.controls.target.hasError('required')).toBe(true);
    http.expectNone(REASSIGN_URL);
  });

  // ACC-166 — the dialog used to read /users, which needs users:view; a
  // creator without it could not reassign their own rejected task.
  it("never asks for the tenant's user list", () => {
    const { dialog } = setup();

    choosePosition(dialog);

    http.expectNone((r) => r.url.startsWith(`${environment.apiUrl}/users`));
  });

  it('tells a caller the picker refused, and does not send', () => {
    const { dialog } = setup({ unitsStatus: 404 });

    expect(document.body.textContent).toContain('You cannot choose who this task goes to.');
    dialog.form.controls.reason.setValue('x');
    dialog.submit();
    http.expectNone(REASSIGN_URL);
  });

  it("sends a committee role, on the task's own committee, for a committee task", () => {
    const { dialog } = setup({ task: COMMITTEE_TASK, permissions: ['committees:view'] });

    dialog.form.controls.assignTo.controls.scope.setValue(COMMITTEE_SCOPE);
    const roles = http.expectOne((r) => r.url === `${API}/assignment/committee-roles`);
    expect(roles.request.params.get('committeeId')).toBe('committee-1');
    roles.flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: 2 }]);
    dialog.form.controls.assignTo.controls.target.setValue('role-sec');
    http.expectOne((r) => r.url === `${API}/assignees/committee`).flush([]);
    dialog.form.controls.reason.setValue('The secretary keeps the minutes');
    dialog.submit();

    expect(http.expectOne(REASSIGN_URL).request.body.assignTo).toEqual({
      kind: 'COMMITTEE_ROLE',
      committeeId: 'committee-1',
      roleValueId: 'role-sec',
    });
  });

  // ACC-120 slice 4 (Task Screens, Reassign) — "Reassign task", with the
  // task and its record as the context line.
  it('is headed "Reassign task", with the task and its record as the context line', () => {
    setup({ recordName: 'Infection Control Committee' });

    const header = document.querySelector('.p-dialog-header')!.textContent!;
    expect(header).toContain('Reassign task');
    expect(header).toContain('Review incident report · ◇ Infection Control Committee');
  });

  it('the context line is the title alone when the host names no record', () => {
    setup();
    const header = document.querySelector('.p-dialog-header')!.textContent!;
    expect(header).toContain('Review incident report');
    expect(header).not.toContain('◇');
  });

  it('states the rejection it acts on: "Rejected by … · date" over the reason in a grey box of two lines', () => {
    const reason = 'This belongs to Pharmacy, who hold the stock records for every ward and should check them first.';
    setup({ rejection: { byName: 'Sarah', reason, at: '2026-10-05T09:12:00.000Z' } });

    const label = document.querySelector('[data-testid="reassign-rejection-label"]')!;
    expect(label.textContent!.trim()).toBe('Rejected by Sarah · 5 Oct 2026');
    // No uppercase strip: the label reads as written.
    expect(getComputedStyle(label).textTransform).toBe('none');

    const box = document.querySelector('[data-testid="reassign-rejection-reason"]') as HTMLElement;
    expect(box.textContent!.trim()).toBe(`“${reason}”`);
    expect(box.getAttribute('title')).toBe(reason);
    // Two lines at most, clamped inside the padding so no third line shows.
    const lines = box.querySelector('[data-testid="reassign-rejection-text"]') as HTMLElement;
    expect(lines.classList).toContain('line-clamp-2');
    expect(lines.getBoundingClientRect().height).toBeLessThanOrEqual(2 * 18 + 1);
    expect(lines.getBoundingClientRect().bottom).toBeLessThanOrEqual(box.getBoundingClientRect().bottom - 5);
    expect(getComputedStyle(box).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  });

  it('a rejection with no name or date still says it was rejected', () => {
    setup({ rejection: { byName: null, reason: 'Wrong unit' } });
    expect(document.querySelector('[data-testid="reassign-rejection-label"]')!.textContent!.trim()).toBe('Rejected');
  });

  // The fields in the drawn order: the unit (or committee) across, then the
  // seat and the person side by side, then the outcome across.
  describe('field order and the outcome line (ACC-120 slice 4)', () => {
    const labels = (): string[] =>
      Array.from(document.querySelectorAll('.am-picker--split .am-field__label')).map((l) => l.textContent!.replace('*', '').trim());
    const box = (label: string): DOMRect => {
      const field = Array.from(document.querySelectorAll('.am-picker--split am-field')).find(
        (f) => f.querySelector('.am-field__label')!.textContent!.replace('*', '').trim() === label,
      )!;
      return field.getBoundingClientRect();
    };
    const outcome = (): string => document.querySelector('[data-testid="picker-outcome"]')?.textContent?.trim() ?? '';

    it('a unit: Unit across, then Position | Person, then "Offered to …"', () => {
      const { fixture, dialog } = setup();
      dialog.form.controls.assignTo.controls.scope.setValue('unit-1');
      http
        .expectOne((r) => r.url === `${API}/assignment/positions`)
        .flush([{ id: 'pos-1', nameEn: 'Pharmacist', nameAr: null, isSingleAssignee: false, holderCount: 3 }]);
      dialog.form.controls.assignTo.controls.target.setValue('pos-1');
      http
        .expectOne((r) => r.url === `${API}/assignees`)
        .flush([{ id: 'user-a', name: 'Sarah Al-Harbi', positionNameEn: 'Pharmacist', positionNameAr: null }]);
      fixture.detectChanges();

      expect(labels()).toEqual(['Unit', 'Position', 'Person (optional)']);
      const unit = box('Unit');
      const position = box('Position');
      const person = box('Person (optional)');
      expect(unit.width).toBeGreaterThan(0);
      expect(position.top).toBeGreaterThan(unit.top);
      expect(person.top).toBe(position.top);
      expect(unit.width).toBeGreaterThan(position.width * 1.8);
      expect(outcome()).toBe('Offered to Pharmacist, Pharmacy (3 people).');

      dialog.form.controls.assignTo.controls.userId.setValue('user-a');
      fixture.detectChanges();
      expect(outcome()).toBe('Goes straight to Sarah Al-Harbi (Pharmacist).');
      // Never promises a notice.
      expect(outcome()).not.toMatch(/notif|told|email/i);
    });

    it('a committee: Member role | Member, then "Offered to …"', () => {
      const { fixture, dialog } = setup({
        task: COMMITTEE_TASK,
        permissions: ['committees:view'],
        committeeName: 'Infection Control Committee',
      });
      dialog.form.controls.assignTo.controls.scope.setValue(COMMITTEE_SCOPE);
      http
        .expectOne((r) => r.url === `${API}/assignment/committee-roles`)
        .flush([{ id: 'role-sec', labelEn: 'Secretary', labelAr: null, memberCount: 2 }]);
      dialog.form.controls.assignTo.controls.target.setValue('role-sec');
      http.expectOne((r) => r.url === `${API}/assignees/committee`).flush([]);
      fixture.detectChanges();

      expect(labels()).toEqual(['Unit or committee', 'Member role', 'Member (optional)']);
      expect(box('Member (optional)').top).toBe(box('Member role').top);
      expect(box('Member role').top).toBeGreaterThan(box('Unit or committee').top);
      expect(outcome()).toBe('Offered to Secretary, Infection Control Committee (2 people).');
    });

    it('the reason field reads "Reassignment reason", in sentence case', () => {
      setup();
      const all = Array.from(document.querySelectorAll('am-field .am-field__label')).map((l) => l.textContent!.replace('*', '').trim());
      expect(all).toContain('Reassignment reason');
    });
  });
});
