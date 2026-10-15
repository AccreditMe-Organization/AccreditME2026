import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
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
import { TaskListViewComponent } from './task-list-view.component';
import { NO_ACTIONS, listPage, recordRow, rows } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-229 — the All tasks list (Record Tasks Panel §2): every filter is the
// server's, the list opens on its defaults, Load more continues the same
// order, and an action runs in place.

const LIST = `${environment.apiUrl}/tasks/record-list`;

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<app-task-list-view [sourceType]="type()" [sourceId]="id()" [around]="around()" (changed)="changed = changed + 1" />`,
})
class HostComponent {
  readonly type = signal<string | null>('COMMITTEE');
  readonly id = signal<string | null>('c-1');
  readonly around = signal<string | null>(null);
  changed = 0;
}

describe('TaskListViewComponent (ACC-229)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  function setup(over: Partial<{ type: string | null; id: string | null; around: string | null }> = {}): void {
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
    TestBed.inject(TranslateService).use('en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    if ('type' in over) fixture.componentInstance.type.set(over.type!);
    if ('id' in over) fixture.componentInstance.id.set(over.id!);
    if ('around' in over) fixture.componentInstance.around.set(over.around!);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  const next = (): TestRequest => http.expectOne((r) => r.url === LIST);
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rowEls = () => Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]'));
  const view = () => fixture.debugElement.children[0]!.componentInstance as TaskListViewComponent;
  function answer(req: TestRequest, body: object): void {
    req.flush(body);
    fixture.detectChanges();
  }

  it('opens on its defaults: due date, open first, the first 50 — nothing remembered', () => {
    setup();
    const req = next();
    expect(req.request.params.get('sort')).toBe('due');
    expect(req.request.params.get('dir')).toBe('asc');
    expect(req.request.params.get('take')).toBe('50');
    expect(req.request.params.get('skip')).toBe('0');
    expect(req.request.params.has('q')).toBeFalse();
    answer(req, listPage(rows(3)));
    expect(rowEls().length).toBe(3);
    expect(q('task-list-live')!.textContent).toContain('3 tasks');
  });

  it('loading: ten skeleton rows and "Loading tasks" in the live region', () => {
    setup();
    expect(el.querySelectorAll('[data-testid="task-list-scroll"] .am-tl__row[aria-hidden="true"]').length).toBe(10);
    expect(q('task-list-live')!.textContent).toContain('Loading tasks');
    answer(next(), listPage([]));
  });

  it('organisation-wide (/tasks/all): no record in the request', () => {
    setup({ type: null, id: null });
    const req = next();
    expect(req.request.params.has('sourceType')).toBeFalse();
    expect(req.request.params.has('sourceId')).toBeFalse();
    answer(req, listPage([recordRow('t1', { record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Quality', nameAr: null } })]));
    expect(rowEls()[0]!.textContent).toContain('Committee · Quality');
  });

  it('a filter goes to the SERVER, shows a chip, and the live region counts the matches', () => {
    setup();
    answer(next(), listPage(rows(16)));
    view().overdue.set(true);
    fixture.detectChanges();
    const req = next();
    expect(req.request.params.get('overdue')).toBe('true');
    answer(req, listPage(rows(3), { total: 16, matching: 3 }));
    expect(q('task-list-chips')!.textContent).toContain('Overdue only');
    expect(q('task-list-live')!.textContent).toContain('3 tasks match');
    expect(q('task-list-foot')!.textContent).toContain('3 of 16 match');
  });

  it('removing a chip removes its filter; Clear all removes every one', () => {
    setup();
    answer(next(), listPage(rows(4)));
    view().overdue.set(true);
    view().mine.set(true);
    fixture.detectChanges();
    answer(next(), listPage(rows(1), { total: 4, matching: 1 }));
    const chip = Array.from(el.querySelectorAll<HTMLButtonElement>('.am-tl__chip')).find((b) => b.textContent!.includes('Assigned to me'))!;
    expect(chip.getAttribute('aria-label')).toBe('Remove filter: Assigned to me');
    chip.click();
    fixture.detectChanges();
    const after = next();
    expect(after.request.params.has('mine')).toBeFalse();
    expect(after.request.params.get('overdue')).toBe('true');
    answer(after, listPage(rows(2), { total: 4, matching: 2 }));
    q('task-list-clear')!.click();
    fixture.detectChanges();
    const cleared = next();
    expect(cleared.request.params.has('overdue')).toBeFalse();
    answer(cleared, listPage(rows(4)));
    expect(el.querySelectorAll('.am-tl__chip').length).toBe(0);
  });

  it('search waits for typing to pause, then asks the server', fakeAsync(() => {
    setup();
    answer(next(), listPage(rows(4)));
    const input = q('task-list-search') as HTMLInputElement;
    input.value = 'ventilator';
    input.dispatchEvent(new Event('input'));
    tick(100);
    http.expectNone((r) => r.url === LIST);
    tick(200);
    fixture.detectChanges();
    const req = next();
    expect(req.request.params.get('q')).toBe('ventilator');
    answer(req, listPage([], { total: 4, matching: 0 }));
    expect(q('task-list-empty')!.textContent).toContain('No tasks match “ventilator”');
  }));

  it('Load more adds the next 50 in the same order; the loaded rows stay', () => {
    setup();
    answer(next(), listPage(rows(50), { total: 120, matching: 120 }));
    q('task-list-more')!.click();
    fixture.detectChanges();
    const req = next();
    expect(req.request.params.get('skip')).toBe('50');
    answer(req, listPage(rows(50, (i) => ({ id: `u${i}` })), { total: 120, matching: 120 }));
    expect(rowEls().length).toBe(100);
  });

  it('Load more fails: the rows stay and the footer offers Retry', () => {
    setup();
    answer(next(), listPage(rows(50), { total: 120, matching: 120 }));
    q('task-list-more')!.click();
    fixture.detectChanges();
    next().flush('x', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(rowEls().length).toBe(50);
    expect(q('task-list-foot')!.textContent).toContain("Couldn't load more");
  });

  it('the list fails: the error sits in the list area and the toolbar stays usable', () => {
    setup();
    next().flush('x', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(q('task-list-error')).not.toBeNull();
    expect((q('task-list-search') as HTMLInputElement).disabled).toBeFalse();
  });

  it('a deep link loads up to the linked task, highlights it, and names it in a chip', () => {
    setup({ around: 'u10' });
    const first = next();
    expect(first.request.params.get('around')).toBe('u10');
    answer(first, listPage(rows(50), { total: 70, matching: 70, aroundIndex: 60 }));
    const second = next();
    expect(second.request.params.get('skip')).toBe('50');
    expect(second.request.params.has('around')).toBeFalse();
    answer(second, listPage(rows(20, (i) => ({ id: `u${i}`, title: `Task u${i}` })), { total: 70, matching: 70 }));
    const sought = el.querySelector('[data-task-row="u10"]')!;
    expect(sought.classList).toContain('am-tl__item--sought');
    expect(q('task-list-chips')!.textContent).toContain('Opened from a link · Task u10');
  });

  it('an action runs IN PLACE: the row is read again where it sits', () => {
    setup();
    answer(next(), listPage([recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } }), recordRow('t2')]));
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${environment.apiUrl}/tasks/t1/start`).flush({});
    const refresh = next();
    expect(refresh.request.params.get('skip')).toBe('0');
    answer(refresh, listPage([recordRow('t1', { status: 'IN_PROGRESS' }), recordRow('t2')]));
    expect(rowEls().map((r) => r.getAttribute('data-task-row'))).toEqual(['t1', 't2']);
    expect(rowEls()[0]!.textContent).toContain('In progress');
    expect(fixture.componentInstance.changed).toBe(1);
  });

  it('a filter is a named control (a toolbar select has no visible label of its own)', () => {
    setup();
    answer(next(), listPage([]));
    const trigger = q('filter-status')!.querySelector('.am-overlay-select-trigger')!;
    expect(trigger.getAttribute('role')).toBe('button');
    expect(trigger.getAttribute('aria-label')).toBe('Status');
  });
});
