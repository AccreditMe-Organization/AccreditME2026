import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { MyWorkEvents } from '../../../../core/my-work/my-work-events';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { RecordTasksPanelComponent } from './record-tasks-panel.component';
import { NO_ACTIONS, listPage, recordRow, rows } from './record-tasks.fixtures';

// ACC-216 (plan step-216 §5) — the record Tasks panel in PERSON mode, on the user
// record page: the tasks a person is on that the viewer may see. The frame, the
// rows and the actions are the record panel's; what differs is pinned here.

const API = `${environment.apiUrl}/tasks`;
const PANEL = `${API}/record-panel`;

@Component({
  standalone: true,
  imports: [RecordTasksPanelComponent],
  // canCreate is bound true on purpose: a person's panel never offers New task.
  template: `<app-record-tasks-panel person="u-huda" recordName="Huda Al-Qahtani" [canCreate]="true" />`,
})
class HostComponent {
  readonly unused = signal(0);
}

describe('RecordTasksPanelComponent — a person\'s tasks (ACC-216)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let myWork: jasmine.Spy;

  function setup(lang: 'en' | 'ar' = 'en'): void {
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
    TestBed.inject(TranslateService).use(lang);
    myWork = spyOn(TestBed.inject(MyWorkEvents), 'changed');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(HostComponent);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove()));

  /** The panel's read: the person, and never a record. */
  function panelReq() {
    return http.expectOne((r) => r.url === PANEL && r.params.get('person') === 'u-huda' && !r.params.has('sourceType') && !r.params.has('sourceId'));
  }
  function flush(body: object): void {
    panelReq().flush(body);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rowEls = () => Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]'));
  const host = () => el.querySelector<HTMLElement>('app-record-tasks-panel')!;

  it('reads GET /tasks/record-panel?person=, titled "Tasks", the header counting every task, "Showing 5 of N"', () => {
    setup();
    flush({ total: 12, scope: 'all', rows: rows(5) });
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('Tasks');
    expect(q('record-tasks-count')!.textContent!.trim()).toBe('12');
    expect(rowEls().length).toBe(5);
    expect(q('record-tasks-foot')!.textContent).toContain('Showing 5 of 12');
  });

  it('never offers New task, though the host binds canCreate true (a person is not a record)', () => {
    setup();
    flush({ total: 0, scope: 'all', rows: [], canCreate: true });
    expect(q('record-tasks-new')).toBeNull();
  });

  it('a 403 (the viewer may not read this person\'s tasks): the panel is absent, never an error or a 0', () => {
    setup();
    panelReq().flush({ message: 'Required permission: users:view' }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(host().style.display).toBe('none');
    expect(q('record-tasks-error')).toBeNull();
  });

  it('any other failure says so in the panel, with Retry, and the count reads "—", never 0', () => {
    setup();
    panelReq().flush('x', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(host().style.display).not.toBe('none');
    expect(q('record-tasks-error')!.textContent).toContain("Couldn't load these tasks.");
    expect(q('record-tasks-count')!.textContent!.trim()).toBe('—');
    q('record-tasks-error')!.querySelector('button')!.click();
    fixture.detectChanges();
    flush({ total: 1, scope: 'all', rows: rows(1) });
    expect(q('record-tasks-error')).toBeNull();
    expect(rowEls().length).toBe(1);
  });

  it('empty: one plain line', () => {
    setup();
    flush({ total: 0, scope: 'all', rows: [] });
    expect(q('record-tasks-empty')!.textContent!.trim()).toBe('No tasks.');
  });

  it('a row: the title links to the task page; line 2 names the record only when the server named it, then the status in words', () => {
    setup();
    flush({
      total: 2,
      scope: 'all',
      rows: [
        recordRow('t1', { record: { type: 'COMMITTEE', id: 'c-1', nameEn: 'Infection Control Committee', nameAr: null } }),
        recordRow('t2', { status: 'IN_PROGRESS', record: { type: 'COMMITTEE', id: 'c-2', nameEn: null, nameAr: null } }),
      ],
    });
    expect(rowEls()[0]!.querySelector('a')!.getAttribute('href')).toBe('/tasks/t1');
    expect(rowEls()[0]!.querySelector('.am-cp-l2')!.textContent).toContain('Infection Control Committee · Assigned');
    // Not named by the server (the viewer may not open it): the type word only.
    const second = rowEls()[1]!.querySelector('.am-cp-l2')!.textContent!;
    expect(second).toContain('Committee · In progress');
    // The person is on every row, so no assignee name is repeated.
    expect(second).not.toContain('Dr. Sara Al-Qahtani');
  });

  it('due with the overdue flag, in words', () => {
    setup();
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { dueAt: new Date(Date.now() - 2 * 86_400_000).toISOString() })] });
    const due = rowEls()[0]!.querySelector('.am-rtp__due')!;
    expect(due.textContent).toMatch(/^⚠ 2 days overdue · /);
    expect(due.getAttribute('data-tone')).toBe('danger');
  });

  it('the row\'s actions are the server\'s: one next step as a button, the rest in the ⋯ menu', () => {
    setup();
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { actions: { ...NO_ACTIONS, start: true, reject: true, primary: 'START' } })] });
    expect(rowEls()[0]!.querySelector('[data-action="start"]')!.textContent!.trim()).toBe('Start');
    expect(rowEls()[0]!.querySelectorAll('button.am-rtp__btn').length).toBe(1);
    expect(rowEls()[0]!.querySelector('[data-testid="row-menu-trigger"]')).not.toBeNull();
  });

  it('an action\'s failure is said in ITS ROW, apart from the panel\'s load error', () => {
    setup();
    flush({ total: 2, scope: 'all', rows: [recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } }), recordRow('t2')] });
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${API}/t1/start`).flush({ message: 'This task has moved on.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    flush({ total: 2, scope: 'all', rows: [recordRow('t1'), recordRow('t2')] });
    expect(q('record-tasks-error')).toBeNull();
    expect(rowEls()[0]!.querySelector('[role="alert"]')!.textContent).toContain('This task has moved on.');
    expect(rowEls()[1]!.querySelector('[role="alert"]')).toBeNull();
  });

  it('a successful action tells MyWorkEvents and reads the panel ONCE (no polling)', () => {
    setup();
    spyOn(TestBed.inject(ConfirmationService), 'confirm').and.callFake((c) => {
      c.accept?.();
      return TestBed.inject(ConfirmationService);
    });
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { status: 'IN_PROGRESS', actions: { ...NO_ACTIONS, complete: true, primary: 'COMPLETE' } })] });
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="complete"]')!.click();
    http.expectOne(`${API}/t1/complete`).flush({});
    fixture.detectChanges();
    expect(myWork).toHaveBeenCalledTimes(1);
    flush({ total: 0, scope: 'all', rows: [] });
    http.verify();
  });

  it('See all opens the same task list in the person scope: person sent, no record and no view', () => {
    setup();
    flush({ total: 12, scope: 'all', rows: rows(5) });
    q('record-tasks-see-all')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === `${API}/record-list`);
    expect(req.request.params.get('person')).toBe('u-huda');
    expect(req.request.params.has('sourceType')).toBeFalse();
    expect(req.request.params.has('sourceId')).toBeFalse();
    expect(req.request.params.has('view')).toBeFalse();
    req.flush(listPage(rows(12)));
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('All tasks · Huda Al-Qahtani');
    expect(q('record-tasks-new')).toBeNull();
  });

  it('in Arabic: «المهام», the empty line «لا توجد مهام.», and the error', () => {
    setup('ar');
    flush({ total: 0, scope: 'all', rows: [] });
    expect(el.querySelector('h2')!.textContent!.trim()).toBe('المهام');
    expect(q('record-tasks-empty')!.textContent!.trim()).toBe('لا توجد مهام.');
    // Every key the panel reads in person mode exists in Arabic, in Arabic script.
    const tree = (ar as { personTasks: Record<string, string> }).personTasks;
    for (const key of ['title', 'error', 'empty', 'popupTitle']) expect(tree[key]).toMatch(/[؀-ۿ]/);
  });
});
