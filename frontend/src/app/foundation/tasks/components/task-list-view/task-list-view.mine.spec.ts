import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { TestFormatContext } from '../../../../core/formatting/format-context';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskListViewComponent } from './task-list-view.component';
import { ITaskRecordListDto, TaskRecordListStatus, TaskRecordListView } from '../../services/task.service';
import { NO_ACTIONS, listPage, recordRow } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-120 slice 3 — My tasks on the shared list (view mine), the behaviours
// MyTasksComponent's spec held for its list, carried here: its own columns
// (Task · record, Priority as text, Due, Status), no "Assigned to me" and no
// assignee filter, the record's name, the empty text, chip counts from the
// first page's facets (Created by me too), due dates in the tenant's zone with
// Latin digits, no Overdue on a held or closed row, and Complete disabled,
// saying why, while evidence is missing.

const LIST = `${environment.apiUrl}/tasks/record-list`;

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<app-task-list-view variant="page" [view]="view()" />`,
})
class HostComponent {
  readonly view = signal<TaskRecordListView | null>('mine');
}

const COUNTS: Record<TaskRecordListStatus, number> = {
  UNASSIGNED: 2,
  PENDING: 4,
  IN_PROGRESS: 3,
  ON_HOLD: 1,
  REJECTED: 5,
  COMPLETED: 12,
  CANCELLED: 0,
};
const FACETS = { people: [], pools: [], recordTypes: ['COMMITTEE'], units: [], statusCounts: COUNTS };

describe('TaskListViewComponent — My tasks (view mine, ACC-120 slice 3)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  function setup(over: { view?: TaskRecordListView; language?: 'en' | 'ar'; zone?: string; phone?: boolean } = {}): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(over.language ?? 'en');
    TestBed.inject(TestFormatContext).zone.set(over.zone ?? 'Asia/Riyadh');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    if (over.view) fixture.componentInstance.view.set(over.view);
    el = fixture.nativeElement;
    fixture.detectChanges();
    // The test browser is phone-narrow: the columns are the desktop layout's.
    list().phone.set(over.phone ?? false);
    fixture.detectChanges();
  }

  const next = (): TestRequest => http.expectOne((r) => r.url === LIST);
  const list = () => fixture.debugElement.children[0]!.componentInstance as TaskListViewComponent;
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const chipLabels = () => Array.from(q('task-list-status-chips')!.querySelectorAll('button')).map((b) => text(b));
  function answer(body: ITaskRecordListDto): void {
    next().flush(body);
    fixture.detectChanges();
  }

  describe('the toolbar', () => {
    it('offers no "Assigned to me" and no assignee or pool filter', () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine' }));
      expect(q('task-list-toolbar')).withContext('non-vacuity: the toolbar rendered').not.toBeNull();
      expect(q('task-list-status-chips')).withContext('non-vacuity: the chips are there').not.toBeNull();
      expect(q('filter-mine')).toBeNull();
      expect(q('filter-who')).toBeNull();
      // The filters a person still uses stay.
      expect(q('filter-overdue')).not.toBeNull();
      expect(q('filter-due')).not.toBeNull();
    });

    it('leaves both on Created by me', () => {
      setup({ view: 'created' });
      answer(listPage([recordRow('t1')], { view: 'created' }));
      expect(q('filter-mine')).not.toBeNull();
      expect(q('filter-who')).not.toBeNull();
    });
  });

  describe('the columns', () => {
    it('heads Task · record, Priority, Due and Status, with Priority not sortable', () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine' }));
      const head = q('task-list-head')!;
      // The sorted column carries its ▲ (it opens on due, soonest first).
      expect(Array.from(head.children).map((c) => text(c).replace(/[▲▼]/g, ''))).toEqual(['Task · record', 'Priority', 'Due', 'Status', 'Actions']);
      expect(text(head.children[2]!)).toBe('Due▲');
      // Task, Due and Status are headers you press; Priority is plain text.
      expect(head.querySelectorAll('am-sort-header').length).toBe(3);
      expect(q('task-list-col-priority')!.querySelector('button')).toBeNull();
      // No Assignee, Created by or Updated column here.
      expect(text(head)).not.toContain('Assignee');
      expect(text(head)).not.toContain('Created by');
    });

    it('writes Priority as text: "▲ High", "!! Critical", the others plain', () => {
      setup();
      answer(
        listPage(
          [recordRow('h', { priority: 'HIGH' }), recordRow('c', { priority: 'CRITICAL' }), recordRow('m', { priority: 'MEDIUM' }), recordRow('l', { priority: 'LOW' })],
          { view: 'mine' },
        ),
      );
      const cells = Array.from(el.querySelectorAll('[data-testid="task-list-priority"]'));
      expect(cells.map((c) => text(c))).toEqual(['▲ High', '!! Critical', 'Medium', 'Low']);
      // Text, never colour: no tag, no tone.
      expect(cells.some((c) => c.querySelector('p-tag, [data-tone]'))).toBeFalse();
      // The glyph is decoration beside the word.
      expect(cells[0]!.querySelector('[aria-hidden="true"]')!.textContent).toContain('▲');
    });

    it('writes Priority in Arabic', () => {
      setup({ language: 'ar' });
      answer(listPage([recordRow('h', { priority: 'HIGH' })], { view: 'mine' }));
      expect(text(q('task-list-priority'))).toBe('▲ عالية');
      expect(text(q('task-list-head')!.children[0]!)).toBe('المهمة · السجل');
    });

    it('names the record, never its raw type', () => {
      setup();
      answer(
        listPage(
          [
            recordRow('n', { record: { type: 'COMMITTEE', id: 'c-9', nameEn: 'Quality Committee', nameAr: null } }),
            recordRow('u', { record: { type: 'COMMITTEE', id: 'c-hidden', nameEn: null, nameAr: null } }),
          ],
          { view: 'mine' },
        ),
      );
      const records = Array.from(el.querySelectorAll('[data-testid="task-list-record"]')).map((r) => text(r));
      expect(records).toEqual(['Quality Committee', 'Committee']);
      expect(text(el)).not.toContain('COMMITTEE');
    });

    it('says why My tasks is empty', () => {
      setup();
      answer(listPage([], { view: 'mine' }));
      expect(text(q('task-list-empty'))).toContain('Nothing open for you');
      expect(text(q('task-list-empty'))).toContain("Tasks you're given on any record appear here.");
    });

    it('has no fixed-height frame: the page scrolls as one', () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine' }));
      const frame = q('task-list-view')!;
      expect(frame.classList).not.toContain('am-tl--page');
      // Non-vacuity: Created by me keeps its fixed-height frame.
      setup({ view: 'created' });
      answer(listPage([recordRow('t1')], { view: 'created' }));
      expect(q('task-list-view')!.classList).toContain('am-tl--page');
    });
  });

  describe('the chip counts', () => {
    it("counts My tasks' chips from statusCounts; All open is the sum of its open set", () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine', facets: FACETS }));
      // Open on mine: Assigned 4 + In progress 3 + On hold 1.
      expect(chipLabels()).toEqual(['All open · 8', 'Assigned · 4', 'In progress · 3', 'On hold · 1', 'Completed · 12', 'Cancelled · 0']);
    });

    it("counts Created by me's chips, its open set including Unassigned and Rejected", () => {
      setup({ view: 'created' });
      answer(listPage([recordRow('t1')], { view: 'created', facets: FACETS }));
      // 2 + 4 + 3 + 1 + 5.
      expect(chipLabels()[0]).toBe('All open · 15');
      expect(chipLabels()).toContain('Rejected · 5');
      expect(chipLabels()).toContain('Unassigned · 2');
    });

    it('shows no count when the server sent none', () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine', facets: { people: [], pools: [], recordTypes: [], units: [] } }));
      expect(chipLabels()).toEqual(['All open', 'Assigned', 'In progress', 'On hold', 'Completed', 'Cancelled']);
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine', facets: null }));
      expect(chipLabels()[0]).toBe('All open');
    });

    it('keeps the counts while a chip narrows the list (they are over the whole view)', () => {
      setup();
      answer(listPage([recordRow('t1')], { view: 'mine', facets: FACETS }));
      q('task-list-status-chips')!.querySelector<HTMLButtonElement>('[data-chip="COMPLETED"]')!.click();
      fixture.detectChanges();
      // A later page carries no facets: the first page's stay.
      answer(listPage([], { view: 'mine', facets: null }));
      expect(chipLabels()[0]).toBe('All open · 8');
    });

    it('counts with Latin digits in Arabic', () => {
      setup({ language: 'ar' });
      answer(listPage([recordRow('t1')], { view: 'mine', facets: FACETS }));
      expect(chipLabels()[0]).toBe('كل المفتوحة · 8');
    });
  });

  describe('due dates', () => {
    // 21:30 UTC on 15 Sep: still the 15th in New York, the 16th in Riyadh.
    const due = (zone: string, language: 'en' | 'ar' = 'en') => {
      setup({ zone, language });
      answer(listPage([recordRow('t1', { dueAt: '2099-09-15T21:30:00.000Z' })], { view: 'mine' }));
      return text(q('task-list-due'));
    };

    it("shows the due date in the tenant's time zone", () => {
      expect(due('America/New_York')).toBe('Due 15 Sep 2099');
      expect(due('Asia/Riyadh')).toBe('Due 16 Sep 2099');
    });

    it('writes the month in Arabic, with Latin digits', () => {
      expect(due('Asia/Riyadh', 'ar')).toBe('تستحق 16 سبتمبر 2099');
    });
  });

  describe('Overdue', () => {
    const PAST = '2020-01-01T05:00:00.000Z';
    it('never on a held or closed row', () => {
      setup();
      answer(
        listPage(
          [
            recordRow('late', { status: 'IN_PROGRESS', dueAt: PAST }),
            recordRow('held', { status: 'ON_HOLD', dueAt: PAST, onHoldUntil: '2099-01-01T05:00:00.000Z' }),
            recordRow('done', { status: 'COMPLETED', dueAt: PAST, completedAt: PAST }),
            recordRow('gone', { status: 'CANCELLED', dueAt: PAST, cancelledAt: PAST }),
          ],
          { view: 'mine' },
        ),
      );
      const flagged = Array.from(el.querySelectorAll('[data-task-row]'))
        .filter((r) => r.querySelector('[data-testid="task-list-overdue"]'))
        .map((r) => r.getAttribute('data-task-row'));
      expect(flagged).toEqual(['late']);
      // The pill sits in the Status column, beside the status.
      const status = el.querySelector('[data-task-row="late"] [data-testid="task-list-status"]')!;
      expect(Array.from(status.children).map((c) => text(c))).toEqual(['In progress', 'Overdue']);
      expect(el.querySelectorAll('[data-task-row]').length).toBe(4);
    });
  });

  describe('Complete while evidence is missing', () => {
    it('is disabled, and says why', () => {
      setup();
      answer(
        listPage(
          [
            recordRow('ev', { status: 'IN_PROGRESS', requiresEvidence: true, actions: { ...NO_ACTIONS, complete: true, completeNeedsEvidence: true, primary: 'COMPLETE' } }),
            recordRow('ok', { status: 'IN_PROGRESS', actions: { ...NO_ACTIONS, complete: true, primary: 'COMPLETE' } }),
          ],
          { view: 'mine' },
        ),
      );
      const blocked = el.querySelector<HTMLButtonElement>('[data-task-row="ev"] [data-action="complete"]')!;
      expect(blocked.disabled).toBeTrue();
      expect(blocked.getAttribute('title')).toBe('Add evidence before completing');
      const open = el.querySelector<HTMLButtonElement>('[data-task-row="ok"] [data-action="complete"]')!;
      expect(open.disabled).toBeFalse();
      expect(open.getAttribute('title')).toBeNull();
    });
  });

  describe('a phone', () => {
    it('reads due · priority · status on the card, with no "who" (every row is the viewer\'s)', () => {
      setup({ phone: true });
      answer(listPage([recordRow('t1', { priority: 'HIGH', status: 'IN_PROGRESS' })], { view: 'mine' }));
      const row = el.querySelector('[data-task-row="t1"]')!;
      expect(text(row)).toContain('· High · In progress');
      expect(text(row)).not.toContain('Dr. Sara Al-Qahtani');
    });
  });
});
