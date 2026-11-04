import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { FormatService } from '../../core/formatting';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { ChangeRequestService } from '../committees/change-requests/change-request.service';
import { NotificationService } from '../notification/services/notification.service';
import { TaskPoolDto, TaskRecordListQuery, TaskService } from '../tasks/services/task.service';
import { WorkflowService } from '../workflow/services/workflow.service';
import { AiBriefingService } from './ai-briefing.service';
import { HOME_TASK_ROWS, HomeComponent } from './home.component';
import { preserveDocumentLanguage } from '../../../testing/document-language';

// ACC-271 — Home's My tasks panel as drawn (Task Screens §10): "{n} open ·
// {m} overdue", the decision line, the pool line, the rows and "All my tasks".
// Real translation files, so the counted strings are what a reader sees.

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

let n = 0;
function task(status: string, dueAt: string | null, over: Record<string, unknown> = {}) {
  const id = `t${++n}`;
  return {
    id,
    title: `Task ${id}`,
    sourceType: 'COMMITTEE',
    sourceId: 'c-1',
    status,
    dueAt,
    onHoldUntil: null,
    pool: null,
    evidenceCount: 0,
    openRequest: null,
    canManage: false,
    ...over,
  };
}

const PAST = '2026-01-01T09:00:00.000Z';
const SOON = '2099-01-01T09:00:00.000Z';
const LATER = '2099-06-01T09:00:00.000Z';

