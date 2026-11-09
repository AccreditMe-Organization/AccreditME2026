import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { environment } from '../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import type { WorkflowAwaitingRowDto } from '../workflow/services/workflow.service';
import { AwaitingPageComponent } from './awaiting-page.component';

// ACC-120 — the Awaiting my action page: every record and change request
// waiting on the person, oldest first, stage rows paged by the server (50),
// change requests read once.

const STAGES_URL = `${environment.apiUrl}/workflows/awaiting-me`;
const CHANGES_URL = `${environment.apiUrl}/committee-change-requests/awaiting-decision`;
const DAY = 86_400_000;
const BASE = Date.parse('2026-01-01T00:00:00.000Z');
const at = (days: number) => new Date(BASE + days * DAY).toISOString();

/** Stage row i entered its stage on day i (oldest first, as the server orders them). */
const stage = (i: number): WorkflowAwaitingRowDto => ({
  instanceStageId: `is-${String(i).padStart(3, '0')}`,
  record: { type: 'COMMITTEE', id: `c-${i}`, nameEn: `Committee ${i}`, nameAr: `لجنة ${i}` },
  stage: { id: 'st', nameEn: 'Review', nameAr: 'المراجعة', position: 2, stageCount: 4 },
  since: at(i),
});
const change = (id: string, day: number) => ({
  id,
  committeeId: 'c-x',
  committeeNameEn: 'Infection Control',
  committeeNameAr: 'مكافحة العدوى',
  number: 7,
  requestedBy: { id: 'u', name: 'Sara Ali' },
  submittedAt: at(day),
  createdAt: at(day),
});

