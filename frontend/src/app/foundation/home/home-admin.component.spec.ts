import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { loadTranslationsForTest } from '../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { TestFormatContext } from '../../core/formatting/format-context';
import { SetupConditionDto, SetupConditionFreshnessDto } from '../setup-health/services/setup-health.service';
import { SetupConditionRows } from '../setup-health/setup-condition-rows';
import { HomeAdminComponent } from './home-admin.component';
import { HomeAdminSummaryDto } from './home-summary.service';
import { HomeSpecCalls, HomeSpecOptions, homeProviders } from './home.testing';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

// ACC-279 — the admin block: each part on its own permission, each failure its
// own, and Needs fixing worded by the Setup health page's own row builder.

const NOW = new Date('2026-11-06T09:00:00.000Z');
const ALL_TYPES = [
  'ORG_UNIT_WITHOUT_HEAD',
  'ORG_UNIT_WITHOUT_TYPE',
  'ACTING_HEAD_OPEN_ENDED',
  'STAGE_WITHOUT_ASSIGNEE',
  'STAGE_ON_STARTING_ASSIGNMENT',
  'TASK_WITHOUT_OWNER',
  'STORAGE_ACCESS_WITHDRAWN',
  'STORAGE_SECRET_EXPIRING',
  'STORAGE_ALMOST_FULL',
] as const;

const fresh = (status: SetupConditionFreshnessDto['status'] = 'CURRENT'): SetupConditionFreshnessDto[] =>
  ALL_TYPES.map((type) => ({ type, status, computedAt: '2026-11-06T08:56:00.000Z' }));

const condition = (over: Partial<SetupConditionDto> = {}): SetupConditionDto => ({
  id: 'sc-1',
  type: 'ORG_UNIT_WITHOUT_HEAD',
  severity: 'BLOCKS_WORK',
  objectId: 'unit-1',
  subject: { nameEn: 'Pharmacy', nameAr: 'الصيدلية', escalationResolves: false },
  openedAt: '2026-10-28T09:00:00.000Z',
  ageBasis: 'OBJECT',
  lastSeenAt: '2026-11-06T08:56:00.000Z',
  clearedAt: null,
  ...over,
});

const summary = (over: Partial<HomeAdminSummaryDto> = {}): HomeAdminSummaryDto => ({
  setup: { open: 8, blocksWork: 3, top: [condition()], freshness: fresh() },
  users: { active: 298, invited: 14, invitedExpired: 3, seats: { occupied: 312, maxUsers: 400 } },
  committees: { inForce: 22, belowQuorum: 4 },
  ...over,
});

const EVERYTHING = ['setup:view', 'users:view', 'committees:view', 'org:view', 'org:manage', 'admin:access'];

