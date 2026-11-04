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
import { AuthService } from '../../../../core/services/auth.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { IAvailableTaskListItemDto, ITaskRecordRowDto, ITaskRequestInboxDto, TaskPoolDto } from '../../services/task.service';
import { NO_ACTIONS, listPage, recordRow } from '../record-tasks-panel/record-tasks.fixtures';
import { TaskActionHostComponent } from '../task-action-host/task-action-host.component';
import { MyTasksSectionsComponent } from './my-tasks-sections.component';

// ACC-120 slice 3 — My tasks' two sections, read through their DOM (the
// behaviours MyTasksComponent's spec held for them, carried here): each is
// absent when empty, names the record and the pool, says what was asked, by
// whom and why, counts what is waiting (requests + the rejected list's
// matching), fails on its own with a line and Retry, and after an action
// reloads itself and tells the list.

const API = `${environment.apiUrl}/tasks`;
const AWAITING = `${API}/requests/awaiting-decision`;
const AVAILABLE = `${API}/available`;
const LIST = `${API}/record-list`;

const POOL: TaskPoolDto = {
  kind: 'POSITION',
  positionNameEn: 'Quality Officer',
  positionNameAr: 'مسؤول الجودة',
  orgUnitNameEn: 'Pharmacy',
  orgUnitNameAr: 'الصيدلية',
  roleLabelEn: null,
  roleLabelAr: null,
  committeeNameEn: null,
  committeeNameAr: null,
};
const COMMITTEE = { type: 'COMMITTEE', id: 'c-9', nameEn: 'Infection Prevention & Control', nameAr: 'مكافحة العدوى' };
const HIDDEN = { type: 'COMMITTEE', id: 'c-hidden', nameEn: null, nameAr: null };

function request(id: string, over: Partial<ITaskRequestInboxDto> = {}): ITaskRequestInboxDto {
  return {
    id,
    type: 'EXTENSION',
    requestedDueAt: '2026-10-09T14:00:00.000Z',
    holdUntil: null,
    requestedById: 'u-omar',
    requestedByName: 'Omar Haddad',
    reason: 'The lab export was delayed.',
    createdAt: '2026-10-01T05:00:00.000Z',
    record: COMMITTEE,
    task: { id: `t-${id}`, title: `Validate data ${id}`, sourceType: 'COMMITTEE', sourceId: 'c-9', status: 'IN_PROGRESS', priority: 'HIGH', dueAt: '2026-10-02T14:00:00.000Z' },
    ...over,
  };
}

function available(id: string, over: Partial<IAvailableTaskListItemDto> = {}): IAvailableTaskListItemDto {
  return {
    id,
    organizationId: 'org',
    title: `Reconcile register ${id}`,
    description: null,
    sourceType: 'COMMITTEE',
    sourceId: 'c-9',
    sourceStageId: null,
    workflowInstanceId: null,
    status: 'PENDING',
    priority: 'MEDIUM',
    dueAt: '2026-10-09T14:00:00.000Z',
    record: COMMITTEE,
    pool: POOL,
    evidenceCount: 0,
    openRequest: null,
    canManage: false,
    ...over,
  } as IAvailableTaskListItemDto;
}

function rejectedRow(id: string, over: Partial<ITaskRecordRowDto> = {}): ITaskRecordRowDto {
  return recordRow(id, {
    title: `Collect CVs ${id}`,
    status: 'REJECTED',
    rejectedReason: "I'm not on this task force.",
    rejectedBy: { id: 'u-tariq', name: 'Tariq Suleiman' },
    record: COMMITTEE,
    actions: { ...NO_ACTIONS, reassign: true },
    ...over,
  });
}

