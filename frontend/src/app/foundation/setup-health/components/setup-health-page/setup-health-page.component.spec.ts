import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import {
  SetupConditionDto,
  SetupConditionFreshnessDto,
  SetupHealthDto,
} from '../../services/setup-health.service';
import { SetupHealthPageComponent } from './setup-health-page.component';

// ACC-82 — Setup health page (SYSTEM-REFERENCE §13.9).

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

// Real (English) interpolation, so assertions read like the page does.
const EN = {
  setupHealth: {
    checked: 'Checked {{when}}',
    severity: { BLOCKS_WORK: 'Blocks work', AT_RISK: 'At risk' },
    filter: { all: 'All' },
    types: {
      ORG_UNIT_WITHOUT_HEAD: 'Org unit without a head',
      STAGE_WITHOUT_ASSIGNEE: 'Workflow stage with no resolvable assignee',
      TASK_WITHOUT_OWNER: 'Task with no actionable owner',
    },
    context: { template: 'Workflow: {{name}}' },
    consequence: {
      unitCovered: 'covered',
      unitUncovered: 'uncovered',
      stageOne: '1 open item',
      stageMany: '{{count}} open items',
      task: 'no one assigned',
    },
    hint: { STAGE_WITHOUT_ASSIGNEE: 'check the assignee and each transition trigger' },
    age: {
      openToday: 'Open since today',
      openOneDay: 'Open 1 day',
      openDays: 'Open {{count}} days',
      detectedToday: 'First detected today',
      detectedOneDay: 'First detected 1 day ago',
      detectedDays: 'First detected {{count}} days ago',
    },
    fix: {
      ORG_UNIT_WITHOUT_HEAD: 'Assign head',
      STAGE_WITHOUT_ASSIGNEE: 'Review stage',
      TASK_WITHOUT_OWNER: 'Reassign',
    },
    fixNeeds: {
      ORG_UNIT_WITHOUT_HEAD: 'needs org manage',
      STAGE_WITHOUT_ASSIGNEE: 'needs workflows manage',
      TASK_WITHOUT_OWNER: 'needs tasks manage',
    },
    freshness: {
      failed: '{{type}}: failed, as of {{when}}',
      failedNever: '{{type}}: never succeeded',
      overdue: '{{type}}: overdue since {{when}}',
      neverRun: '{{type}}: never run',
    },
    relative: { justNow: 'just now', minutes: '{{count}} min ago', hours: '{{count}} h ago', days: '{{count}} days ago' },
  },
};

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
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.has(p) } },
        { provide: LanguageService, useValue: { isArabic: () => arabic } },
      ],
    });
    TestBed.inject(TranslateService).setTranslation('en', EN);
    const fixture = TestBed.createComponent(SetupHealthPageComponent);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne(`${environment.apiUrl}/setup-health`).flush(health);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

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

    const rowsById = (page: SetupHealthPageComponent) =>
      Object.fromEntries(page.groups().flatMap((g) => g.rows).map((r) => [r.id, r]));

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
      expect(rows['unit']!.fixNeeds).toBe('needs org manage');
      expect(rows['task']!.fix).toBeNull();
      expect(rows['task']!.fixNeeds).toBe('needs tasks manage');
      expect(rows['stage']!.fix).not.toBeNull();
    });

    // §13.2 — the condition does not record whether the assignee or a trigger
    // is the cause, so only the stage row tells the admin to check both.
    it('tells the admin to check both the assignee and the triggers on a stage row, and only there', () => {
      const rows = rowsById(render(health()));

      expect(rows['stage']!.hint).toBe('check the assignee and each transition trigger');
      expect(rows['unit']!.hint).toBeNull();
      expect(rows['task']!.hint).toBeNull();
    });
  });

  // §13.3 — an age taken from first detection must not read as how long the
  // problem has existed.
  it('words the age by its basis', () => {
    const page = render({
      open: [
        condition({ id: 'unit', openedAt: daysAgo(9.2) }),
        condition({ id: 'stage', type: 'STAGE_WITHOUT_ASSIGNEE', openedAt: daysAgo(1.5), subject: { nameEn: 'S', templateId: 't' } }),
        condition({ id: 'task-old', type: 'TASK_WITHOUT_OWNER', ageBasis: 'FIRST_DETECTED', openedAt: daysAgo(1.5), subject: { title: 'T1' } }),
        condition({ id: 'task', type: 'TASK_WITHOUT_OWNER', ageBasis: 'FIRST_DETECTED', openedAt: minutesAgo(30), subject: { title: 'T' } }),
      ],
      recentlyCleared: [],
      freshness: current(),
    });

    const ages = Object.fromEntries(page.groups().flatMap((g) => g.rows).map((r) => [r.id, r.age]));
    expect(ages).toEqual({
      unit: 'Open 9 days',
      stage: 'Open 1 day',
      'task-old': 'First detected 1 day ago',
      task: 'First detected today',
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
      expect(page.lastChecked()).toBe('Checked 12 min ago');
      expect(page.emptyMessageKey()).toBe('setupHealth.empty');
    });

    it('names each type that failed, is overdue or never ran — including types with no open rows', () => {
      const page = render({
        open: [],
        recentlyCleared: [],
        freshness: [
          { type: 'ORG_UNIT_WITHOUT_HEAD', status: 'FAILED', computedAt: minutesAgo(180) },
          { type: 'STAGE_WITHOUT_ASSIGNEE', status: 'OVERDUE', computedAt: minutesAgo(150) },
          { type: 'TASK_WITHOUT_OWNER', status: 'NEVER_RUN', computedAt: null },
        ],
      });

      expect(page.freshnessNotices()).toEqual([
        'Org unit without a head: failed, as of 3 h ago',
        'Workflow stage with no resolvable assignee: overdue since 3 h ago',
        'Task with no actionable owner: never run',
      ]);
      // An empty page must not read as "nothing needs fixing" when checks did not run.
      expect(page.emptyMessageKey()).toBe('setupHealth.emptyUnconfirmed');
    });

    it('says a type that has never succeeded has nothing confirmed', () => {
      const freshness = current();
      freshness[2] = { type: 'TASK_WITHOUT_OWNER', status: 'FAILED', computedAt: null };

      const page = render({ open: [], recentlyCleared: [], freshness });

      expect(page.freshnessNotices()).toEqual(['Task with no actionable owner: never succeeded']);
    });

    it('reports the OLDEST confirmation, so the toolbar never overstates freshness', () => {
      const freshness = current(minutesAgo(5));
      freshness[2] = { type: 'TASK_WITHOUT_OWNER', status: 'CURRENT', computedAt: minutesAgo(50) };

      const page = render({ open: [], recentlyCleared: [], freshness });

      expect(page.lastChecked()).toBe('Checked 50 min ago');
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
