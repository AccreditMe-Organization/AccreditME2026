import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { loadTranslationsForTest } from '../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { TestFormatContext } from '../../core/formatting/format-context';
import { HomeComponent } from './home.component';
import { MyWorkCountsService } from './my-work-counts.service';
import { HomeSpecCalls, HomeSpecOptions, awaitingMe, awaitingRow, homeProviders, recordList, taskRow } from './home.testing';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

// ACC-279 — Home to the App Shell design: one Home for everyone, each part on
// its own permission and module, every failed count said with Retry and never
// as 0, and no Notifications panel (the bell holds them).
describe('HomeComponent (ACC-279)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HomeComponent>;
  let calls: HomeSpecCalls;

  // 09:30 in Riyadh (UTC+3) is 06:30Z.
  const MORNING_RIYADH = new Date('2026-11-06T06:30:00.000Z');

  function configure(opts: HomeSpecOptions, language: 'en' | 'ar', now: Date): void {
    jasmine.clock().mockDate(now);
    const setup = homeProviders(opts);
    calls = setup.calls;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HomeComponent], providers: setup.providers });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    TestBed.inject(TranslateService).use(language);
  }

  function build(opts: HomeSpecOptions = {}, language: 'en' | 'ar' = 'en', now = MORNING_RIYADH): void {
    configure(opts, language, now);
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) => el().querySelector(`[data-testid="${testId}"]`);
  const h1 = () => el().querySelector('h1')?.textContent?.trim();

  describe("the greeting, in the organisation's time zone", () => {
    it('English has three: morning before noon, afternoon before five, evening after', () => {
      build({}, 'en', MORNING_RIYADH);
      expect(h1()).toBe('Good morning, Layla Al-Harbi');
      build({}, 'en', new Date('2026-11-06T10:30:00.000Z')); // 13:30 Riyadh
      expect(h1()).toBe('Good afternoon, Layla Al-Harbi');
      build({}, 'en', new Date('2026-11-06T15:30:00.000Z')); // 18:30 Riyadh
      expect(h1()).toBe('Good evening, Layla Al-Harbi');
    });

    it('Arabic has two: صباح الخير before noon, مساء الخير after', () => {
      build({}, 'ar', MORNING_RIYADH);
      expect(h1()).toBe('صباح الخير، Layla Al-Harbi');
      build({}, 'ar', new Date('2026-11-06T10:30:00.000Z'));
      expect(h1()).toBe('مساء الخير، Layla Al-Harbi');
      build({}, 'ar', new Date('2026-11-06T15:30:00.000Z'));
      expect(h1()).toBe('مساء الخير، Layla Al-Harbi');
    });

    it("the zone is the organisation's, not the browser's: 23:30Z is morning in Riyadh", () => {
      build({}, 'en', new Date('2026-11-05T23:30:00.000Z')); // 02:30 Riyadh
      expect(h1()).toBe('Good morning, Layla Al-Harbi');
    });
  });

  it('has no purpose line and no header actions (Q7: New task comes with ACC-280)', () => {
    build({ permissions: ['committees:create_tasks', 'users:invite', 'setup:view'] });
    const header = el().querySelector('app-page-header')!;
    expect(header.querySelector('p')).toBeNull();
    expect(header.querySelectorAll('button, a').length).toBe(0);
  });

  it('reads neither the notifications nor the unbounded my-tasks list', () => {
    build();
    expect(el().textContent).not.toContain('Recent Notifications');
    expect(calls.myTasksLegacy).toBe(0);
  });

  describe('the personal tiles', () => {
    it('Open tasks is the count of every open task, with "n overdue"', () => {
      build({ myTasks: recordList([taskRow()], 7), myOverdue: 2 });
      expect(q('home-tile-tasks-value')!.textContent!.trim()).toBe('7');
      expect(q('home-tile-tasks-meta')!.textContent!.trim()).toBe('2 overdue');
      // The same read as /tasks' My tasks: the mine view, open statuses, five rows.
      expect(calls.recordList).toContain(jasmine.objectContaining({ view: 'mine', status: ['PENDING', 'IN_PROGRESS', 'ON_HOLD'], take: 5 }));
    });

    it('a failed task count says so with Try again — never 0', () => {
      build({ myTasks: 'fail' });
      expect(q('home-tile-tasks-failed')!.textContent).toContain("Couldn't load");
      expect(q('home-tile-tasks-retry')).not.toBeNull();
      expect(q('home-tile-tasks-value')).toBeNull();
    });

    it('a failed overdue count hides the meta behind its own Try again — never "0 overdue"', () => {
      build({ myTasks: recordList([], 3), myOverdue: 'fail' });
      expect(q('home-tile-tasks-value')!.textContent!.trim()).toBe('3');
      expect(q('home-tile-tasks-meta-failed')!.textContent).toContain("Overdue count couldn't load");
      expect(el().textContent).not.toContain('0 overdue');
    });

    it('Retry re-runs only its own read', () => {
      build({ myTasks: 'fail' });
      const awaitingBefore = calls.awaitingMe;
      const mineBefore = calls.recordList.filter((r) => r.view === 'mine' && !r.overdue).length;
      (q('home-tile-tasks-retry') as HTMLButtonElement).click();
      expect(calls.awaitingMe).toBe(awaitingBefore);
      expect(calls.recordList.filter((r) => r.view === 'mine' && !r.overdue).length).toBe(mineBefore + 1);
    });

    it('Awaiting me counts stage records and change requests, with the oldest age', () => {
      build({
        permissions: ['committees:approve'],
        awaiting: awaitingMe([awaitingRow({ since: '2026-11-03T06:00:00.000Z' })], 2),
        changes: [],
      });
      expect(q('home-tile-awaiting-value')!.textContent!.trim()).toBe('2');
      expect(q('home-tile-awaiting-meta')!.textContent!.trim()).toBe('oldest 3 days');
    });

    it('Awaiting me fails as a whole when either half fails: a partial count is a wrong count', () => {
      build({ permissions: ['committees:approve'], awaiting: awaitingMe([awaitingRow()]), changes: 'fail' });
      expect(q('home-tile-awaiting-failed')).not.toBeNull();
      expect(q('home-tile-awaiting-value')).toBeNull();
    });

    it('My committees shows the total from GET /committees/mine', () => {
      build({ committees: { total: 3, rows: [] } });
      expect(q('home-tile-committees-value')!.textContent!.trim()).toBe('3');
    });

    it('with the Committees module closed, neither the tile nor the panel is drawn, nor read', () => {
      configure({ committees: { total: 3, rows: [] } }, 'en', MORNING_RIYADH);
      spyOn(TestBed.inject(MyWorkCountsService), 'committeesOpen').and.returnValue(false);
      fixture = TestBed.createComponent(HomeComponent);
      fixture.detectChanges();
      expect(q('home-tile-committees')).toBeNull();
      expect(el().querySelector('app-home-my-committees')).toBeNull();
      expect(calls.committees).toBe(0);
    });
  });

  describe('the admin block', () => {
    it('is absent, and its read never sent, without any of its permissions', () => {
      build({ permissions: ['committees:approve', 'tenant:manage_config'] });
      expect(q('home-admin')).toBeNull();
      expect(calls.summary).toBe(0);
    });

    it('sits above the personal tiles when the viewer holds one of its permissions', () => {
      build({ permissions: ['setup:view'], summary: { setup: { open: 0, blocksWork: 0, top: [], freshness: [] }, users: null, committees: null } });
      const admin = q('home-admin')!;
      const tiles = q('home-tiles')!;
      expect(admin.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('the decision and available lines', () => {
    it('are absent with nothing to say', () => {
      build();
      expect(q('home-decisions')).toBeNull();
      expect(q('home-available')).toBeNull();
    });

    it('a failed available read says so with Try again, instead of vanishing', () => {
      build({ available: 'fail' });
      expect(q('home-available')!.textContent).toContain("What you can pick up couldn't be loaded");
      expect(q('home-available-retry')).not.toBeNull();
    });
  });

  it('the three panels are in the drawn order: My tasks, My committees, Awaiting my action', () => {
    build();
    const panels = Array.from(q('home-panels')!.children).map((c) => c.tagName.toLowerCase());
    expect(panels).toEqual(['app-home-my-tasks', 'app-home-my-committees', 'app-home-awaiting']);
  });
});
