import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { FormatService } from '../../../../core/formatting';
import {
  SetupConditionDto,
  SetupConditionFreshnessDto,
  SetupHealthDto,
} from '../../services/setup-health.service';
import { SetupHealthPageComponent } from './setup-health-page.component';

// ACC-82 — Setup health page (SYSTEM-REFERENCE §13.9). Since ACC-94 against
// the real en.json and ar.json, so every assertion is text a user sees.

const NOW = new Date();
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000).toISOString();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60 * 1000).toISOString();

const condition = (overrides: Partial<SetupConditionDto> & Pick<SetupConditionDto, 'id'>): SetupConditionDto => ({
  type: 'ORG_UNIT_WITHOUT_HEAD',
  severity: 'AT_RISK',
  objectId: `obj-${overrides.id}`,
  subject: { nameEn: `Name ${overrides.id}`, nameAr: `اسم ${overrides.id}`, escalationResolves: true },
  openedAt: daysAgo(3),
  ageBasis: 'OBJECT',
  lastSeenAt: minutesAgo(10),
  clearedAt: null,
  ...overrides,
});

const current = (computedAt = minutesAgo(10)): SetupConditionFreshnessDto[] =>
  (['ORG_UNIT_WITHOUT_HEAD', 'STAGE_WITHOUT_ASSIGNEE', 'TASK_WITHOUT_OWNER'] as const).map(
    (type) => ({ type, status: 'CURRENT', computedAt }),
  );

