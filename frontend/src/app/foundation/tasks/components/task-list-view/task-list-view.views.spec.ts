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
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskListViewComponent } from './task-list-view.component';
import { TaskRecordListView } from '../../services/task.service';
import { NO_ACTIONS, listPage, recordRow } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-120 slice 3 — the organisation-wide views of /tasks: each sends its view
// (and a chosen Record type or Unit), the two filters come from the response's
// facets, a 403 is the denied state with the server's sentence, an empty view
// says why, and a Setup health Fix's task opens Reassign when its row offers it.

const LIST = `${environment.apiUrl}/tasks/record-list`;

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<app-task-list-view
    variant="page"
    [view]="view()"
    [recordType]="recordType()"
    [unit]="unit()"
    [unitFilter]="unitFilter()"
    [around]="around()"
    [openAction]="openAction()"
  />`,
})
class HostComponent {
  readonly view = signal<TaskRecordListView | null>('all');
  readonly recordType = signal<string | null>(null);
  readonly unit = signal<string | null>(null);
  readonly unitFilter = signal(false);
  readonly around = signal<string | null>(null);
  readonly openAction = signal<'reassign' | null>(null);
}

type HostSetup = Partial<{
  view: TaskRecordListView | null;
  recordType: string | null;
  unit: string | null;
  unitFilter: boolean;
  around: string | null;
  openAction: 'reassign' | null;
  language: 'en' | 'ar';
}>;

describe('TaskListViewComponent — the views of /tasks (ACC-120 slice 3)', () => {
  // First, so it runs last: the Arabic test switches the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  function setup(over: HostSetup = {}): void {
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
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    const host = fixture.componentInstance;
    if ('view' in over) host.view.set(over.view!);
    if ('recordType' in over) host.recordType.set(over.recordType!);
    if ('unit' in over) host.unit.set(over.unit!);
    if ('unitFilter' in over) host.unitFilter.set(over.unitFilter!);
    if ('around' in over) host.around.set(over.around!);
    if ('openAction' in over) host.openAction.set(over.openAction!);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  const next = (): TestRequest => http.expectOne((r) => r.url === LIST);
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const list = () => fixture.debugElement.children[0]!.componentInstance as TaskListViewComponent;
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();
  function answer(req: TestRequest, body: object): void {
    req.flush(body);
    fixture.detectChanges();
  }
  /** Opens an overlay select in the toolbar and reads its options. */
  function optionsOf(testId: string): string[] {
    q(testId)!.querySelector<HTMLElement>('.am-overlay-select-trigger')!.click();
    fixture.detectChanges();
    const options = Array.from(document.querySelectorAll('[role="option"]')).map((o) => text(o));
    // Emptied, not removed: the overlay keeps its container for the next select.
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => (n.innerHTML = ''));
    return options;
  }

  const UNITS = [
    { id: 'u-ph', nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
    { id: 'u-cn', nameEn: 'Clinical Nutrition', nameAr: 'التغذية العلاجية' },
  ];
  const facets = { people: [], pools: [], recordTypes: ['COMMITTEE', 'MEETING'], units: UNITS };

  describe('what each view sends', () => {
    for (const view of ['all', 'unit', 'unassigned'] as const) {
      it(`sends view=${view}, and no record`, () => {
        setup({ view });
        const req = next();
        expect(req.request.params.get('view')).toBe(view);
        expect(req.request.params.has('sourceType')).toBeFalse();
        answer(req, listPage([], { view }));
      });
    }

    it('sends the record type and unit it was opened with', () => {
      setup({ view: 'unit', recordType: 'COMMITTEE', unit: 'u-ph', unitFilter: true });
      const req = next();
      expect(req.request.params.get('view')).toBe('unit');
      expect(req.request.params.get('recordType')).toBe('COMMITTEE');
      expect(req.request.params.get('unit')).toBe('u-ph');
      answer(req, listPage([], { view: 'unit', facets }));
    });

    it('sends a record type chosen in the toolbar, from the first page', () => {
      setup({ view: 'all' });
      answer(next(), listPage([], { view: 'all', facets }));
      list().recordTypeSel.set('MEETING');
      fixture.detectChanges();
      const req = next();
      expect(req.request.params.get('recordType')).toBe('MEETING');
      expect(req.request.params.get('skip')).toBe('0');
      answer(req, listPage([], { view: 'all', facets }));
    });
  });

  describe('the filters come from the facets', () => {
    it('offers the record types the response names, by name', () => {
      setup({ view: 'all' });
      answer(next(), listPage([recordRow('t1')], { view: 'all', facets }));
      expect(optionsOf('filter-record-type')).toEqual(['Committee', 'Meeting']);
    });

    it('shows the Unit filter on the unit view only when the scope holds more than one top-level unit', () => {
      setup({ view: 'unit', unitFilter: true });
      answer(next(), listPage([recordRow('t1')], { view: 'unit', facets }));
      expect(optionsOf('filter-unit')).toEqual(['Pharmacy', 'Clinical Nutrition']);

      setup({ view: 'unit', unitFilter: false });
      answer(next(), listPage([recordRow('t1')], { view: 'unit', facets }));
      expect(q('filter-unit')).toBeNull();
      expect(q('filter-record-type')).withContext('non-vacuity: the toolbar rendered').not.toBeNull();
    });

    it('offers no Record type or Unit filter on Unassigned', () => {
      setup({ view: 'unassigned', unitFilter: true });
      answer(next(), listPage([recordRow('t1')], { view: 'unassigned', facets }));
      expect(q('filter-status')).withContext('non-vacuity: the toolbar rendered').not.toBeNull();
      expect(q('filter-record-type')).toBeNull();
      expect(q('filter-unit')).toBeNull();
    });
  });

  describe('request outcomes', () => {
    it('shows a 403 as the denied state, with the server\'s sentence and no Retry', () => {
      setup({ view: 'unassigned' });
      // The column headers are the desktop layout's (the test browser is phone-narrow).
      list().phone.set(false);
      fixture.detectChanges();
      // Non-vacuity: before the answer the toolbar, search and headers are there.
      expect(q('task-list-toolbar')).not.toBeNull();
      expect(q('task-list-search')).not.toBeNull();
      expect(q('task-list-head')).not.toBeNull();
      next().flush(
        { statusCode: 403, message: 'Required permission: committees:manage_tasks', error: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );
      fixture.detectChanges();
      const denied = q('task-list-denied');
      expect(denied?.getAttribute('role')).toBe('alert');
      expect(text(denied)).toContain("You can't open this view.");
      expect(text(q('task-list-denied-reason'))).toBe('Required permission: committees:manage_tasks');
      expect(q('task-list-error')).toBeNull();
      expect(denied!.querySelector('button')).toBeNull();
    });

    // ACC-120 slice 3 — a view the viewer may not open offers nothing to search, filter
    // or sort: only the denied state, with the server's sentence.
    for (const phone of [false, true]) {
      it(`hides the toolbar, search, filters, chips, column headers and sort when denied (${phone ? 'phone' : 'desktop'})`, () => {
        setup({ view: 'all', recordType: 'COMMITTEE' });
        list().phone.set(phone);
        fixture.detectChanges();
        // Non-vacuity: what is hidden was there before the answer.
        const sortControl = phone ? 'task-list-sort-menu' : 'task-list-head';
        expect(q(sortControl)).withContext(`before: ${sortControl}`).not.toBeNull();
        expect(q('task-list-toolbar')).withContext('before: toolbar').not.toBeNull();
        next().flush({ statusCode: 403, message: 'Required permission: committees:view_all_tasks', error: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
        fixture.detectChanges();
        expect(q('task-list-denied')).withContext('the denied state rendered').not.toBeNull();
        for (const id of ['task-list-toolbar', 'task-list-search', 'filter-status', 'filter-record-type', 'task-list-chips', sortControl]) {
          expect(q(id)).withContext(id).toBeNull();
        }
      });
    }

    it('tells its host when the view is denied, and when it is not', () => {
      setup({ view: 'unassigned' });
      const told: boolean[] = [];
      list().deniedChange.subscribe((d) => told.push(d));
      next().flush({ statusCode: 403, message: 'No', error: 'Forbidden' }, { status: 403, statusText: 'Forbidden' });
      fixture.detectChanges();
      expect(told).toEqual([true]);
      list().reload();
      answer(next(), listPage([], { view: 'unassigned' }));
      expect(told).toEqual([true, false]);
    });

    it('says why a view is empty, in its own words', () => {
      setup({ view: 'unassigned' });
      answer(next(), listPage([], { view: 'unassigned' }));
      expect(text(q('task-list-empty'))).toContain('Every task has someone on it');
      expect(text(q('task-list-empty'))).toContain('A task nobody holds, and no pool can pick up, appears here.');
    });
  });

  describe('a Setup health Fix (?reassign=<id>)', () => {
    it('opens Reassign on the task it names, when the server offers Reassign on that row', () => {
      setup({ view: 'unassigned', around: 't2', openAction: 'reassign' });
      const act = spyOn(list(), 'act');
      const req = next();
      expect(req.request.params.get('around')).toBe('t2');
      answer(
        req,
        listPage([recordRow('t1'), recordRow('t2', { status: 'UNASSIGNED', actions: { ...NO_ACTIONS, reassign: true } })], {
          view: 'unassigned',
          aroundIndex: 1,
        }),
      );
      expect(act).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 't2' }), 'reassign');
    });

    it('opens nothing when that row no longer offers Reassign', () => {
      setup({ view: 'unassigned', around: 't2', openAction: 'reassign' });
      const act = spyOn(list(), 'act');
      answer(next(), listPage([recordRow('t1'), recordRow('t2', { actions: { ...NO_ACTIONS, reassign: false } })], { view: 'unassigned', aroundIndex: 1 }));
      expect(act).not.toHaveBeenCalled();
      // Non-vacuity: the linked row was found and highlighted.
      expect(list().highlightId()).toBe('t2');
    });
  });


  // ACC-120 slice 3 — the viewer's own views: status chips in place of the
  // status select, the Overdue pill and tint, and the record's name.
  describe("the viewer's own views (mine, created)", () => {
    const chipRow = () => q('task-list-status-chips');
    const chipLabels = () => Array.from(chipRow()!.querySelectorAll('button')).map((b) => text(b));
    const pressed = () => Array.from(chipRow()!.querySelectorAll('button[aria-pressed="true"]')).map((b) => b.getAttribute('data-chip'));
    const chip = (id: string) => chipRow()!.querySelector<HTMLButtonElement>(`button[data-chip="${id}"]`)!;
    const CREATED_OPEN = 'UNASSIGNED,PENDING,IN_PROGRESS,ON_HOLD,REJECTED';

    it('Created by me asks for view=created with the open statuses, under "All open"', () => {
      setup({ view: 'created' });
      const req = next();
      expect(req.request.params.get('view')).toBe('created');
      expect(req.request.params.get('status')).toBe(CREATED_OPEN);
      answer(req, listPage([recordRow('t1')], { view: 'created' }));
      expect(chipRow()!.getAttribute('role')).toBe('group');
      expect(chipRow()!.getAttribute('aria-label')).toBe('Status');
      expect(chipLabels()).toEqual(['All open', 'Unassigned', 'Assigned', 'In progress', 'On hold', 'Rejected', 'Completed', 'Cancelled']);
      expect(pressed()).toEqual(['OPEN']);
      // The single-select status filter is gone here.
      expect(q('filter-status')).toBeNull();
      // "All open" is not a filter: nothing to clear.
      expect(q('task-list-clear')).toBeNull();
    });

    for (const st of ['UNASSIGNED', 'PENDING', 'IN_PROGRESS', 'ON_HOLD', 'REJECTED', 'COMPLETED', 'CANCELLED']) {
      it(`the ${st} chip sends that status alone, from the first page`, () => {
        setup({ view: 'created' });
        answer(next(), listPage([recordRow('t1')], { view: 'created' }));
        chip(st).click();
        fixture.detectChanges();
        const req = next();
        expect(req.request.params.get('status')).toBe(st);
        expect(req.request.params.get('skip')).toBe('0');
        answer(req, listPage([], { view: 'created' }));
        expect(pressed()).toEqual([st]);
      });
    }

    it('Clear goes back to "All open", never to every status', () => {
      setup({ view: 'created' });
      answer(next(), listPage([recordRow('t1')], { view: 'created' }));
      chip('COMPLETED').click();
      fixture.detectChanges();
      answer(next(), listPage([], { view: 'created' }));
      // Non-vacuity: a chip but "All open" is a filter, so Clear is offered.
      const clear = q('task-list-clear');
      expect(clear).not.toBeNull();
      clear!.click();
      fixture.detectChanges();
      const req = next();
      expect(req.request.params.get('status')).toBe(CREATED_OPEN);
      answer(req, listPage([recordRow('t1')], { view: 'created' }));
      expect(pressed()).toEqual(['OPEN']);
      expect(q('task-list-clear')).toBeNull();
    });

    it('My tasks leaves out Unassigned and Rejected, and opens on its own open set', () => {
      setup({ view: 'mine' });
      const req = next();
      expect(req.request.params.get('view')).toBe('mine');
      expect(req.request.params.get('status')).toBe('PENDING,IN_PROGRESS,ON_HOLD');
      answer(req, listPage([recordRow('t1')], { view: 'mine' }));
      expect(chipLabels()).toEqual(['All open', 'Assigned', 'In progress', 'On hold', 'Completed', 'Cancelled']);
      expect(chipRow()!.querySelector('[data-chip="UNASSIGNED"]')).toBeNull();
      expect(chipRow()!.querySelector('[data-chip="REJECTED"]')).toBeNull();
    });

    it('says why Created by me is empty, and My tasks too', () => {
      setup({ view: 'created' });
      answer(next(), listPage([], { view: 'created' }));
      expect(text(q('task-list-empty'))).toContain('Nothing you created is open');
      expect(text(q('task-list-empty'))).toContain('Tasks you create on a record appear here.');
      setup({ view: 'mine' });
      answer(next(), listPage([], { view: 'mine' }));
      expect(text(q('task-list-empty'))).toContain('Nothing open for you');
      expect(text(q('task-list-empty'))).toContain("Tasks you're given on any record appear here.");
    });

    it('All tasks keeps the status select, sends no status, and draws no chip row', () => {
      setup({ view: 'all' });
      const req = next();
      expect(req.request.params.has('status')).toBeFalse();
      answer(req, listPage([recordRow('t1')], { view: 'all' }));
      expect(q('filter-status')).not.toBeNull();
      expect(chipRow()).toBeNull();
    });

    describe('Overdue', () => {
      const PAST = '2020-01-01T05:00:00.000Z';
      const overdueRows = () => [
        recordRow('late', { status: 'IN_PROGRESS', dueAt: PAST }),
        recordRow('held', { status: 'ON_HOLD', dueAt: PAST, onHoldUntil: '2099-01-01T05:00:00.000Z' }),
        recordRow('done', { status: 'COMPLETED', dueAt: PAST, completedAt: PAST }),
        recordRow('gone', { status: 'CANCELLED', dueAt: PAST, cancelledAt: PAST }),
        recordRow('ahead', { status: 'PENDING' }),
      ];
      const flagged = () =>
        Array.from(el.querySelectorAll('[data-task-row]'))
          .filter((r) => r.querySelector('[data-testid="task-list-overdue"]'))
          .map((r) => r.getAttribute('data-task-row'));

      for (const phone of [false, true]) {
        it(`shows the pill and the tint only on an open, not held, overdue row (${phone ? 'phone' : 'desktop'})`, () => {
          setup({ view: 'created' });
          list().phone.set(phone);
          answer(next(), listPage(overdueRows(), { view: 'created' }));
          expect(flagged()).toEqual(['late']);
          expect(text(el.querySelector('[data-task-row="late"] [data-testid="task-list-overdue"]'))).toBe('Overdue');
          const tinted = Array.from(el.querySelectorAll('[data-task-row][data-overdue]')).map((r) => r.getAttribute('data-task-row'));
          expect(tinted).toEqual(['late']);
          // Non-vacuity: all five rows rendered.
          expect(el.querySelectorAll('[data-task-row]').length).toBe(5);
        });
      }

      it('leaves All tasks as it was: no pill, no tint', () => {
        setup({ view: 'all' });
        answer(next(), listPage(overdueRows(), { view: 'all' }));
        expect(el.querySelectorAll('[data-task-row]').length).toBe(5);
        expect(flagged()).toEqual([]);
        expect(el.querySelector('[data-overdue]')).toBeNull();
      });
    });

    describe('the record', () => {
      const named = { type: 'COMMITTEE', id: 'c-9', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' };
      const recordOf = (id: string) => el.querySelector<HTMLElement>(`[data-task-row="${id}"] [data-testid="task-list-record"]`);

      for (const phone of [false, true]) {
        it(`names the record, and links a committee to its page (${phone ? 'phone' : 'desktop'})`, () => {
          setup({ view: 'created' });
          list().phone.set(phone);
          answer(
            next(),
            listPage(
              [
                recordRow('c', { record: named }),
                recordRow('u', { record: { type: 'COMMITTEE', id: 'c-hidden', nameEn: null, nameAr: null } }),
                recordRow('m', { sourceType: 'MEETING', record: { type: 'MEETING', id: 'm-1', nameEn: 'Board meeting', nameAr: null } }),
              ],
              { view: 'created' },
            ),
          );
          const link = recordOf('c')!;
          expect(link.tagName).toBe('A');
          expect(text(link)).toBe('Quality Committee');
          expect(link.getAttribute('href')).toBe('/committees/c-9');
          // No name: the type word, as plain text, never the code.
          expect(recordOf('u')!.tagName).toBe('SPAN');
          expect(text(recordOf('u'))).toBe('Committee');
          // A record type with no page today: its name, as plain text.
          expect(recordOf('m')!.tagName).toBe('SPAN');
          expect(text(recordOf('m'))).toBe('Board meeting');
        });
      }

      it('names it in Arabic, through the bilingual rule', () => {
        setup({ view: 'created', language: 'ar' });
        answer(next(), listPage([recordRow('c', { record: named })], { view: 'created' }));
        expect(text(recordOf('c'))).toBe('لجنة الجودة');
      });

      it('leaves All tasks as it was: the record line, no link', () => {
        setup({ view: 'all' });
        answer(next(), listPage([recordRow('c', { record: named })], { view: 'all' }));
        expect(recordOf('c')).toBeNull();
        expect(text(el.querySelector('[data-task-row="c"]'))).toContain('Quality Committee');
      });
    });

    it('names the chips in Arabic', () => {
      setup({ view: 'created', language: 'ar' });
      answer(next(), listPage([recordRow('t1')], { view: 'created' }));
      expect(chipRow()!.getAttribute('aria-label')).toBe('الحالة');
      expect(chipLabels()[0]).toBe('كل المفتوحة');
      expect(chipLabels()).toContain('قيد التنفيذ');
    });
  });

  it('names the filters and record types in Arabic', () => {
    setup({ view: 'unit', unitFilter: true, language: 'ar' });
    answer(next(), listPage([recordRow('t1')], { view: 'unit', facets }));
    expect(q('filter-record-type')!.getAttribute('aria-label') ?? text(q('filter-record-type'))).toContain('نوع السجل');
    expect(optionsOf('filter-record-type')).toEqual(['لجنة', 'اجتماع']);
    expect(optionsOf('filter-unit')).toEqual(['الصيدلية', 'التغذية العلاجية']);
  });
});
