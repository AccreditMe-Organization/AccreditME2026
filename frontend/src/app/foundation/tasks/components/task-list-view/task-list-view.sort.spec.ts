import { Component } from '@angular/core';
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
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { TaskListViewComponent } from './task-list-view.component';
import { listPage, recordRow, rows } from '../record-tasks-panel/record-tasks.fixtures';

// ACC-234 — the All tasks list SORTS BY ITS COLUMN HEADERS (Ahmad, 17 Oct).
// Task, Status, Due and Updated are headers you press: ascending, then
// descending, on the server, from the first page, keeping the search and the
// filters. Assignee, Created by and the action column are plain text. There is
// no toolbar sort control, except on a phone, whose cards have no headers.

const LIST = `${environment.apiUrl}/tasks/record-list`;
const SORTABLE = [
  { key: 'title', label: 'Task' },
  { key: 'status', label: 'Status' },
  { key: 'due', label: 'Due' },
  { key: 'updated', label: 'Updated' },
] as const;

@Component({
  standalone: true,
  imports: [TaskListViewComponent],
  template: `<app-task-list-view sourceType="COMMITTEE" sourceId="c-1" />`,
})
class HostComponent {}

describe('TaskListViewComponent — sort by column header (ACC-234)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  function setup(language: 'en' | 'ar' = 'en', phone = false): void {
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
    TestBed.inject(TranslateService).use(language);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    view().phone.set(phone);
    fixture.detectChanges();
  }

  const view = () => fixture.debugElement.children[0]!.componentInstance as TaskListViewComponent;
  const next = (): TestRequest => http.expectOne((r) => r.url === LIST);
  function answer(req: TestRequest, body: object): void {
    req.flush(body);
    fixture.detectChanges();
  }
  const head = () => el.querySelector<HTMLElement>('[data-testid="task-list-head"]')!;
  const header = (key: string) => head().querySelector<HTMLElement>(`am-sort-header[data-sort-key="${key}"]`)!;
  const press = (key: string) => {
    header(key).querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
  };
  const titles = () => Array.from(el.querySelectorAll<HTMLElement>('[data-task-row] am-task-link')).map((a) => a.textContent!.trim());
  const arrows = () => Array.from(head().querySelectorAll('[data-testid="sort-arrow"]')).map((a) => `${a.closest('am-sort-header')!.getAttribute('data-sort-key')}${a.textContent}`);

  it('the toolbar has NO sort control; the headers are what sorts', () => {
    setup();
    answer(next(), listPage(rows(3)));
    const toolbar = el.querySelector<HTMLElement>('[data-testid="task-list-toolbar"]')!;
    expect(toolbar.querySelector('[data-testid="task-list-sort"], [data-testid="task-list-sort-menu"]')).toBeNull();
    expect(Array.from(toolbar.querySelectorAll('[aria-label]')).map((n) => n.getAttribute('aria-label'))).not.toContain('Sort');
    expect(toolbar.textContent).not.toContain('open first');
  });

  it('Task, Status, Due and Updated are buttons; Assignee, Created by and actions stay plain text', () => {
    setup();
    answer(next(), listPage(rows(3)));
    const cells = Array.from(head().children) as HTMLElement[];
    expect(cells.map((c) => c.getAttribute('role'))).toEqual(Array(7).fill('columnheader'));
    expect(cells.map((c) => !!c.querySelector('button'))).toEqual([true, true, false, true, false, true, false]);
    expect(Array.from(head().querySelectorAll('am-sort-header')).map((h) => h.getAttribute('data-sort-key'))).toEqual(SORTABLE.map((s) => s.key));
    for (const s of SORTABLE) {
      const button = header(s.key).querySelector('button')!;
      expect(button.getAttribute('aria-label')).withContext(s.key).toBe(`Sort by ${s.label}`);
      expect(button.getAttribute('type')).toBe('button');
      expect(button.getAttribute('tabindex')).toBeNull(); // in the tab order: a real button works with the keyboard
    }
  });

  it('opens on its default — overdue first, then soonest due, open before closed — with the arrow on Due', () => {
    setup();
    const req = next();
    expect(req.request.params.get('sort')).toBe('due');
    expect(req.request.params.get('dir')).toBe('asc');
    answer(req, listPage(rows(3)));
    expect(arrows()).toEqual(['due▲']);
    expect(header('due').getAttribute('aria-sort')).toBe('ascending');
    for (const s of SORTABLE.filter((x) => x.key !== 'due')) expect(header(s.key).hasAttribute('aria-sort')).withContext(s.key).toBeFalse();
    expect(head().querySelectorAll('[aria-sort]').length).toBe(1);
  });

  for (const s of SORTABLE) {
    it(`${s.label}: ascending, then descending — each a server request; the order is the server's; aria-sort follows`, () => {
      setup();
      answer(next(), listPage(rows(3)));
      // Due is already the ascending sort, so its first press turns it round.
      for (const dir of s.key === 'due' ? (['desc', 'asc'] as const) : (['asc', 'desc'] as const)) {
        press(s.key);
        const req = next();
        expect(req.request.params.get('sort')).withContext(`${s.key} ${dir}`).toBe(s.key);
        expect(req.request.params.get('dir')).withContext(`${s.key} ${dir}`).toBe(dir);
        expect(req.request.params.get('skip')).toBe('0');
        const order = dir === 'asc' ? ['Alpha', 'Bravo', 'Charlie'] : ['Charlie', 'Bravo', 'Alpha'];
        answer(req, listPage(order.map((t, i) => recordRow(`x${i}`, { title: t }))));
        expect(titles()).withContext('the rows are in the server order').toEqual(order);
        expect(header(s.key).getAttribute('aria-sort')).toBe(dir === 'asc' ? 'ascending' : 'descending');
        expect(arrows()).toEqual([`${s.key}${dir === 'asc' ? '▲' : '▼'}`]);
        expect(head().querySelectorAll('[aria-sort]').length).withContext('only the sorted column has aria-sort').toBe(1);
      }
    });
  }

  it('a header press starts again from the first page, keeping the search and the filters', fakeAsync(() => {
    setup();
    answer(next(), listPage(rows(50), { total: 120, matching: 120 }));
    el.querySelector<HTMLButtonElement>('[data-testid="task-list-more"]')!.click();
    fixture.detectChanges();
    const more = next();
    expect(more.request.params.get('skip')).toBe('50');
    answer(more, listPage(rows(50, (i) => ({ id: `m${i}` })), { total: 120, matching: 120 }));
    view().overdue.set(true);
    fixture.detectChanges();
    answer(next(), listPage(rows(20), { total: 120, matching: 20 }));
    const search = el.querySelector<HTMLInputElement>('[data-testid="task-list-search"]')!;
    search.value = 'audit';
    search.dispatchEvent(new Event('input'));
    tick(300);
    fixture.detectChanges();
    answer(next(), listPage(rows(4), { total: 120, matching: 4 }));

    press('title');
    const sorted = next();
    expect(sorted.request.params.get('sort')).toBe('title');
    expect(sorted.request.params.get('skip')).toBe('0');
    expect(sorted.request.params.get('overdue')).toBe('true');
    expect(sorted.request.params.get('q')).toBe('audit');
    answer(sorted, listPage(rows(4), { total: 120, matching: 4 }));
    expect(el.querySelectorAll('[data-task-row]').length).withContext('the loaded pages were replaced').toBe(4);
    expect(el.querySelector('[data-testid="task-list-chips"]')!.textContent).toContain('Overdue only');
  }));

  it('Arabic: the accessible name is translated and the arrow follows the label in reading order', () => {
    setup('ar');
    answer(next(), listPage(rows(2)));
    const due = header('due');
    expect(due.querySelector('button')!.getAttribute('aria-label')).toBe('ترتيب حسب الاستحقاق');
    const [label, arrow] = Array.from(due.querySelector('button')!.children) as HTMLElement[];
    expect(label!.textContent!.trim()).toBe('الاستحقاق');
    expect(arrow!.textContent).toBe('▲');
  });

  it('a phone (cards, no headers) keeps a compact sort menu with the headers\' sorts, both ways', () => {
    setup('en', true);
    answer(next(), listPage(rows(2)));
    expect(el.querySelector('[data-testid="task-list-head"]')).toBeNull();
    const menu = view().phoneSortOptions().map((o) => o.label);
    expect(menu).toEqual([
      'Task, ascending',
      'Task, descending',
      'Status, ascending',
      'Status, descending',
      'Due, ascending',
      'Due, descending',
      'Updated, ascending',
      'Updated, descending',
    ]);
    expect(el.querySelector('[data-testid="task-list-sort-menu"]')).not.toBeNull();
    view().onPhoneSort('updated:desc');
    fixture.detectChanges();
    const req = next();
    expect(req.request.params.get('sort')).toBe('updated');
    expect(req.request.params.get('dir')).toBe('desc');
    answer(req, listPage(rows(2)));
  });
});