describe('SetupHealthPageComponent (ACC-82)', () => {
  let permissions: Set<string>;
  let arabic: boolean;

  const ALL_FIX_PERMISSIONS = [
    'org:view',
    'org:manage',
    'workflows:view',
    'workflows:manage',
    'tasks:manage',
    'tasks:reassign',
  ];

  function render(health: SetupHealthDto): SetupHealthPageComponent {
    TestBed.configureTestingModule({
      imports: [SetupHealthPageComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.has(p) } },
        { provide: LanguageService, useValue: { isArabic: () => arabic } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    const fixture = TestBed.createComponent(SetupHealthPageComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/setup-health`).flush(health);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const rowsById = (page: SetupHealthPageComponent) =>
    Object.fromEntries(page.groups().flatMap((g) => g.rows).map((r) => [r.id, r]));

  beforeEach(() => {
    permissions = new Set(ALL_FIX_PERMISSIONS);
    arabic = false;
  });

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('groups by type, orders groups by their most severe row, and gives each group that severity', () => {
    const page = render({
      open: [
        condition({ id: 'unit-risk-1', type: 'ORG_UNIT_WITHOUT_HEAD' }),
        condition({ id: 'unit-risk-2', type: 'ORG_UNIT_WITHOUT_HEAD' }),
        condition({
          id: 'task',
          type: 'TASK_WITHOUT_OWNER',
          severity: 'BLOCKS_WORK',
          ageBasis: 'FIRST_DETECTED',
          subject: { title: 'Chase figures' },
        }),
        condition({
          id: 'stage',
          type: 'STAGE_WITHOUT_ASSIGNEE',
          severity: 'BLOCKS_WORK',
          subject: { nameEn: 'Terms Review', templateId: 'tpl-1', affectedInstances: 1 },
        }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    expect(page.groups().map((g) => [g.type, g.severity, g.rows.length])).toEqual([
      // Blocking groups first (in type order), then the at-risk unit group,
      // even though units come first in type order.
      ['STAGE_WITHOUT_ASSIGNEE', 'BLOCKS_WORK', 1],
      ['TASK_WITHOUT_OWNER', 'BLOCKS_WORK', 1],
      ['ORG_UNIT_WITHOUT_HEAD', 'AT_RISK', 2],
    ]);
  });

  it('filters by severity, and counts every severity regardless of the filter', () => {
    const page = render({
      open: [
        condition({ id: 'a', severity: 'BLOCKS_WORK', subject: { nameEn: 'A', escalationResolves: false } }),
        condition({ id: 'b' }),
        condition({ id: 'c' }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    page.filter.set('BLOCKS_WORK');

    expect(page.groups().flatMap((g) => g.rows.map((r) => r.id))).toEqual(['a']);
    expect(page.filters().map((f) => [f.key, f.count])).toEqual([
      ['ALL', 3],
      ['BLOCKS_WORK', 1],
      ['AT_RISK', 2],
    ]);
  });

  describe('Fix', () => {
    const health = (): SetupHealthDto => ({
      open: [
        condition({ id: 'unit', type: 'ORG_UNIT_WITHOUT_HEAD', objectId: 'unit-1' }),
        condition({
          id: 'stage',
          type: 'STAGE_WITHOUT_ASSIGNEE',
          objectId: 'stage-1',
          severity: 'BLOCKS_WORK',
          subject: { nameEn: 'Terms Review', templateId: 'tpl-1', templateNameEn: 'Committee', affectedInstances: 3 },
        }),
        condition({ id: 'task', type: 'TASK_WITHOUT_OWNER', objectId: 'task-1', subject: { title: 'T' } }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    it('links each row to the object it names', () => {
      const rows = rowsById(render(health()));

      expect(rows['unit']!.fix).toEqual({ label: 'Assign head', link: ['/organization'], queryParams: { head: 'unit-1' } });
      expect(rows['stage']!.fix).toEqual({
        label: 'Review stage',
        link: ['/workflows', 'tpl-1', 'stages'],
        queryParams: { stage: 'stage-1' },
      });
      expect(rows['task']!.fix).toEqual({ label: 'Reassign', link: ['/tasks/unassigned'], queryParams: { reassign: 'task-1' } });
      expect(Object.values(rows).every((r) => r.fixNeeds === null)).toBe(true);
    });

    // Both halves are needed: the destination's own view AND the save it offers.
    it('replaces the Fix with a note, never a disabled button, when either permission is missing', () => {
      permissions.delete('org:manage'); // can see the org tree, cannot assign a head
      permissions.delete('tasks:reassign'); // can open the triage view, cannot reassign

      const rows = rowsById(render(health()));

      expect(rows['unit']!.fix).toBeNull();
      expect(rows['unit']!.fixNeeds).toBe('Fixing this needs permission to manage the organization structure.');
      expect(rows['task']!.fix).toBeNull();
      expect(rows['task']!.fixNeeds).toBe('Fixing this needs permission to manage and reassign tasks.');
      expect(rows['stage']!.fix).not.toBeNull();
    });

    // §13.2 — the condition does not record whether the assignee or a trigger
    // is the cause, so only the stage row tells the admin to check both.
    it('tells the admin to check both the assignee and the triggers on a stage row, and only there', () => {
      const rows = rowsById(render(health()));

      expect(rows['stage']!.hint).toBe(
        'The cause is not recorded: check the stage’s assignee, and the trigger on each transition out of it.',
      );
      expect(rows['unit']!.hint).toBeNull();
      expect(rows['task']!.hint).toBeNull();
    });

    it('counts the blocked items with the correct plural form', () => {
      const rows = rowsById(render(health()));
      expect(rows['stage']!.consequence).toBe('3 open items cannot advance: no one can act on this stage.');
    });
  });

  // §13.3 — an age taken from first detection must not read as how long the
  // problem has existed.
  it('words the age by its basis', () => {
    const page = render({
      open: [
        condition({ id: 'unit', openedAt: daysAgo(9.2) }),
        condition({ id: 'stage', type: 'STAGE_WITHOUT_ASSIGNEE', openedAt: daysAgo(2.5), subject: { nameEn: 'S', templateId: 't' } }),
        condition({ id: 'task-old', type: 'TASK_WITHOUT_OWNER', ageBasis: 'FIRST_DETECTED', openedAt: daysAgo(4.5), subject: { title: 'T1' } }),
        condition({ id: 'task', type: 'TASK_WITHOUT_OWNER', ageBasis: 'FIRST_DETECTED', openedAt: minutesAgo(30), subject: { title: 'T' } }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    const ages = Object.fromEntries(page.groups().flatMap((g) => g.rows).map((r) => [r.id, r.age]));
    expect(ages).toEqual({
      unit: 'Open 9 days',
      stage: 'Open 2 days',
      'task-old': 'First detected 4 days ago',
      task: 'First detected in the last 24 hours',
    });
  });

  // ACC-94 — DEFECT 1. Arabic has six plural categories, and a count from 3 to
  // 10 takes the plural: "7 أيام", not "7 يومًا". The page used one fixed form
  // for every count of two or more. After a preposition the dual takes the
  // genitive too ("قبل يومين", not "يومان"), so the age reads as "…قبل" through
  // the layer's relative format, which gets both right.
  it('words Arabic ages with the correct plural form for each count', () => {
    arabic = true;
    const page = render({
      open: [
        condition({ id: 'two', openedAt: daysAgo(2.2) }),
        condition({ id: 'three', openedAt: daysAgo(3.2) }),
        condition({ id: 'seven', openedAt: daysAgo(7.2) }),
        condition({ id: 'eleven', openedAt: daysAgo(11.2) }),
        condition({ id: 'hundred', openedAt: daysAgo(100.2) }),
        condition({ id: 'detected', type: 'TASK_WITHOUT_OWNER', ageBasis: 'FIRST_DETECTED', openedAt: daysAgo(7.2), subject: { title: 'T' } }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    const ages = Object.fromEntries(page.groups().flatMap((g) => g.rows).map((r) => [r.id, r.age]));
    expect(ages).toEqual({
      two: 'فُتحت قبل يومين',
      three: 'فُتحت قبل 3 أيام',
      seven: 'فُتحت قبل 7 أيام',
      eleven: 'فُتحت قبل 11 يومًا',
      hundred: 'فُتحت قبل 100 يوم',
      detected: 'اكتُشفت أول مرة قبل 7 أيام',
    });
  });

  it('shows tenant names in the viewer’s language, falling back to English', () => {
    arabic = true;
    const page = render({
      open: [
        condition({ id: 'with-ar', subject: { nameEn: 'Radiology', nameAr: 'الأشعة' } }),
        condition({ id: 'no-ar', subject: { nameEn: 'Pharmacy', nameAr: null } }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    expect(page.groups()[0]!.rows.map((r) => r.objectName)).toEqual(['الأشعة', 'Pharmacy']);
  });

  // §13.5 — "when was this computed" has an answer per type.
  describe('freshness', () => {
    it('says nothing extra when every check is current, and states the check time', () => {
      const page = render({ open: [], recentlyCleared: [], freshness: current(minutesAgo(12)) });

      expect(page.freshnessNotices()).toEqual([]);
      expect(page.lastChecked()).toBe('Checked 12 minutes ago');
      expect(page.emptyMessageKey()).toBe('setupHealth.empty');
    });

    it('names each type that failed, is overdue or never ran — including types with no open rows', () => {
      const failedAt = minutesAgo(180);
      const overdueAt = minutesAgo(150);
      const page = render({
        open: [],
        recentlyCleared: [],
        freshness: [
          { type: 'ORG_UNIT_WITHOUT_HEAD', status: 'FAILED', computedAt: failedAt },
          { type: 'STAGE_WITHOUT_ASSIGNEE', status: 'OVERDUE', computedAt: overdueAt },
          { type: 'TASK_WITHOUT_OWNER', status: 'NEVER_RUN', computedAt: null },
        ],
      });
      // An absolute date and time (ACC-94): the layer's own format, specced in
      // format.service.spec.ts.
      const format = TestBed.inject(FormatService);

      expect(page.freshnessNotices()).toEqual([
        `Org unit without a head: the last check failed. Its rows are as last confirmed on ${format.dateTime(failedAt)}.`,
        `Workflow stage with no resolvable assignee: not checked since ${format.dateTime(overdueAt)}. Its rows may be out of date.`,
        'Task with no actionable owner: not checked yet, so an empty list for it does not mean nothing is wrong.',
      ]);
      // An empty page must not read as "nothing needs fixing" when checks did not run.
      expect(page.emptyMessageKey()).toBe('setupHealth.emptyUnconfirmed');
    });

    it('says a type that has never succeeded has nothing confirmed', () => {
      const freshness = current();
      freshness[2] = { type: 'TASK_WITHOUT_OWNER', status: 'FAILED', computedAt: null };

      const page = render({ open: [], recentlyCleared: [], freshness });

      expect(page.freshnessNotices()).toEqual([
        'Task with no actionable owner: no check has succeeded yet, so an empty list for it does not mean nothing is wrong.',
      ]);
    });

    it('reports the OLDEST confirmation, so the toolbar never overstates freshness', () => {
      const freshness = current(minutesAgo(5));
      freshness[2] = { type: 'TASK_WITHOUT_OWNER', status: 'CURRENT', computedAt: minutesAgo(50) };

      const page = render({ open: [], recentlyCleared: [], freshness });

      expect(page.lastChecked()).toBe('Checked 50 minutes ago');
    });
  });

  it('lists what cleared by itself, with the type and object', () => {
    const page = render({
      open: [],
      recentlyCleared: [
        condition({ id: 'gone', subject: { nameEn: 'Radiology' }, clearedAt: minutesAgo(90) }),
      ],
      freshness: current(),
    });

    expect(page.cleared()).toEqual([
      { id: 'gone', text: 'Org unit without a head — Radiology', clearedAt: minutesAgo(90) },
    ]);
  });
});