describe('MyTasksSectionsComponent (ACC-120 slice 3)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<MyTasksSectionsComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let changed: number;

  afterEach(() => {
    http.verify();
    document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((n) => n.remove());
  });

  function setup(language: 'en' | 'ar' = 'en'): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MyTasksSectionsComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'me' }) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(MyTasksSectionsComponent);
    changed = 0;
    fixture.componentInstance.changed.subscribe(() => changed++);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  const rejectedReq = (): TestRequest =>
    http.expectOne((r) => r.url === LIST && r.params.get('view') === 'created' && r.params.get('status') === 'REJECTED');
  /** Answers the three first reads. */
  function answer(o: { requests?: ITaskRequestInboxDto[]; rejected?: ITaskRecordRowDto[]; matching?: number; total?: number; available?: IAvailableTaskListItemDto[] } = {}): void {
    http.expectOne(AWAITING).flush(o.requests ?? []);
    const rejected = o.rejected ?? [];
    rejectedReq().flush(listPage(rejected, { view: 'created', total: o.total ?? rejected.length, matching: o.matching ?? rejected.length }));
    http.expectOne(AVAILABLE).flush(o.available ?? []);
    fixture.detectChanges();
  }
  const q = (id: string) => el.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const all = (id: string) => Array.from(el.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`));
  const text = (e: Element | null) => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('asks for the three reads at once, the rejected list on view created, status REJECTED, 50 at a time', () => {
    setup();
    const rejected = rejectedReq();
    expect(rejected.request.params.get('take')).toBe('50');
    expect(rejected.request.params.get('skip')).toBe('0');
    rejected.flush(listPage([], { view: 'created' }));
    http.expectOne(AWAITING).flush([]);
    http.expectOne(AVAILABLE).flush([]);
  });

  it('renders no section when nothing is waiting', () => {
    setup();
    answer();
    expect(q('mts-decision')).toBeNull();
    expect(q('mts-available')).toBeNull();
    expect(text(el)).toBe('');
  });

  describe('Waiting for your decision', () => {
    it('says what was asked, by whom and why, with Review request', () => {
      setup();
      answer({ requests: [request('r1')] });
      const section = q('mts-decision')!;
      expect(text(section.querySelector('h2'))).toBe('Waiting for your decision');
      expect(text(section)).toContain('On tasks you created or cover for. Someone is waiting on your answer.');
      const row = section.querySelector('[data-request-row="r1"]')!;
      expect(text(row.querySelector('am-task-link'))).toBe('Validate data r1');
      expect(text(row)).toContain('Omar Haddad');
      // Tenant zone, Riyadh: 14:00Z is 17:00.
      expect(text(row.querySelector('[data-testid="mts-ask"]'))).toBe('More time: 2 Oct 2026, 17:00 → 9 Oct 2026, 17:00');
      expect(text(row.querySelector('[data-testid="mts-why"]'))).toBe('“The lab export was delayed.”');
      const review = row.querySelector<HTMLButtonElement>('[data-testid="mts-review"]')!;
      expect(text(review)).toBe('Review request');
      expect(review.getAttribute('aria-label')).toBe('Review the request on “Validate data r1”');
    });

    it('says a hold request in English and in Arabic', () => {
      const hold = request('r2', { type: 'ON_HOLD', requestedDueAt: null, holdUntil: '2026-10-20T05:00:00.000Z' });
      setup();
      answer({ requests: [hold] });
      expect(text(q('mts-ask'))).toBe('Hold until 20 Oct 2026');
      setup('ar');
      answer({ requests: [hold] });
      expect(text(q('mts-decision')!.querySelector('h2'))).toBe('بانتظار قرارك');
      expect(text(q('mts-ask'))).toBe('إيقاف مؤقت حتى 20 أكتوبر 2026');
      expect(text(q('mts-why'))).toBe('«The lab export was delayed.»');
      // The typed reason is isolated, so the Arabic quote marks keep their sides.
      expect(text(q('mts-why')!.querySelector('bdi'))).toBe('The lab export was delayed.');
    });

    it('says a more-time request in Arabic, the arrow pointing the reading way', () => {
      setup('ar');
      answer({ requests: [request('r1')] });
      expect(text(q('mts-ask'))).toBe('وقت إضافي: 2 أكتوبر 2026، 17:00 ← 9 أكتوبر 2026، 17:00');
    });

    it('offers no Review on a request the viewer made', () => {
      setup();
      answer({ requests: [request('r1', { requestedById: 'me' })] });
      expect(q('mts-decision')).withContext('non-vacuity: the row is there').not.toBeNull();
      expect(q('mts-review')).toBeNull();
    });

    it('opens the decision dialog through the action host, with the request itself', () => {
      setup();
      answer({ requests: [request('r1')] });
      const host = fixture.debugElement.query((d) => d.componentInstance instanceof TaskActionHostComponent).componentInstance as TaskActionHostComponent;
      const review = spyOn(host, 'reviewRequest');
      q('mts-review')!.click();
      expect(review).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'r1' }));
    });

    it('shows a rejected task with who rejected it, the reason, and Reassign…', () => {
      setup();
      answer({ rejected: [rejectedRow('x1')] });
      const row = q('mts-decision')!.querySelector('[data-task-row="x1"]')!;
      expect(text(row.querySelector('[data-testid="mts-ask"]'))).toBe('Rejected by Tariq Suleiman');
      // Named once, in the ask: the record line carries the record alone.
      expect(text(row).split('Tariq Suleiman').length - 1).toBe(1);
      expect(text(row.querySelector('[data-testid="mts-why"]'))).toBe('“I\'m not on this task force.”');
      const reassign = row.querySelector<HTMLButtonElement>('[data-testid="mts-reassign"]')!;
      expect(text(reassign)).toBe('Reassign…');
      expect(reassign.getAttribute('aria-label')).toBe('Reassign “Collect CVs x1”');
      const host = fixture.debugElement.query((d) => d.componentInstance instanceof TaskActionHostComponent).componentInstance as TaskActionHostComponent;
      const run = spyOn(host, 'run');
      reassign.click();
      expect(run).toHaveBeenCalledOnceWith(jasmine.objectContaining({ id: 'x1' }), 'reassign');
    });

    it('says who rejected it in Arabic', () => {
      setup('ar');
      answer({ rejected: [rejectedRow('x1')] });
      expect(text(q('mts-ask'))).toBe('مرفوضة من Tariq Suleiman');
      expect(text(q('mts-reassign'))).toBe('إعادة تعيين…');
    });

    it('offers no Reassign where the server does not', () => {
      setup();
      answer({ rejected: [rejectedRow('x1', { actions: { ...NO_ACTIONS } })] });
      expect(q('mts-decision')).withContext('non-vacuity').not.toBeNull();
      expect(q('mts-reassign')).toBeNull();
    });

    it('puts both kinds together, soonest due first, an undated task last', () => {
      setup();
      answer({
        requests: [request('late', { task: { ...request('late').task, dueAt: '2026-10-20T05:00:00.000Z' } })],
        rejected: [rejectedRow('soon', { dueAt: '2026-10-05T05:00:00.000Z' }), rejectedRow('never', { dueAt: null })],
      });
      const ids = Array.from(q('mts-decision')!.querySelectorAll('li')).map((li) => li.getAttribute('data-request-row') ?? li.getAttribute('data-task-row'));
      expect(ids).toEqual(['soon', 'late', 'never']);
    });

    it("counts the requests plus the rejected list's matching, never its total", () => {
      setup();
      // Two requests, and one rejected task of 40 the viewer created.
      answer({ requests: [request('r1'), request('r2')], rejected: [rejectedRow('x1')], matching: 1, total: 40 });
      const count = q('mts-decision-count')!;
      expect(text(count)).toBe('3');
      expect(count.getAttribute('aria-label')).toBe('3 tasks waiting for your decision');
    });

    it('counts in Arabic with the right plural form', () => {
      setup('ar');
      answer({ requests: [request('r1'), request('r2')] });
      expect(q('mts-decision-count')!.getAttribute('aria-label')).toBe('مهمتان بانتظار قرارك');
    });

    it('says it could not load, with Retry and a count of "—", never silence or 0', () => {
      setup();
      http.expectOne(AWAITING).flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
      rejectedReq().flush(listPage([rejectedRow('x1')], { view: 'created' }));
      http.expectOne(AVAILABLE).flush([]);
      fixture.detectChanges();
      const failed = q('mts-decision-failed')!;
      expect(failed.getAttribute('role')).toBe('alert');
      expect(text(failed)).toBe("Couldn't load requests · Retry");
      expect(text(q('mts-decision-count'))).toBe('—');
      expect(q('mts-decision-count')!.getAttribute('aria-label')).toBe('Count not available');
      // No rows under a failed section, even the half that loaded.
      expect(q('mts-decision')!.querySelector('li')).toBeNull();
      // Retry reads both halves again.
      q('mts-decision-retry')!.click();
      http.expectOne(AWAITING).flush([request('r1')]);
      rejectedReq().flush(listPage([], { view: 'created' }));
      fixture.detectChanges();
      expect(q('mts-decision-failed')).toBeNull();
      expect(text(q('mts-decision-count'))).toBe('1');
    });

    it('fails the same way when the rejected half fails', () => {
      setup();
      http.expectOne(AWAITING).flush([request('r1')]);
      rejectedReq().flush({}, { status: 500, statusText: 'Server Error' });
      http.expectOne(AVAILABLE).flush([]);
      fixture.detectChanges();
      expect(q('mts-decision-failed')).not.toBeNull();
      expect(text(q('mts-decision-count'))).toBe('—');
    });

    it('marks the row a ?request= link points at', () => {
      setup();
      fixture.componentRef.setInput('soughtRequestId', 'r2');
      answer({ requests: [request('r1'), request('r2')] });
      const sought = Array.from(el.querySelectorAll('.am-mts__row--sought')).map((r) => r.getAttribute('data-request-row'));
      expect(sought).toEqual(['r2']);
    });
  });

  describe('Available to pick up', () => {
    it('lists what waits in the viewer\'s pools, naming the record and the pool, with Pick up', () => {
      setup();
      answer({ available: [available('p1')] });
      const section = q('mts-available')!;
      expect(text(section.querySelector('h2'))).toBe('Available to pick up');
      expect(text(section)).toContain('Offered to a position you hold. The first person to pick one up owns it.');
      expect(text(q('mts-pool'))).toBe('· offered to Quality Officer, Pharmacy');
      expect(text(q('mts-priority'))).toBe('Medium');
      expect(text(q('mts-due'))).toBe('9 Oct 2026, 17:00');
      expect(q('mts-pick')!.getAttribute('aria-label')).toBe('Pick up “Reconcile register p1”');
      expect(text(q('mts-available-count'))).toBe('1');
      expect(q('mts-available-count')!.getAttribute('aria-label')).toBe('1 task to pick up');
    });

    it('names the pool in Arabic, with the Arabic comma', () => {
      setup('ar');
      answer({ available: [available('p1')] });
      expect(text(q('mts-pool'))).toContain('مسؤول الجودة، الصيدلية');
    });

    it('writes High and Critical with their glyph, as text', () => {
      setup();
      answer({ available: [available('h', { priority: 'HIGH' }), available('c', { priority: 'CRITICAL' })] });
      expect(all('mts-priority').map((p) => text(p))).toEqual(['▲ High', '!! Critical']);
    });

    it('Pick up posts to /pick, reloads the section and tells the list', () => {
      setup();
      answer({ available: [available('p1')] });
      q('mts-pick')!.click();
      const req = http.expectOne(`${API}/p1/pick`);
      expect(req.request.method).toBe('POST');
      req.flush({});
      http.expectOne(AVAILABLE).flush([]);
      fixture.detectChanges();
      expect(changed).toBe(1);
      expect(q('mts-available')).toBeNull();
    });

    it('says so when someone else picked it up first, and reloads everything', () => {
      setup();
      answer({ available: [available('p1')] });
      q('mts-pick')!.click();
      http.expectOne(`${API}/p1/pick`).flush({ message: 'This task has already been picked up' }, { status: 409, statusText: 'Conflict' });
      http.expectOne(AVAILABLE).flush([available('p2')]);
      fixture.detectChanges();
      expect(changed).toBe(1);
      expect(text(q('mts-pick-error'))).toBe('This task has already been picked up');
      expect(q('mts-pick-error')!.getAttribute('role')).toBe('alert');
    });

    it('says it could not load, with Retry and "—"', () => {
      setup();
      http.expectOne(AWAITING).flush([]);
      rejectedReq().flush(listPage([], { view: 'created' }));
      http.expectOne(AVAILABLE).flush({}, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(text(q('mts-available-failed'))).toBe("Couldn't load tasks to pick up · Retry");
      expect(text(q('mts-available-count'))).toBe('—');
      // The other section is unaffected: nothing waiting, so absent.
      expect(q('mts-decision')).toBeNull();
      q('mts-available-retry')!.click();
      http.expectOne(AVAILABLE).flush([available('p1')]);
      fixture.detectChanges();
      expect(q('mts-available-failed')).toBeNull();
      expect(q('mts-pick')).not.toBeNull();
    });

    it('says its failure in Arabic', () => {
      setup('ar');
      http.expectOne(AWAITING).flush({}, { status: 500, statusText: 'Server Error' });
      rejectedReq().flush(listPage([], { view: 'created' }));
      http.expectOne(AVAILABLE).flush({}, { status: 500, statusText: 'Server Error' });
      fixture.detectChanges();
      expect(text(q('mts-decision-failed'))).toBe('تعذّر تحميل الطلبات · إعادة المحاولة');
      expect(text(q('mts-available-failed'))).toBe('تعذّر تحميل المهام المتاحة للاستلام · إعادة المحاولة');
    });

    it('tells the shell which tasks it holds, and null when it failed', () => {
      setup();
      const told: (string[] | null)[] = [];
      fixture.componentInstance.availableLoaded.subscribe((ids) => told.push(ids));
      answer({ available: [available('p1')] });
      fixture.componentInstance.loadAvailable();
      http.expectOne(AVAILABLE).flush({}, { status: 500, statusText: 'Server Error' });
      expect(told).toEqual([['p1'], null]);
    });
  });

  describe('the record', () => {
    it('links a named committee to its page, and gives a hidden one its type word, never the code', () => {
      setup();
      answer({ requests: [request('r1')], available: [available('p1', { record: HIDDEN })] });
      const [named, hidden] = all('mts-record');
      expect(named!.tagName).toBe('A');
      expect(text(named!)).toBe('Infection Prevention & Control');
      expect(named!.getAttribute('href')).toBe('/committees/c-9');
      expect(hidden!.tagName).toBe('SPAN');
      expect(text(hidden!)).toBe('Committee');
    });

    it('names a record with no page of its own as plain text', () => {
      setup();
      answer({ available: [available('p1', { sourceType: 'MEETING', record: { type: 'MEETING', id: 'm-1', nameEn: 'Board meeting', nameAr: null } })] });
      const record = q('mts-record')!;
      expect(record.tagName).toBe('SPAN');
      expect(text(record)).toBe('Board meeting');
    });

    it('names it in Arabic, through the bilingual rule', () => {
      setup('ar');
      answer({ requests: [request('r1')] });
      expect(text(q('mts-record'))).toBe('مكافحة العدوى');
    });
  });
});
