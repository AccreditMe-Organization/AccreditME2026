import { Component, forwardRef, input, output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, Subject, of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { ITaskViewsDto, TaskService } from '../../services/task.service';
import { MyTasksSectionsComponent } from '../my-tasks-sections/my-tasks-sections.component';
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';
import { TasksShellComponent } from './tasks-shell.component';

// ACC-120 slice 3 — the /tasks shell: the switcher is exactly GET /tasks/views'
// non-null views, in order; the URL picks the view; New task follows
// views.create; the Unit filter follows the number of top-level units; and a
// Setup health Fix's ?reassign= reaches the Unassigned list. My tasks is its
// two sections and the shared list on view mine (ACC-120 slice 3), and a
// briefing's ?task= / ?request= reaches the right one (ACC-198). The sections
// and the list are stood in for, so these tests are the shell's alone.

// Each stub stands in under the real type too, so the shell's viewChild()
// queries (the reloads it makes) find it.
@Component({
  selector: 'app-my-tasks-sections',
  standalone: true,
  template: '<p data-testid="stub-sections">sections</p>',
  providers: [{ provide: MyTasksSectionsComponent, useExisting: forwardRef(() => SectionsStub) }],
})
class SectionsStub {
  readonly soughtRequestId = input<string | null>(null);
  readonly soughtTaskId = input<string | null>(null);
  readonly changed = output<void>();
  readonly requestsLoaded = output<string[]>();
  readonly availableLoaded = output<string[] | null>();
  reload(): void {}
}

@Component({
  selector: 'app-task-list-view',
  standalone: true,
  template: '<p data-testid="stub-list">list</p>',
  providers: [{ provide: TaskListViewComponent, useExisting: forwardRef(() => ListStub) }],
})
class ListStub {
  readonly variant = input<string>('popup');
  readonly view = input<string | null>(null);
  readonly recordType = input<string | null>(null);
  readonly unit = input<string | null>(null);
  readonly unitFilter = input(false);
  readonly around = input<string | null>(null);
  readonly openAction = input<string | null>(null);
  readonly totalChange = output<{ total: number; scope: 'all' | 'own' }>();
  readonly deniedChange = output<boolean>();
  reload(): void {}
}

const ROOT = { id: 'u-ph', nameEn: 'Pharmacy', nameAr: 'الصيدلية', via: 'HEAD' as const };
const ACTING = { id: 'u-cn', nameEn: 'Clinical Nutrition', nameAr: 'التغذية العلاجية', via: 'ACTING' as const };
// The server sends created: true to everyone since ACC-120 slice 3 (#251).
const MEMBER: ITaskViewsDto = { mine: true, created: true, all: null, unassigned: null, unit: null, create: { types: [] } };
/** An answer offering My tasks alone (no Created by me): the one-view case. */
const MINE_ONLY = { mine: true, all: null, unassigned: null, unit: null, create: { types: [] } } as unknown as ITaskViewsDto;
const HEAD: ITaskViewsDto = { ...MEMBER, unit: { types: ['COMMITTEE'], units: [ROOT, ACTING] } };
const MANAGER: ITaskViewsDto = {
  mine: true,
  created: true,
  all: { types: ['COMMITTEE', 'MEETING'] },
  unassigned: { types: ['COMMITTEE'] },
  unit: null,
  create: { types: ['COMMITTEE'] },
};
const EVERYTHING: ITaskViewsDto = { ...MANAGER, unit: { types: ['COMMITTEE'], units: [ROOT] } };

describe('TasksShellComponent — one /tasks list with saved views (ACC-120 slice 3)', () => {
  // First, so it runs last: the Arabic test switches the document's language.
  preserveDocumentLanguage();

  let harness: RouterTestingHarness;
  let getViews: jasmine.Spy;
  let navigate: jasmine.Spy;

  async function open(url: string, views: ITaskViewsDto | Observable<ITaskViewsDto>, language: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'tasks', component: TasksShellComponent }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    TestBed.overrideComponent(TasksShellComponent, {
      remove: { imports: [MyTasksSectionsComponent, TaskListViewComponent] },
      add: { imports: [SectionsStub, ListStub] },
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    getViews = spyOn(TestBed.inject(TaskService), 'getViews').and.returnValue(views instanceof Observable ? views : of(views));
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.callThrough();
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return harness.routeNativeElement!;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const switcher = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-testid="task-views"] a')).map((a) => text(a));
  const currentView = (root: HTMLElement) => root.querySelector('[data-testid="task-views"] a[aria-current="page"]')?.getAttribute('data-view');
  const list = () => harness.fixture.debugElement.query((d) => d.componentInstance instanceof ListStub)?.componentInstance as ListStub | undefined;
  const sections = () => harness.fixture.debugElement.query((d) => d.componentInstance instanceof SectionsStub)?.componentInstance as SectionsStub | undefined;

  describe('the switcher', () => {
    // ACC-120 slice 3 — one tab is noise: an answer offering My tasks alone
    // draws no switcher (a view the server leaves out is absent).
    it('draws no switcher when the server offers My tasks alone', async () => {
      const root = await open('/tasks', MINE_ONLY);
      expect(root.querySelector('[data-testid="stub-sections"]')).withContext('non-vacuity: the page rendered').not.toBeNull();
      expect(root.querySelector('[data-testid="task-views"]')).toBeNull();
    });

    it('draws the switcher for a plain member: My tasks and Created by me', async () => {
      expect(switcher(await open('/tasks', MEMBER))).toEqual(['My tasks', 'Created by me']);
    });

    it('shows exactly the offered views, in their fixed order, Created by me second', async () => {
      expect(switcher(await open('/tasks', HEAD))).toEqual(['My tasks', 'Created by me', 'Unit tasks']);
      expect(switcher(await open('/tasks', MANAGER))).toEqual(['My tasks', 'Created by me', 'All tasks', 'Unassigned']);
      expect(switcher(await open('/tasks', EVERYTHING))).toEqual(['My tasks', 'Created by me', 'Unit tasks', 'All tasks', 'Unassigned']);
    });

    it('reads GET /tasks/views once for the page', async () => {
      await open('/tasks?view=all', MANAGER);
      await harness.navigateByUrl('/tasks?view=unassigned');
      await harness.navigateByUrl('/tasks');
      expect(getViews).toHaveBeenCalledTimes(1);
    });

    it('links each view by its URL, and shows no counts on it', async () => {
      const root = await open('/tasks', EVERYTHING);
      const hrefs = Array.from(root.querySelectorAll('[data-testid="task-views"] a')).map((a) => a.getAttribute('href'));
      expect(hrefs).toEqual(['/tasks', '/tasks?view=created', '/tasks?view=unit', '/tasks?view=all', '/tasks?view=unassigned']);
      expect(switcher(root).some((label) => /\d/.test(label))).toBeFalse();
    });
  });

  describe('the URL picks the view', () => {
    // ACC-120 slice 3 — My tasks is its two sections, then the shared list on
    // view mine, as a page; the shell's "Tasks" is the one H1.
    it('opens My tasks with no ?view: the sections, then the list on view mine', async () => {
      const root = await open('/tasks', MANAGER);
      expect(currentView(root)).toBe('mine');
      expect(root.querySelector('[data-testid="stub-sections"]')).not.toBeNull();
      expect(list()!.view()).toBe('mine');
      expect(list()!.variant()).toBe('page');
      expect(list()!.around()).toBeNull();
      // The sections come first.
      const order = Array.from(root.querySelectorAll('[data-testid="stub-sections"], [data-testid="stub-list"]')).map((e) => e.getAttribute('data-testid'));
      expect(order).toEqual(['stub-sections', 'stub-list']);
      expect(text(root.querySelector('h1'))).toBe('Tasks');
      expect(root.querySelectorAll('h1').length).toBe(1);
    });

    for (const [view, views] of [['created', MEMBER], ['all', MANAGER], ['unit', HEAD], ['unassigned', MANAGER]] as const) {
      it(`opens the list for ?view=${view}, sending that view`, async () => {
        const root = await open(`/tasks?view=${view}`, views);
        expect(currentView(root)).toBe(view);
        expect(list()!.view()).toBe(view);
        expect(list()!.variant()).toBe('page');
        expect(root.querySelector('[data-testid="stub-sections"]')).toBeNull();
      });
    }

    it('switches from My tasks to Created by me, the sections staying with My tasks', async () => {
      const root = await open('/tasks', MEMBER);
      expect(currentView(root)).toBe('mine');
      expect(root.querySelector('[data-testid="stub-sections"]')).not.toBeNull();
      expect(list()!.view()).toBe('mine');
      await harness.navigateByUrl('/tasks?view=created');
      harness.detectChanges();
      expect(list()!.view()).toBe('created');
      expect(root.querySelector('[data-testid="stub-sections"]')).toBeNull();
    });

    it('follows Back and Forward through the URL', async () => {
      const root = await open('/tasks?view=all', MANAGER);
      await harness.navigateByUrl('/tasks?view=unassigned');
      expect(currentView(root)).toBe('unassigned');
      await harness.navigateByUrl('/tasks?view=all');
      expect(currentView(root)).toBe('all');
    });

    it('opens My tasks, and says so, for a view this viewer does not have', async () => {
      const root = await open('/tasks?view=unassigned', MEMBER);
      expect(root.querySelector('[data-testid="stub-sections"]')).not.toBeNull();
      expect(list()!.view()).toBe('mine');
      expect(text(root.querySelector('[data-testid="task-view-notice"]'))).toBe("That view isn't available to you, so these are your own tasks.");
    });

    it('waits for the views before showing a list view, then shows it', async () => {
      const views = new Subject<ITaskViewsDto>();
      const root = await open('/tasks?view=all', views);
      expect(root.querySelector('[data-testid="task-views-loading"]')).not.toBeNull();
      expect(list()).toBeUndefined();
      views.next(MANAGER);
      harness.detectChanges();
      expect(list()!.view()).toBe('all');
    });

    // ACC-120 slice 3 — the total is shown once, in the list's own header row.
    it('draws no total of its own: the list says it', async () => {
      const root = await open('/tasks?view=all', MANAGER);
      list()!.totalChange.emit({ total: 11, scope: 'all' });
      harness.detectChanges();
      expect(list()).withContext('non-vacuity: the list view is open').toBeDefined();
      expect(root.querySelector('[data-testid="task-view-total"]')).toBeNull();
      expect(text(root)).not.toContain('11 tasks');
    });
  });

  describe('My tasks: the sections tell the list, and a save reloads both', () => {
    it('reloads the list when something changes in the sections', async () => {
      await open('/tasks', MEMBER);
      const reload = spyOn(list()!, 'reload');
      sections()!.changed.emit();
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('reloads the sections and the list after New task saves', async () => {
      await open('/tasks', MANAGER);
      const reloadList = spyOn(list()!, 'reload');
      const reloadSections = spyOn(sections()!, 'reload');
      (harness.routeDebugElement!.componentInstance as TasksShellComponent).onSaved();
      expect(reloadList).toHaveBeenCalledTimes(1);
      expect(reloadSections).toHaveBeenCalledTimes(1);
    });
  });

  // ACC-198 — a briefing item links to its row on My tasks: ?task=<id> (in
  // Available, or in the list) and ?request=<id> (Waiting for your decision).
  // The row is marked, and both parameters are taken out of the address. A
  // record no longer there leaves the page ordinary.
  describe('My tasks links (?task=, ?request=)', () => {
    const removed = () => jasmine.objectContaining({ queryParams: { task: null, request: null }, replaceUrl: true });

    it('?task= for a task in the list: the list opens at it, and both parameters go with replaceUrl', async () => {
      await open('/tasks?task=mine-1', MEMBER);
      // The list waits for Available's answer before it is asked for anything.
      expect(list()).withContext('waits for Available').toBeUndefined();
      sections()!.availableLoaded.emit(['pool-1']);
      harness.detectChanges();
      expect(list()!.around()).toBe('mine-1');
      expect(sections()!.soughtTaskId()).toBeNull();
      expect(navigate).toHaveBeenCalledWith([], removed());
      await harness.fixture.whenStable();
      expect(TestBed.inject(Router).parseUrl(TestBed.inject(Router).url).queryParams).toEqual({});
    });

    it('?task= for a pool task finds it in Available', async () => {
      await open('/tasks?task=pool-1', MEMBER);
      sections()!.availableLoaded.emit(['pool-1']);
      harness.detectChanges();
      expect(sections()!.soughtTaskId()).toBe('pool-1');
      expect(list()!.around()).withContext('not sent to the list as well').toBeNull();
      expect(navigate).toHaveBeenCalledWith([], removed());
    });

    it('?request= marks the row in Waiting for your decision, and no task', async () => {
      await open('/tasks?request=req-1', MEMBER);
      // Nothing to wait for: the list is there at once.
      expect(list()!.around()).toBeNull();
      sections()!.requestsLoaded.emit(['req-1']);
      harness.detectChanges();
      expect(sections()!.soughtRequestId()).toBe('req-1');
      expect(sections()!.soughtTaskId()).toBeNull();
      expect(navigate).toHaveBeenCalledWith([], removed());
    });

    it('an unknown id marks nothing', async () => {
      await open('/tasks?request=gone', MEMBER);
      sections()!.requestsLoaded.emit(['req-1']);
      harness.detectChanges();
      expect(sections()!.soughtRequestId()).toBeNull();
      expect(sections()!.soughtTaskId()).toBeNull();
      // Non-vacuity: the link was read (and taken out of the address).
      expect(navigate).toHaveBeenCalledWith([], removed());
    });

    it('no parameter, no navigation', async () => {
      await open('/tasks', MEMBER);
      sections()!.requestsLoaded.emit(['req-1']);
      sections()!.availableLoaded.emit(['pool-1']);
      harness.detectChanges();
      expect(navigate).not.toHaveBeenCalled();
      expect(sections()!.soughtRequestId()).toBeNull();
      expect(list()!.around()).toBeNull();
    });

    it('?task= when Available fails: the list opens at it all the same', async () => {
      await open('/tasks?task=mine-1', MEMBER);
      sections()!.availableLoaded.emit(null);
      harness.detectChanges();
      expect(list()!.around()).toBe('mine-1');
    });
  });

  describe('New task', () => {
    it('shows only when views.create names a record type', async () => {
      expect((await open('/tasks', MEMBER)).querySelector('[data-testid="task-new"]')).toBeNull();
      expect((await open('/tasks', MANAGER)).querySelector('[data-testid="task-new"]')).not.toBeNull();
    });

    // ACC-120 slice 3 — a view the server refuses offers nothing to do, New task included.
    it('is hidden while the open view is denied, and back on another view', async () => {
      const root = await open('/tasks?view=unassigned', MANAGER);
      expect(root.querySelector('[data-testid="task-new"]')).withContext('non-vacuity').not.toBeNull();
      list()!.deniedChange.emit(true);
      harness.detectChanges();
      expect(root.querySelector('[data-testid="task-new"]')).toBeNull();
      await harness.navigateByUrl('/tasks');
      harness.detectChanges();
      expect(root.querySelector('[data-testid="task-new"]')).not.toBeNull();
    });
  });

  describe('the Unit filter', () => {
    it('is offered when the unit scope holds more than one top-level unit, and not with one', async () => {
      await open('/tasks?view=unit', HEAD);
      expect(list()!.unitFilter()).toBeTrue();
      await open('/tasks?view=unit', EVERYTHING);
      expect(list()!.unitFilter()).toBeFalse();
    });
  });

  describe('a Setup health Fix (?reassign=<id>)', () => {
    it('hands the task to the Unassigned list, to open Reassign on its row', async () => {
      await open('/tasks?view=unassigned&reassign=t-9', MANAGER);
      expect(list()!.around()).toBe('t-9');
      expect(list()!.openAction()).toBe('reassign');
    });

    it('takes the parameter out of the address once read', async () => {
      await open('/tasks?view=unassigned&reassign=t-9', MANAGER);
      await harness.fixture.whenStable();
      const url = TestBed.inject(Router).parseUrl(TestBed.inject(Router).url);
      expect(url.queryParams).toEqual({ view: 'unassigned' });
    });
  });

  it('names the views in Arabic', async () => {
    const root = await open('/tasks', EVERYTHING, 'ar');
    expect(switcher(root)).toEqual(['مهامي', 'مهام أنشأتها', 'مهام الوحدة', 'كل المهام', 'غير المُسندة']);
    expect(text(root.querySelector('h1'))).toBe('المهام');
    expect(root.querySelector('[data-testid="task-views"]')!.getAttribute('aria-label')).toBe('طرق العرض المحفوظة');
  });
});
