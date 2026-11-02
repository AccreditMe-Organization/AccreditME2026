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
  readonly view = signal<'all' | 'unit' | 'unassigned' | null>('all');
  readonly recordType = signal<string | null>(null);
  readonly unit = signal<string | null>(null);
  readonly unitFilter = signal(false);
  readonly around = signal<string | null>(null);
  readonly openAction = signal<'reassign' | null>(null);
}

type HostSetup = Partial<{
  view: 'all' | 'unit' | 'unassigned' | null;
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

  it('names the filters and record types in Arabic', () => {
    setup({ view: 'unit', unitFilter: true, language: 'ar' });
    answer(next(), listPage([recordRow('t1')], { view: 'unit', facets }));
    expect(q('filter-record-type')!.getAttribute('aria-label') ?? text(q('filter-record-type'))).toContain('نوع السجل');
    expect(optionsOf('filter-record-type')).toEqual(['لجنة', 'اجتماع']);
    expect(optionsOf('filter-unit')).toEqual(['الصيدلية', 'التغذية العلاجية']);
  });
});