describe('HomeComponent — the My tasks panel (ACC-271)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<HomeComponent>;
  let format: FormatService;
  let arabic: boolean;
  let myTasks: () => Observable<unknown[]>;
  let requests: () => Observable<unknown[]>;
  let rejected: () => Observable<{ items: unknown[]; total: number; matching: number }>;
  let available: () => Observable<unknown[]>;
  const calls = { my: 0, requests: 0, rejected: 0, available: 0, notifications: 0 };
  let recordListQuery: TaskRecordListQuery | null;

  beforeEach(() => {
    n = 0;
    arabic = false;
    Object.keys(calls).forEach((k) => (calls[k as keyof typeof calls] = 0));
    recordListQuery = null;
    myTasks = () => of([]);
    requests = () => of([]);
    rejected = () => of({ items: [], total: 20, matching: 0 });
    available = () => of([]);
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: TaskService,
          useValue: {
            getMyTasks: () => (calls.my++, myTasks()),
            getAwaitingDecision: () => (calls.requests++, requests()),
            getRecordList: (q: TaskRecordListQuery) => (calls.rejected++, (recordListQuery = q), rejected()),
            getAvailable: () => (calls.available++, available()),
          },
        },
        { provide: ChangeRequestService, useValue: { awaitingDecision: () => of([]) } },
        { provide: WorkflowService, useValue: { getAwaitingMe: () => of({ total: 0, rows: [] }) } },
        { provide: NotificationService, useValue: { list: () => (calls.notifications++, of({ data: [], total: 0, page: 1, pageSize: 5 })) } },
        { provide: AuthService, useValue: { currentUser: () => ({ name: 'Dr. Yasser Al-Amri' }) } },
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            isRtl: () => arabic,
            bilingual: (en: string, ar: string | null) => (arabic && ar ? ar : en),
          },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: () => false } },
        { provide: AiBriefingService, useValue: { get: () => of({ available: false, creditCost: 5, greeting: 'morning', briefing: null }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    format = TestBed.inject(FormatService);
  });

  function render(): HTMLElement {
    if (arabic) TestBed.inject(TranslateService).use('ar');
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (e: Element | null | undefined) => e?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);

  it('every read is fired together, once, when Home opens', () => {
    render();
    expect(calls).toEqual({ my: 1, requests: 1, rejected: 1, available: 1, notifications: 1 });
    expect(recordListQuery).toEqual({ view: 'created', status: ['REJECTED'], take: 1 });
  });

  it('the header: "My tasks", then "{n} open · {m} overdue", the overdue count marked late', () => {
    myTasks = () => of([task('IN_PROGRESS', PAST), task('PENDING', SOON), task('PENDING', null), task('COMPLETED', PAST)]);
    const el = render();
    expect(text(el.querySelector('#home-tasks-h'))).toBe('My tasks');
    expect(text(q(el, 'home-tasks-summary'))).toBe('3 open · 1 overdue');
    expect(q(el, 'home-tasks-summary')!.querySelector('.am-ht__late')).not.toBeNull();
  });

  it('nothing overdue: the count is not marked late', () => {
    myTasks = () => of([task('PENDING', SOON)]);
    const el = render();
    expect(text(q(el, 'home-tasks-summary'))).toBe('1 open · 0 overdue');
    expect(q(el, 'home-tasks-summary')!.querySelector('.am-ht__late')).toBeNull();
  });

  it('the decision line: requests plus my rejected tasks, linked to /tasks; the rejected count is `matching`, never `total`', () => {
    requests = () => of([{ id: 'r1' }, { id: 'r2' }]);
    rejected = () => of({ items: [], total: 20, matching: 1 });
    const el = render();
    const line = q(el, 'home-decisions')!;
    expect(line.tagName).toBe('A');
    expect(line.getAttribute('href')).toBe('/tasks');
    expect(text(line)).toBe('3 waiting for your decision 2 requests · 1 rejected ›');
  });

  it('nothing to decide: no decision line', () => {
    expect(q(render(), 'home-decisions')).toBeNull();
  });

  it('a failed read says "— waiting for your decision · Retry", never 0; Retry reads both again', () => {
    let fail = true;
    requests = () => (fail ? throwError(() => new Error('boom')) : of([{ id: 'r1' }]));
    const el = render();
    const line = q(el, 'home-decisions')!;
    expect(text(line)).toBe('— waiting for your decision · Retry');
    expect(text(line)).not.toContain('0');

    fail = false;
    (q(el, 'home-decisions-retry') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(calls.requests).toBe(2);
    expect(calls.rejected).toBe(2);
    expect(text(q(el, 'home-decisions'))).toBe('1 waiting for your decision 1 request · 0 rejected ›');
  });

  it('the rejected read failing alone shows the same failed line', () => {
    requests = () => of([{ id: 'r1' }]);
    rejected = () => throwError(() => new Error('boom'));
    expect(text(q(render(), 'home-decisions'))).toBe('— waiting for your decision · Retry');
  });

  it('the pool line: how many wait in my pools, each pool named once, linked to /tasks', () => {
    available = () => of([task('UNASSIGNED', SOON, { pool: POOL }), task('UNASSIGNED', SOON, { pool: POOL })]);
    const el = render();
    const line = q(el, 'home-available')!;
    expect(line.getAttribute('href')).toBe('/tasks');
    expect(text(line)).toBe('2 available to pick up Quality Officer, Pharmacy ›');
  });

  it('nothing to pick up, or the read failing: no pool line, and the rest of the panel still renders', () => {
    available = () => throwError(() => new Error('boom'));
    myTasks = () => of([task('PENDING', SOON)]);
    const el = render();
    expect(q(el, 'home-available')).toBeNull();
    expect(el.querySelectorAll('[data-testid="home-task-row"]').length).toBe(1);
  });

  it('rows as drawn: overdue first, then soonest due, undated after, on hold last; at most five; "All my tasks"', () => {
    const held = task('ON_HOLD', LATER, { onHoldUntil: '2099-02-01T00:00:00.000Z' });
    const undated = task('PENDING', null);
    const later = task('PENDING', LATER);
    const soon = task('IN_PROGRESS', SOON);
    const late = task('PENDING', PAST);
    const extra = task('PENDING', LATER);
    myTasks = () => of([held, undated, later, soon, late, extra]);
    const el = render();
    const rows = Array.from(el.querySelectorAll('[data-testid="home-task-row"]'));
    expect(rows.length).toBe(HOME_TASK_ROWS);
    expect(rows.map((r) => text(r.querySelector('am-task-link')))).toEqual([late.title, soon.title, later.title, extra.title, undated.title]);
    expect(text(rows[0]!.querySelector('.am-ht__row-meta'))).toBe('◇ Committee · Assigned');
    expect(text(rows[0]!.querySelector('.am-ht__due'))).toBe(`Due ${format.dateTime(PAST)}`);
    expect(text(rows[4]!.querySelector('.am-ht__due'))).toBe('—');
    const all = q(el, 'home-tasks-all')!;
    expect(text(all)).toBe('All my tasks');
    expect(all.getAttribute('href')).toBe('/tasks');
  });

  it('an on-hold row reads "On hold until {date}"', () => {
    myTasks = () => of([task('ON_HOLD', LATER, { onHoldUntil: '2099-02-01T00:00:00.000Z' })]);
    const el = render();
    expect(text(el.querySelector('.am-ht__row-meta'))).toBe(`◇ Committee · On hold until ${format.date('2099-02-01T00:00:00.000Z')}`);
  });

  it('a row that carries its record name shows it after the type', () => {
    myTasks = () => of([task('PENDING', SOON, { record: { nameEn: 'Quality Committee', nameAr: null } })]);
    expect(text(render().querySelector('.am-ht__row-meta'))).toBe('◇ Committee · Quality Committee · Assigned');
  });

  it('Arabic: the counts, the lines and the chevron read right to left', () => {
    arabic = true;
    myTasks = () => of([task('PENDING', PAST), task('PENDING', SOON)]);
    requests = () => of([{ id: 'r1' }]);
    rejected = () => of({ items: [], total: 3, matching: 1 });
    available = () => of([task('UNASSIGNED', SOON, { pool: POOL })]);
    const el = render();
    expect(text(el.querySelector('#home-tasks-h'))).toBe(ar.home.myTasks);
    expect(text(q(el, 'home-tasks-summary'))).toBe('مهمتان مفتوحتان · متأخرة واحدة');
    expect(text(q(el, 'home-decisions'))).toBe('عنصران بانتظار قرارك طلب واحد · مهمة مرفوضة واحدة ‹');
    expect(text(q(el, 'home-available'))).toBe('مهمة واحدة متاحة للاستلام مسؤول الجودة، الصيدلية ‹');
    expect(text(q(el, 'home-tasks-all'))).toBe('كل مهامي');
  });
});