describe('AwaitingPageComponent (ACC-120)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<AwaitingPageComponent>;
  let http: HttpTestingController;

  function setup(opts: { approve?: boolean; language?: 'en' | 'ar' } = {}): HTMLElement {
    TestBed.configureTestingModule({
      imports: [AwaitingPageComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => !!opts.approve && p === 'committees:approve' } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.language ?? 'en');
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AwaitingPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const stageReq = () => http.expectOne((r) => r.url === STAGES_URL);
  /** Answers a stage page from `all`, by the request's own skip and take. */
  const answerStages = (all: WorkflowAwaitingRowDto[]) => {
    const req = stageReq();
    const skip = Number(req.request.params.get('skip'));
    const take = Number(req.request.params.get('take'));
    req.flush({ total: all.length, rows: all.slice(skip, skip + take), oldestSince: all[0]?.since ?? null });
    return { skip, take };
  };
  const shownIds = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-awaiting-id]')).map((li) => li.getAttribute('data-awaiting-id')!);
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const pressMore = (el: HTMLElement) => {
    el.querySelector<HTMLButtonElement>('[data-testid="awaiting-more"]')!.click();
    fixture.detectChanges();
  };

  afterEach(() => http.verify());

  it('the first load asks for the first 50 stage rows exactly, and no change requests without committees:approve', () => {
    setup();
    const req = stageReq();
    expect(req.request.params.get('skip')).toBe('0');
    expect(req.request.params.get('take')).toBe('50');
    expect(req.request.params.keys().sort()).toEqual(['skip', 'take']);
    http.expectNone(CHANGES_URL);
    req.flush({ total: 0, rows: [], oldestSince: null });
  });

  it('with committees:approve it asks for the change requests too, in parallel', () => {
    setup({ approve: true });
    const stages = stageReq();
    const changes = http.expectOne(CHANGES_URL);
    stages.flush({ total: 0, rows: [], oldestSince: null });
    changes.flush([]);
  });

  it('shows a skeleton while loading', () => {
    const el = setup();
    expect(el.querySelector('[data-testid="awaiting-skeleton"]')).not.toBeNull();
    stageReq().flush({ total: 0, rows: [], oldestSince: null });
  });

  it('nothing waiting: "Nothing is waiting for you."', () => {
    const el = setup({ approve: true });
    stageReq().flush({ total: 0, rows: [], oldestSince: null });
    http.expectOne(CHANGES_URL).flush([]);
    fixture.detectChanges();
    expect(text(el.querySelector('[data-testid="awaiting-empty"]'))).toBe('Nothing is waiting for you.');
    expect(el.querySelector('[data-testid="awaiting-more"]')).toBeNull();
  });

  it('three pages: 120 stage rows and 3 change requests, in order, with no row repeated or skipped', () => {
    const all = Array.from({ length: 120 }, (_, i) => stage(i + 1));
    // Older than everything, between rows 70 and 71, and newer than everything.
    const changes = [change('cr-old', 0), change('cr-mid', 70.5), change('cr-new', 200)];
    const el = setup({ approve: true });
    expect(answerStages(all)).toEqual({ skip: 0, take: 50 });
    http.expectOne(CHANGES_URL).flush(changes);
    fixture.detectChanges();

    const stageIds = (n: number) => all.slice(0, n).map((s) => s.instanceStageId);
    // Page 1: 50 stage rows and the one change request older than row 50.
    expect(shownIds(el)).toEqual(['cr-old', ...stageIds(50)]);
    expect(text(el.querySelector('[data-testid="awaiting-count"]'))).toBe('123');

    pressMore(el);
    expect(answerStages(all)).toEqual({ skip: 50, take: 50 });
    http.expectNone(CHANGES_URL);
    fixture.detectChanges();
    expect(shownIds(el)).toEqual(['cr-old', ...stageIds(70), 'cr-mid', ...all.slice(70, 100).map((s) => s.instanceStageId)]);

    pressMore(el);
    expect(answerStages(all)).toEqual({ skip: 100, take: 50 });
    http.expectNone(CHANGES_URL);
    fixture.detectChanges();
    const final = shownIds(el);
    expect(final).toEqual(['cr-old', ...stageIds(70), 'cr-mid', ...all.slice(70).map((s) => s.instanceStageId), 'cr-new']);
    expect(new Set(final).size).withContext('no duplicates').toBe(123);
    expect(el.querySelector('[data-testid="awaiting-more"]')).withContext('nothing left').toBeNull();
  });

  it('Load more never re-reads the change requests', () => {
    const all = Array.from({ length: 60 }, (_, i) => stage(i + 1));
    const el = setup({ approve: true });
    answerStages(all);
    http.expectOne(CHANGES_URL).flush([change('cr-1', 100)]);
    fixture.detectChanges();
    pressMore(el);
    answerStages(all);
    http.expectNone(CHANGES_URL);
    fixture.detectChanges();
    expect(shownIds(el).at(-1)).toBe('cr-1');
  });

  it('either read failing fails the page; Retry re-runs both', () => {
    const el = setup({ approve: true });
    stageReq().flush({ total: 0, rows: [], oldestSince: null });
    http.expectOne(CHANGES_URL).flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(text(el.querySelector('[data-testid="awaiting-error"]'))).toContain("This couldn't be loaded.");
    expect(el.querySelector('[data-testid="awaiting-list"]')).toBeNull();

    el.querySelector<HTMLButtonElement>('[data-testid="awaiting-retry"]')!.click();
    fixture.detectChanges();
    answerStages([stage(1)]);
    http.expectOne(CHANGES_URL).flush([]);
    fixture.detectChanges();
    expect(shownIds(el)).toEqual(['is-001']);
  });

  it('the stage read failing fails the page too', () => {
    const el = setup();
    stageReq().flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="awaiting-error"]')).not.toBeNull();
  });

  it('Load more failing keeps the rows and offers Retry, which asks the same page', () => {
    const all = Array.from({ length: 60 }, (_, i) => stage(i + 1));
    const el = setup();
    answerStages(all);
    fixture.detectChanges();
    pressMore(el);
    const failed = stageReq();
    expect(failed.request.params.get('skip')).toBe('50');
    failed.flush({}, { status: 503, statusText: 'Unavailable' });
    fixture.detectChanges();
    expect(shownIds(el).length).toBe(50);
    expect(text(el.querySelector('[data-testid="awaiting-more-failed"]'))).toContain("This couldn't be loaded.");

    el.querySelector<HTMLButtonElement>('[data-testid="awaiting-more-retry"]')!.click();
    fixture.detectChanges();
    expect(answerStages(all)).toEqual({ skip: 50, take: 50 });
    fixture.detectChanges();
    expect(shownIds(el).length).toBe(60);
  });

  it('a row: the record linked, "type · stage n/N", and how long it has waited', () => {
    const el = setup();
    answerStages([stage(1)]);
    fixture.detectChanges();
    const li = el.querySelector('[data-awaiting-id="is-001"]')!;
    expect(li.querySelector('a')?.getAttribute('href')).toBe('/committees/c-1');
    expect(text(li)).toContain('Committee 1');
    expect(text(li)).toContain('Committee · Review 2/4');
  });

  it('in Arabic: the title, the row and the empty line', () => {
    const el = setup({ language: 'ar' });
    answerStages([stage(1)]);
    fixture.detectChanges();
    expect(text(el.querySelector('h1'))).toBe('بانتظار إجرائي');
    expect(text(el.querySelector('[data-awaiting-id="is-001"]'))).toContain('لجنة 1');
  });
});
