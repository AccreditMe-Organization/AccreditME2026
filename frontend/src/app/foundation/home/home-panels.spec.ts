import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { loadTranslationsForTest } from '../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { TestFormatContext } from '../../core/formatting/format-context';
import { REQUEST } from '../committees/change-requests/change-request.testing';
import { HomeAwaitingComponent } from './home-awaiting.component';
import { HomeMyCommitteesComponent } from './home-my-committees.component';
import { HomeMyTasksComponent } from './home-my-tasks.component';
import { MyWorkCountsService } from './my-work-counts.service';
import { HomeSpecCalls, HomeSpecOptions, awaitingMe, awaitingRow, committeeRow, homeProviders, recordList, taskRow } from './home.testing';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

// ACC-279 — Home's three capped panels. Each reads MyWorkCountsService, so the
// panels, the tiles and the rail can never disagree.

@Component({
  standalone: true,
  imports: [HomeMyTasksComponent, HomeMyCommitteesComponent, HomeAwaitingComponent],
  template: `<div data-fill-panels><app-home-my-tasks /><app-home-my-committees /><app-home-awaiting /></div>`,
})
class PanelsHost {}

describe('Home panels (ACC-279)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<PanelsHost>;
  let calls: HomeSpecCalls;
  const NOW = new Date('2026-11-06T06:30:00.000Z');

  function build(opts: HomeSpecOptions = {}, language: 'en' | 'ar' = 'en'): void {
    jasmine.clock().mockDate(NOW);
    const setup = homeProviders(opts);
    calls = setup.calls;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [PanelsHost], providers: setup.providers });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(MyWorkCountsService).init();
    fixture = TestBed.createComponent(PanelsHost);
    fixture.detectChanges();
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  const el = () => fixture.nativeElement as HTMLElement;
  const all = (testId: string) => Array.from(el().querySelectorAll(`[data-testid="${testId}"]`));
  const one = (testId: string) => el().querySelector(`[data-testid="${testId}"]`);

  describe('My tasks', () => {
    it('five rows in the server\'s order, the count of all of them, the overdue chip, and All my tasks', () => {
      build({
        myTasks: recordList(
          [
            taskRow({ id: 'a', title: 'Late one', dueAt: '2026-10-31T06:00:00.000Z' }),
            taskRow({ id: 'b', title: 'Due soon', dueAt: '2026-11-09T10:00:00.000Z' }),
            taskRow({ id: 'c', title: 'Held', status: 'ON_HOLD', onHoldUntil: '2026-11-20T05:00:00.000Z', record: null }),
          ],
          7,
        ),
        myOverdue: 1,
      });
      const rows = all('home-task-row').map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
      expect(rows.length).toBe(3);
      expect(rows[0]).toContain('Late one');
      expect(rows[0]).toContain('Committee · IPC Committee');
      expect(rows[0]).toContain('6 days overdue');
      expect(rows[1]).toContain('Due 9 Nov 2026, 13:00');
      expect(rows[2]).toContain('On hold until 20 Nov 2026');
      expect(one('home-tasks-count')!.textContent!.trim()).toBe('7');
      expect(one('home-tasks-overdue')!.textContent!.trim()).toBe('1 overdue');
      expect(one('home-tasks-all')!.getAttribute('href')).toBe('/tasks');
      // The header link is the full view: no second "See all" in the footer (Q10).
      expect(one('home-tasks-see-all')).toBeNull();
    });

    it('a record the server did not name is shown by its type alone', () => {
      build({ myTasks: recordList([taskRow({ record: { type: 'COMMITTEE', id: 'c-9', nameEn: null, nameAr: null } })]) });
      expect(all('home-task-row')[0]!.textContent).toContain('Committee');
      expect(all('home-task-row')[0]!.textContent).not.toContain('IPC');
    });

    it('empty: "You have no open tasks."; failed: says so, with Try again', () => {
      build({ myTasks: recordList([]) });
      expect(one('home-tasks-empty')!.textContent).toContain('You have no open tasks.');
      build({ myTasks: 'fail' });
      expect(one('home-tasks-error')!.textContent).toContain("Your tasks couldn't be loaded.");
      expect(one('home-tasks-count')!.textContent!.trim()).toBe('—');
    });
  });

  describe('My committees', () => {
    it('each row names the committee, the person\'s seat and the stage, with the status chip by flags', () => {
      build({
        permissions: ['committees:view'],
        committees: {
          total: 4,
          rows: [
            committeeRow(),
            committeeRow({ committeeId: 'c-2', nameEn: 'Medication Safety', seat: { id: 'secretary', labelEn: 'Secretary', labelAr: null }, stage: { nameEn: 'Terms Review', nameAr: null }, isInForce: false }),
            committeeRow({ committeeId: 'c-3', nameEn: 'Old Board', isInForce: true, isDissolving: true }),
          ],
        },
      });
      const rows = all('home-committee-row').map((r) => r.textContent!.replace(/\s+/g, ' ').replace(/\s*·\s*/g, ' · ').trim());
      expect(rows[0]).toContain('Infection Prevention & Control');
      expect(rows[0]).toContain('Member · Active');
      expect(rows[0]).toContain('In force');
      expect(rows[1]).toContain('Secretary · Terms Review');
      expect(rows[1]).toContain('Not yet in force');
      expect(rows[2]).toContain('Being dissolved');
      expect(one('home-committees-count')!.textContent!.trim()).toBe('4');
    });

    // Every row is one of the viewer's own active committees, which a member may
    // open since ACC-281: every row links. "All committees" follows the rail's own
    // rule for the Committees item (committees:view, or a member).
    it('a member without committees:view: every row links to its committee, and All committees shows', () => {
      build({ permissions: [], committees: { total: 1, rows: [committeeRow()] } });
      const row = all('home-committee-row')[0]!;
      expect(row.textContent).withContext('the row rendered').toContain('Infection Prevention & Control');
      expect(row.querySelector('a')!.getAttribute('href')).toBe('/committees/c-1');
      expect(one('home-committees-all')!.getAttribute('href')).toBe('/committees');
    });

    it('a committees:view holder: the row link and All committees, as before', () => {
      build({ permissions: ['committees:view'], committees: { total: 1, rows: [committeeRow()] } });
      expect(all('home-committee-row')[0]!.querySelector('a')!.getAttribute('href')).toBe('/committees/c-1');
      expect(one('home-committees-all')).not.toBeNull();
    });

    it('someone on no committee and without committees:view gets no All committees', () => {
      build({ permissions: [], committees: { total: 0, rows: [] } });
      expect(one('home-committees-empty')).withContext('the panel rendered').not.toBeNull();
      expect(one('home-committees-all')).toBeNull();
    });

    // A platform admin's work counts ask nothing (ACC-281), so the panel holds no
    // committee and offers no link.
    it('a platform admin: no committee row, no row link and no All committees', () => {
      build({ permissions: [], platformAdmin: true, committees: { total: 1, rows: [committeeRow()] } });
      expect(calls.committees).withContext('My committees is not asked').toBe(0);
      expect(all('home-committee-row')).toEqual([]);
      expect(one('home-committees-all')).toBeNull();
    });

    it('in Arabic, names and seats are the Arabic ones, and an empty Arabic name falls back to English', () => {
      build({
        committees: { total: 2, rows: [committeeRow(), committeeRow({ committeeId: 'c-2', nameEn: 'Medication Safety', nameAr: null })] },
      }, 'ar');
      const rows = all('home-committee-row').map((r) => r.textContent!);
      expect(rows[0]).toContain('مكافحة العدوى');
      expect(rows[0]).toContain('عضو');
      expect(rows[1]).toContain('Medication Safety');
    });

    it('empty and failed', () => {
      build({ committees: { total: 0, rows: [] } });
      expect(one('home-committees-empty')!.textContent).toContain("You aren't on any committee.");
      build({ committees: 'fail' });
      expect(one('home-committees-error')!.textContent).toContain("Your committees couldn't be loaded.");
    });
  });

  describe('Awaiting my action', () => {
    it('merges stage records and change requests, oldest first, with how long each has waited', () => {
      build({
        permissions: ['committees:approve'],
        awaiting: awaitingMe([awaitingRow({ since: '2026-11-03T06:00:00.000Z' })]),
        changes: [REQUEST({ submittedAt: '2026-11-01T06:00:00.000Z' })],
      });
      const rows = Array.from(el().querySelectorAll('app-home-awaiting .am-cp-row')).map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
      expect(rows[0]).toContain('Change request 3 · Patient Experience Committee');
      expect(rows[0]).toContain('From Nora Al-Otaibi');
      expect(rows[0]).toContain('5 days waiting');
      expect(rows[1]).toContain('Medication Safety');
      expect(rows[1]).toContain('Terms Review 2/6');
      expect(rows[1]).toContain('3 days waiting');
      expect(one('home-awaiting-count')!.textContent!.trim()).toBe('2');
    });

    it('change requests are asked only of committees:approve holders', () => {
      build({ permissions: [] });
      expect(calls.changes).toBe(0);
      build({ permissions: ['committees:approve'] });
      expect(calls.changes).toBe(1);
    });

    it('is always shown: with nothing waiting it says so (Q9)', () => {
      build({ awaiting: awaitingMe([]) });
      expect(one('home-awaiting-empty')!.textContent).toContain('Nothing is waiting for you.');
    });

    it('a failed read says so with Try again, instead of vanishing (the ACC-70 silent failure)', () => {
      build({ awaiting: 'fail' });
      expect(one('home-awaiting-error')!.textContent).toContain("This couldn't be loaded.");
      const before = calls.awaitingMe;
      (one('home-awaiting-error')!.querySelector('button') as HTMLButtonElement).click();
      expect(calls.awaitingMe).toBe(before + 1);
    });
  });
});
