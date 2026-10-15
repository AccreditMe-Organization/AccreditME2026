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
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { RecordTasksPanelComponent } from './record-tasks-panel.component';
import { NO_ACTIONS, listPage, recordRow, rows } from './record-tasks.fixtures';

// ACC-229 — the record Tasks panel's behaviour (Record Tasks Panel §1). Its
// heights are measured in record-tasks-panel.layout.spec.ts.

const API = `${environment.apiUrl}/tasks`;
const PANEL = `${API}/record-panel`;

@Component({
  standalone: true,
  imports: [RecordTasksPanelComponent],
  template: `<app-record-tasks-panel
    sourceType="COMMITTEE"
    sourceId="c-1"
    recordName="Infection Control"
    [canCreate]="canCreate()"
    [soughtTask]="sought()"
    (createRequested)="created = created + 1"
  />`,
})
class HostComponent {
  readonly canCreate = signal(true);
  readonly sought = signal<{ id: string } | null>(null);
  created = 0;
}

describe('RecordTasksPanelComponent (ACC-229)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;

  beforeEach(() => {
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
    el = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask').forEach((m) => m.remove());
  });

  function flush(body: object): void {
    http.expectOne((r) => r.url === PANEL && r.params.get('sourceId') === 'c-1').flush(body);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const rowEls = () => Array.from(el.querySelectorAll<HTMLElement>('[data-task-row]'));

  it('loading: five skeleton rows and "—" for the count', () => {
    expect(el.querySelectorAll('.am-cp__skeleton').length).toBe(5);
    expect(q('record-tasks-count')!.textContent!.trim()).toBe('—');
    flush({ total: 0, scope: 'all', rows: [] });
  });

  it('the header count is EVERY task the viewer can see, never the five shown; the footer appears only above five', () => {
    flush({ total: 16, scope: 'all', rows: rows(5) });
    expect(q('record-tasks-count')!.textContent!.trim()).toBe('16');
    expect(rowEls().length).toBe(5);
    expect(q('record-tasks-foot')!.textContent).toContain('Showing 5 of 16');
  });

  it('five or fewer: no footer', () => {
    flush({ total: 3, scope: 'all', rows: rows(3) });
    expect(q('record-tasks-foot')).toBeNull();
  });

  it('empty: says so, and New task stays in the header when allowed', () => {
    flush({ total: 0, scope: 'all', rows: [] });
    expect(q('record-tasks-empty')!.textContent).toContain('No tasks yet');
    q('record-tasks-new')!.click();
    expect(fixture.componentInstance.created).toBe(1);
  });

  it('New task is absent, not disabled, without tasks:create', () => {
    fixture.componentInstance.canCreate.set(false);
    flush({ total: 0, scope: 'all', rows: [] });
    expect(q('record-tasks-new')).toBeNull();
  });

  it('without tasks:view (Q1): "Your tasks on this committee"', () => {
    flush({ total: 2, scope: 'own', rows: rows(2) });
    expect(el.querySelector('h2')!.textContent).toContain('Your tasks on this committee');
  });

  it('error: in the body only, with Retry that reads the panel again', () => {
    http.expectOne((r) => r.url === PANEL).flush('x', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(q('record-tasks-error')).not.toBeNull();
    expect(el.querySelector('h2')!.textContent).toContain('Tasks');
    q('record-tasks-error')!.querySelector('button')!.click();
    fixture.detectChanges();
    flush({ total: 1, scope: 'all', rows: rows(1) });
    expect(q('record-tasks-error')).toBeNull();
    expect(rowEls().length).toBe(1);
  });

  it('one button per row: the server\'s main action, named with the task', () => {
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } })] });
    const button = rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!;
    expect(button.textContent!.trim()).toBe('Start');
    expect(button.getAttribute('aria-label')).toBe('Start Task t1');
  });

  it('the due label leads the second line: overdue with ⚠ and words, never colour alone', () => {
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { dueAt: new Date(Date.now() - 4 * 86_400_000).toISOString() })] });
    const due = rowEls()[0]!.querySelector('.am-rtp__due')!;
    expect(due.textContent).toMatch(/^⚠ 4 days overdue · /);
    expect(due.getAttribute('data-tone')).toBe('danger');
  });

  // ACC-217 — an action's failure used to set the panel's own error and never
  // clear it. It is now said in its row, and the panel stays.
  it('an action that fails says so IN ITS ROW and never blanks the panel (ACC-217)', () => {
    flush({ total: 2, scope: 'all', rows: [recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } }), recordRow('t2')] });
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${API}/t1/start`).flush({ message: 'This task has moved on.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    // The panel reads itself again (the task usually moved on) and keeps its rows.
    flush({ total: 2, scope: 'all', rows: [recordRow('t1'), recordRow('t2')] });
    expect(q('record-tasks-error')).toBeNull();
    expect(rowEls().length).toBe(2);
    expect(rowEls()[0]!.querySelector('[role="alert"]')!.textContent).toContain('This task has moved on.');
    expect(rowEls()[1]!.querySelector('[role="alert"]')).toBeNull();
  });

  it('a failed COMPLETE does not hide the task list (ACC-217\'s own case)', () => {
    spyOn(TestBed.inject(ConfirmationService), 'confirm').and.callFake((c) => {
      c.accept?.();
      return TestBed.inject(ConfirmationService);
    });
    flush({ total: 2, scope: 'all', rows: [recordRow('t1', { status: 'IN_PROGRESS', actions: { ...NO_ACTIONS, complete: true, primary: 'COMPLETE' } }), recordRow('t2')] });
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="complete"]')!.click();
    http.expectOne(`${API}/t1/complete`).flush({ message: 'Add evidence first.' }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    flush({ total: 2, scope: 'all', rows: [recordRow('t1', { status: 'IN_PROGRESS' }), recordRow('t2')] });
    expect(q('record-tasks-error')).toBeNull();
    expect(rowEls().length).toBe(2);
    expect(rowEls()[0]!.querySelector('[role="alert"]')!.textContent).toContain('Add evidence first.');
  });

  it('a successful action reads the panel again without a skeleton', () => {
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { actions: { ...NO_ACTIONS, start: true, primary: 'START' } })] });
    rowEls()[0]!.querySelector<HTMLButtonElement>('[data-action="start"]')!.click();
    http.expectOne(`${API}/t1/start`).flush({});
    fixture.detectChanges();
    expect(el.querySelectorAll('.am-cp__skeleton').length).toBe(0);
    flush({ total: 1, scope: 'all', rows: [recordRow('t1', { status: 'IN_PROGRESS' })] });
    expect(rowEls()[0]!.textContent).toContain('In progress');
  });

  describe('?task= (a deep link)', () => {
    it('among the five: highlighted, no popup', () => {
      flush({ total: 8, scope: 'all', rows: rows(5) });
      fixture.componentInstance.sought.set({ id: 't2' });
      fixture.detectChanges();
      expect(rowEls()[1]!.classList).toContain('am-cp-row--sought');
      http.expectNone((r) => r.url === `${API}/record-list`);
    });

    it('outside the five: the popup opens AT it, asking the server where it sits', () => {
      flush({ total: 8, scope: 'all', rows: rows(5) });
      fixture.componentInstance.sought.set({ id: 't8' });
      fixture.detectChanges();
      const req = http.expectOne((r) => r.url === `${API}/record-list`);
      expect(req.request.params.get('around')).toBe('t8');
      expect(req.request.params.get('sourceId')).toBe('c-1');
      req.flush(listPage(rows(8), { aroundIndex: 7 }));
      fixture.detectChanges();
      expect(document.querySelector('[data-testid="list-dialog"]')).not.toBeNull();
    });

    it('a link that arrives before the panel has loaded waits for it', () => {
      fixture.componentInstance.sought.set({ id: 't3' });
      fixture.detectChanges();
      flush({ total: 5, scope: 'all', rows: rows(5) });
      expect(rowEls()[2]!.classList).toContain('am-cp-row--sought');
    });
  });

  it('See all opens the popup on its defaults, titled with the record', () => {
    flush({ total: 16, scope: 'all', rows: rows(5) });
    q('record-tasks-see-all')!.click();
    fixture.detectChanges();
    const req = http.expectOne((r) => r.url === `${API}/record-list`);
    expect(req.request.params.keys().sort()).toEqual(['dir', 'skip', 'sort', 'sourceId', 'sourceType', 'take']);
    req.flush(listPage(rows(16)));
    fixture.detectChanges();
    expect(document.querySelector('[data-testid="list-dialog"] h2')!.textContent).toContain('All tasks · Infection Control');
  });
});