describe('HomeAdminComponent (ACC-279)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HomeAdminComponent>;
  let calls: HomeSpecCalls;

  function build(opts: HomeSpecOptions, language: 'en' | 'ar' = 'en'): void {
    jasmine.clock().mockDate(NOW);
    const setup = homeProviders(opts);
    calls = setup.calls;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HomeAdminComponent], providers: setup.providers });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TestFormatContext).zone.set('Asia/Riyadh');
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(HomeAdminComponent);
    fixture.detectChanges();
  }

  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  const el = () => fixture.nativeElement as HTMLElement;
  const q = (testId: string) => el().querySelector(`[data-testid="${testId}"]`);
  const text = (testId: string) => q(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

  it('each part on its own permission: absent, never greyed', () => {
    build({ permissions: ['setup:view'], summary: summary() });
    expect(q('home-needs-fixing')).not.toBeNull();
    expect(q('home-tile-conditions')).not.toBeNull();
    expect(q('home-tile-users')).toBeNull();
    expect(q('home-tile-in-force')).toBeNull();

    build({ permissions: ['users:view'], summary: summary() });
    expect(q('home-needs-fixing')).toBeNull();
    expect(q('home-tile-users')).not.toBeNull();
    expect(q('home-tile-invites')).not.toBeNull();

    build({ permissions: ['committees:view'], summary: summary() });
    expect(q('home-tile-in-force')).not.toBeNull();
    expect(q('home-tile-users')).toBeNull();
  });

  it('with none of them, nothing renders and nothing is asked', () => {
    build({ permissions: ['tenant:manage_config', 'roles:view'], summary: summary() });
    expect(q('home-admin')).toBeNull();
    expect(calls.summary).toBe(0);
  });

  it('the tiles: the counts, and a meta only where it says something', () => {
    build({ permissions: EVERYTHING, summary: summary() });
    expect(text('home-tile-conditions-value')).toBe('8');
    expect(text('home-tile-conditions-meta')).toBe('3 blocking');
    expect(text('home-tile-users-value')).toBe('298');
    expect(text('home-tile-users-meta')).toBe('312 of 400 seats in use');
    expect(text('home-tile-invites-value')).toBe('14');
    expect(text('home-tile-invites-meta')).toBe('3 expired');
    expect(text('home-tile-in-force-value')).toBe('22');
    expect(text('home-tile-in-force-meta')).toBe('4 below quorum');

    build({ permissions: EVERYTHING, summary: summary({ setup: { open: 2, blocksWork: 0, top: [], freshness: fresh() }, users: { active: 5, invited: 0, invitedExpired: 0, seats: null } }) });
    expect(q('home-tile-conditions-meta')).toBeNull();
    expect(q('home-tile-invites-meta')).toBeNull();
  });

  it('no seat limit (no plan, or no maximum): the seats line is left out — never "of 0"', () => {
    build({ permissions: EVERYTHING, summary: summary({ users: { active: 5, invited: 1, invitedExpired: 0, seats: null } }) });
    expect(q('home-tile-users-meta')).toBeNull();
    expect(el().textContent).not.toContain('of 0');
  });

  it('a part that failed says so with Try again, and the others still show; never 0', () => {
    build({ permissions: EVERYTHING, summary: summary({ users: { failed: true } }) });
    expect(q('home-tile-users-failed')).not.toBeNull();
    expect(q('home-tile-invites-failed')).not.toBeNull();
    expect(q('home-tile-users-value')).toBeNull();
    expect(text('home-tile-in-force-value')).toBe('22');
    expect(text('home-tile-conditions-value')).toBe('8');
  });

  it('the whole read failing fails every part, and Try again asks again', () => {
    build({ permissions: EVERYTHING, summary: 'fail' });
    expect(q('home-needs-fixing-failed')).not.toBeNull();
    expect(q('home-tile-conditions-failed')).not.toBeNull();
    expect(q('home-tile-in-force-failed')).not.toBeNull();
    (q('home-tile-in-force-retry') as HTMLButtonElement).click();
    expect(calls.summary).toBe(2);
  });

  describe('Needs fixing', () => {
    it('words each row exactly as the Setup health page does', () => {
      build({ permissions: EVERYTHING, summary: summary() });
      const pageRow = TestBed.inject(SetupConditionRows).toRow(condition(), NOW);
      const homeRow = text('home-needs-fixing-row')!;
      expect(homeRow).toContain(pageRow.objectName);
      expect(homeRow).toContain(pageRow.consequence);
      expect(homeRow).toContain(pageRow.age);
      expect(text('home-needs-fixing-fix')).toBe(pageRow.fix!.label);
    });

    it('a Fix shows only for a viewer who can use it; otherwise the page\'s note, never a disabled button', () => {
      build({ permissions: ['setup:view'], summary: summary() });
      expect(q('home-needs-fixing-fix')).toBeNull();
      expect(text('home-needs-fixing-row')).toContain(TestBed.inject(SetupConditionRows).toRow(condition(), NOW).fixNeeds!);
      expect(el().querySelector('.am-nf__row button[disabled]')).toBeNull();
    });

    it('the count, when it was checked, the hourly note, and the link to Setup health', () => {
      build({ permissions: ['setup:view', 'admin:access'], summary: summary() });
      expect(text('home-needs-fixing-count')).toBe('8');
      expect(text('home-needs-fixing-checked')).toContain('4 minutes ago');
      expect(el().textContent).toContain('next hourly check');
      expect(el().textContent).not.toContain('15-minute');
      expect(q('home-needs-fixing-open')!.getAttribute('href')).toBe('/setup-health');
    });

    it('the link is absent for a viewer the Setup health route would refuse', () => {
      build({ permissions: ['setup:view'], summary: summary() });
      expect(q('home-needs-fixing-open')).toBeNull();
      expect(q('home-tile-conditions-value')!.tagName).toBe('SPAN');
    });

    it('nothing open: says so', () => {
      build({ permissions: ['setup:view'], summary: summary({ setup: { open: 0, blocksWork: 0, top: [], freshness: fresh() } }) });
      expect(text('home-needs-fixing-empty')).toBe('Nothing needs fixing.');
    });

    it('a check that failed or is late: the rows stand, with a note that they may be out of date', () => {
      build({ permissions: ['setup:view'], summary: summary({ setup: { open: 1, blocksWork: 1, top: [condition()], freshness: fresh('FAILED') } }) });
      expect(q('home-needs-fixing-stale')).not.toBeNull();
      expect(q('home-needs-fixing-row')).not.toBeNull();
    });

    it('in Arabic, the unit is named in Arabic', () => {
      build({ permissions: ['setup:view'], summary: summary() }, 'ar');
      expect(text('home-needs-fixing-row')).toContain('الصيدلية');
    });
  });
});
