import { Component, input, output } from '@angular/core';
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
import { MyTasksComponent } from '../my-tasks/my-tasks.component';
import { TaskListViewComponent } from '../task-list-view/task-list-view.component';
import { TasksShellComponent } from './tasks-shell.component';

// ACC-120 slice 3 — the /tasks shell: the switcher is exactly GET /tasks/views'
// non-null views, in order; the URL picks the view; New task follows
// views.create; the Unit filter follows the number of top-level units; and a
// Setup health Fix's ?reassign= reaches the Unassigned list. My tasks and the
// list are stood in for, so these tests are the shell's alone.

@Component({ selector: 'app-my-tasks', standalone: true, template: '<p data-testid="stub-my-tasks">my tasks</p>' })
class MyTasksStub {
  readonly showHeader = input(true);
}

@Component({ selector: 'app-task-list-view', standalone: true, template: '<p data-testid="stub-list">list</p>' })
class ListStub {
  readonly variant = input<string>('popup');
  readonly view = input<string | null>(null);
  readonly recordType = input<string | null>(null);
  readonly unit = input<string | null>(null);
  readonly unitFilter = input(false);
  readonly around = input<string | null>(null);
  readonly openAction = input<string | null>(null);
  readonly totalChange = output<{ total: number; scope: 'all' | 'own' }>();
  reload(): void {}
}

const ROOT = { id: 'u-ph', nameEn: 'Pharmacy', nameAr: 'الصيدلية', via: 'HEAD' as const };
const ACTING = { id: 'u-cn', nameEn: 'Clinical Nutrition', nameAr: 'التغذية العلاجية', via: 'ACTING' as const };
const MEMBER: ITaskViewsDto = { mine: true, all: null, unassigned: null, unit: null, create: { types: [] } };
const HEAD: ITaskViewsDto = { ...MEMBER, unit: { types: ['COMMITTEE'], units: [ROOT, ACTING] } };
const MANAGER: ITaskViewsDto = {
  mine: true,
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
      remove: { imports: [MyTasksComponent, TaskListViewComponent] },
      add: { imports: [MyTasksStub, ListStub] },
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    getViews = spyOn(TestBed.inject(TaskService), 'getViews').and.returnValue(views instanceof Observable ? views : of(views));
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return harness.routeNativeElement!;
  }

  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const switcher = (root: HTMLElement) => Array.from(root.querySelectorAll('[data-testid="task-views"] a')).map((a) => text(a));
  const currentView = (root: HTMLElement) => root.querySelector('[data-testid="task-views"] a[aria-current="page"]')?.getAttribute('data-view');
  const list = () => harness.fixture.debugElement.query((d) => d.componentInstance instanceof ListStub)?.componentInstance as ListStub | undefined;

  describe('the switcher', () => {
    it('shows My tasks alone to a plain member', async () => {
      const root = await open('/tasks', MEMBER);
      expect(switcher(root)).toEqual(['My tasks']);
    });

    it('shows exactly the non-null views, in their fixed order', async () => {
      expect(switcher(await open('/tasks', HEAD))).toEqual(['My tasks', 'Unit tasks']);
      expect(switcher(await open('/tasks', MANAGER))).toEqual(['My tasks', 'All tasks', 'Unassigned']);
      expect(switcher(await open('/tasks', EVERYTHING))).toEqual(['My tasks', 'All tasks', 'Unit tasks', 'Unassigned']);
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
      expect(hrefs).toEqual(['/tasks', '/tasks?view=all', '/tasks?view=unit', '/tasks?view=unassigned']);
      expect(switcher(root).some((label) => /\d/.test(label))).toBeFalse();
    });
  });

  describe('the URL picks the view', () => {
    it('opens My tasks with no ?view, without its own header', async () => {
      const root = await open('/tasks', MANAGER);
      expect(currentView(root)).toBe('mine');
      const mine = harness.fixture.debugElement.query((d) => d.componentInstance instanceof MyTasksStub)!.componentInstance as MyTasksStub;
      expect(mine.showHeader()).toBeFalse();
      expect(list()).toBeUndefined();
      expect(text(root.querySelector('h1'))).toBe('Tasks');
    });

    for (const [view, views] of [['all', MANAGER], ['unit', HEAD], ['unassigned', MANAGER]] as const) {
      it(`opens the list for ?view=${view}, sending that view`, async () => {
        const root = await open(`/tasks?view=${view}`, views);
        expect(currentView(root)).toBe(view);
        expect(list()!.view()).toBe(view);
        expect(list()!.variant()).toBe('page');
        expect(root.querySelector('[data-testid="stub-my-tasks"]')).toBeNull();
      });
    }

    it('follows Back and Forward through the URL', async () => {
      const root = await open('/tasks?view=all', MANAGER);
      await harness.navigateByUrl('/tasks?view=unassigned');
      expect(currentView(root)).toBe('unassigned');
      await harness.navigateByUrl('/tasks?view=all');
      expect(currentView(root)).toBe('all');
    });

    it('opens My tasks, and says so, for a view this viewer does not have', async () => {
      const root = await open('/tasks?view=unassigned', MEMBER);
      expect(currentView(root)).toBe('mine');
      expect(root.querySelector('[data-testid="stub-my-tasks"]')).not.toBeNull();
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

    it("shows the open view's own total from its list", async () => {
      const root = await open('/tasks?view=all', MANAGER);
      list()!.totalChange.emit({ total: 11, scope: 'all' });
      harness.detectChanges();
      expect(text(root.querySelector('[data-testid="task-view-total"]'))).toBe('11 tasks');
    });
  });

  describe('New task', () => {
    it('shows only when views.create names a record type', async () => {
      expect((await open('/tasks', MEMBER)).querySelector('[data-testid="task-new"]')).toBeNull();
      expect((await open('/tasks', MANAGER)).querySelector('[data-testid="task-new"]')).not.toBeNull();
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
    expect(switcher(root)).toEqual(['مهامي', 'كل المهام', 'مهام الوحدة', 'غير المُسندة']);
    expect(text(root.querySelector('h1'))).toBe('المهام');
    expect(root.querySelector('[data-testid="task-views"]')!.getAttribute('aria-label')).toBe('طرق العرض المحفوظة');
  });
});
