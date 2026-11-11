import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component, WritableSignal, computed } from '@angular/core';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { AwaitingAnswer, Loadable, MyWorkCountsService } from '../../foundation/home/my-work-counts.service';
import { ITaskRecordListDto } from '../../foundation/tasks/services/task.service';
import { MyCommitteesDto } from '../../foundation/committees/services/committee.service';
import { environment } from '../../../environments/environment';
import { ADMIN_ACCESS } from '../../core/navigation/admin-access';
import { SetupHealthService } from '../../foundation/setup-health/services/setup-health.service';

// ACC-79 — the rail's own behaviour. WHICH items appear is nav-items.spec.ts's
// job; this covers what the rail derives and how it presents groups.
describe('SidebarComponent (ACC-79)', () => {
  let fixture: ComponentFixture<SidebarComponent>;

  function render(opts: {
    permissions?: string[];
    platformAdmin?: boolean;
    name?: string;
    tenantName?: string;
    collapsed?: boolean;
    extraProviders?: unknown[];
  }): HTMLElement {
    const access: Partial<NavigationAccessService> = {
      hasPermission: (p: string) => (opts.permissions ?? []).includes(p),
      isModuleEnabled: () => false,
      isPlatformAdmin: () => opts.platformAdmin ?? false,
      tenantName: signal(
        opts.tenantName ?? 'Al Nakheel Specialist Hospital',
      ).asReadonly(),
    };
    const auth: Partial<AuthService> = {
      currentUser: signal({
        id: 'u1',
        email: 'x@y.test',
        name: opts.name ?? 'Dr. Yasser Al-Amri',
      }).asReadonly(),
      displayPreferences: signal(null).asReadonly(),
    } as Partial<AuthService>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: NavigationAccessService, useValue: access },
        { provide: AuthService, useValue: auth },
        ...((opts.extraProviders ?? []) as never[]),
      ],
    });
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', opts.collapsed ?? false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  describe('product kicker — read from admin:access, never a role name', () => {
    it('says Quality when the user does not administer', () => {
      render({ permissions: ['committees:view'] });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.quality',
      );
    });

    // ACC-123 — the live defect. Dr. Yasser Al-Amri (QUALITY_MANAGER) holds
    // these four for his PICKERS: the task assignee list reads GET /users. The
    // shell called him "Tenant admin" ("إدارة المنشأة") for it.
    it('does NOT say Tenant admin to a working role holding four page permissions', () => {
      render({
        permissions: ['users:view', 'org:view', 'lookups:view', 'workflows:view'],
      });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.quality',
      );
    });

    // A custom role granted admin:access gets the admin face, whether or not it
    // can open any particular page — it administers this tenant, which is what
    // the kicker states.
    it('says Tenant admin for a holder of admin:access', () => {
      render({ permissions: [ADMIN_ACCESS, 'lookups:view'] });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.admin',
      );
    });

    it('says Platform for a platform admin', () => {
      render({ platformAdmin: true });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.platform',
      );
    });
  });

  describe('initials', () => {
    it('skips an honorific, so Dr. Yasser Al-Amri reads YA rather than DY', () => {
      render({ name: 'Dr. Yasser Al-Amri' });
      expect(fixture.componentInstance.initials()).toBe('YA');
    });

    it('uses the first two words for an ordinary name', () => {
      render({ name: 'Hessa Al-Dosari' });
      expect(fixture.componentInstance.initials()).toBe('HA');
    });
  });

  describe('group presentation', () => {
    it('shows a heading per group when open', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'committees:view', 'users:view'] });
      const text = el.textContent ?? '';
      // Translation is not loaded in this test, so the keys render as-is —
      // which is exactly what makes them assertable here.
      expect(text).toContain('nav.groups.work');
      expect(text).toContain('nav.groups.quality');
      expect(text).toContain('nav.groups.admin');
    });

    // Collapsed, headings have no room. Groups must still be told apart, by a
    // rule — so there is one fewer rule than there are groups.
    it('replaces headings with rules between groups when collapsed', () => {
      const el = render({
        permissions: [ADMIN_ACCESS, 'committees:view', 'users:view'],
        collapsed: true,
      });
      expect(el.textContent ?? '').not.toContain('nav.groups.work');
      expect(el.querySelectorAll('nav .border-t').length).toBe(2);
    });

    // An icon-only link is announced as nothing without a label.
    it('labels every link for assistive technology when collapsed', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'users:view'], collapsed: true });
      const links = Array.from(el.querySelectorAll('nav a'));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute('aria-label'))
          .withContext(link.outerHTML)
          .toBeTruthy();
      }
    });
  });

  // ACC-79 — the platform hue is applied by class, so the rail's tokens swap
  // without the component branching on colour.
  describe('shell palette', () => {
    it('applies the platform palette to a platform admin', () => {
      const el = render({ platformAdmin: true });
      expect(el.querySelector('aside')!.classList).toContain(
        'am-rail--platform',
      );
    });

    it('keeps the tenant palette for every tenant user, admin or not', () => {
      for (const permissions of [[], ['users:view', 'roles:view']]) {
        const el = render({ permissions });
        expect(el.querySelector('aside')!.classList)
          .withContext(JSON.stringify(permissions))
          .not.toContain('am-rail--platform');
      }
    });
  });

  it('shows the tenant under the user, not a role name', () => {
    const el = render({ tenantName: 'Al Nakheel Specialist Hospital' });
    expect(el.textContent ?? '').toContain('Al Nakheel Specialist Hospital');
  });

  // ACC-82 — the Setup health count on the rail.
  describe('Setup health badge', () => {
    const SUMMARY_URL = `${environment.apiUrl}/setup-health/summary`;
    let http: HttpTestingController;

    const renderWithHttp = (opts: Parameters<typeof render>[0]): HTMLElement => {
      const el = render({ ...opts, extraProviders: [provideHttpClient(), provideHttpClientTesting()] });
      http = TestBed.inject(HttpTestingController);
      return el;
    };

    const flushSummary = (open: number, blocksWork: number): void => {
      http.expectOne(SUMMARY_URL).flush({ open, blocksWork });
      fixture.detectChanges();
    };

    // ACC-292 — the badge rides on the one Administration item (/admin).
    const badge = (el: HTMLElement) => el.querySelector('a[href="/admin"] .am-rail-badge');

    afterEach(() => http.verify());

    it('shows the open count on the item, with a pluralised label for screen readers', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'] });
      loadTranslationsForTest({ en });
      flushSummary(25, 0);

      expect(badge(el)?.textContent).toContain('25');
      expect(badge(el)?.querySelector('.sr-only')?.textContent?.trim()).toBe('25 open conditions');
      expect(badge(el)?.classList).not.toContain('am-rail-badge--alert');
    });

    // Red is kept for a count that includes something blocking work.
    it('uses the alert tone only when a condition blocks work', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'] });
      flushSummary(3, 1);

      expect(badge(el)?.classList).toContain('am-rail-badge--alert');
    });

    // ACC-94 — the rail read "1 open conditions" before counted strings had plural forms.
    it('says 1 open condition, not 1 open conditions', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'] });
      loadTranslationsForTest({ en });
      flushSummary(1, 0);

      expect(badge(el)?.querySelector('.sr-only')?.textContent?.trim()).toBe('1 open condition');
    });

    it('shows no badge when nothing is open', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'] });
      flushSummary(0, 0);

      expect(badge(el)).toBeNull();
    });

    // The item is gated on setup:view, and so is the request: the rail must
    // never ask for a count the user would be refused.
    it('never requests the count for a user without setup:view', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'users:view', 'roles:view'] });

      http.expectNone(SUMMARY_URL);
      // ACC-292 — the Administration item is there, with no badge.
      expect(el.querySelector('a[href="/admin"]')).withContext('non-vacuity: the item renders').not.toBeNull();
      expect(badge(el)).toBeNull();
    });

    // ACC-292 — collapsed: the dot, and one counted sentence naming the item.
    it('carries the count in the label when the rail is collapsed: "Administration · 7 open problems"', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'], collapsed: true });
      loadTranslationsForTest({ en });
      flushSummary(7, 0);

      const item = el.querySelector('a[href="/admin"]');
      expect(item?.getAttribute('aria-label')).toBe('Administration · 7 open problems');
      // ACC-290 — the 7px dot in its own class (neutral here: nothing blocks
      // work), never the badge's.
      const dot = item?.querySelector('.am-rail-dot.w-\\[7px\\]');
      expect(dot).withContext('the 7px dot').not.toBeNull();
      expect(dot?.classList).not.toContain('am-rail-dot--alert');
      expect(item?.querySelector('.am-rail-badge')).toBeNull();
    });

    it('in Arabic, the collapsed label takes the plural form: 1, 2, 3 and 11', () => {
      const el = renderWithHttp({ permissions: [ADMIN_ACCESS, 'setup:view'], collapsed: true });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use('ar');
      const label = (open: number) => {
        http.expectOne(SUMMARY_URL).flush({ open, blocksWork: 0 });
        fixture.detectChanges();
        const text = el.querySelector('a[href="/admin"]')?.getAttribute('aria-label');
        // The next poll is five minutes away: ask again by hand.
        TestBed.inject(SetupHealthService).getSummary().subscribe();
        return text;
      };
      expect(label(1)).toBe('الإدارة · مشكلة مفتوحة واحدة');
      expect(label(2)).toBe('الإدارة · مشكلتان مفتوحتان');
      expect(label(3)).toBe('الإدارة · 3 مشكلات مفتوحة');
      expect(label(11)).toBe('الإدارة · 11 مشكلة مفتوحة');
      http.expectOne(SUMMARY_URL).flush({ open: 0, blocksWork: 0 });
      TestBed.inject(TranslateService).use('en');
    });
  });

  // ACC-292 — the Administration group is ONE rail item, to the console.
  describe('Administration as one item (ACC-292)', () => {
    const adminPermissions = [
      ADMIN_ACCESS,
      'setup:view',
      'users:view',
      'roles:view',
      'org:view',
      'positions:view',
      'workflows:manage',
      'lookups:view',
      'tenant:view',
      'tenant:manage_config',
    ];
    const ADMIN_PAGES = [
      '/setup-health',
      '/users',
      '/roles',
      '/organization',
      '/org-positions',
      '/workflows',
      '/lookups',
      '/working-calendar',
      '/admin-settings/task-sla',
      '/admin-settings/organization-profile',
      '/admin-settings/email-provider',
      '/admin-settings/ai-settings',
      '/admin-settings/storage',
      '/admin-settings/recycle-bin',
    ];
    const links = (el: HTMLElement) => Array.from(el.querySelectorAll('nav a')).map((a) => a.getAttribute('href'));

    it('no administration access: no item and no heading', () => {
      const el = render({ permissions: ['users:view', 'org:view', 'lookups:view'] });
      expect(links(el)).not.toContain('/admin');
      expect(el.textContent ?? '').not.toContain('nav.groups.admin');
    });

    it('admin:access with no admin page: no item', () => {
      const el = render({ permissions: [ADMIN_ACCESS] });
      expect(links(el)).not.toContain('/admin');
    });

    it('one admin page: the heading, and one item to /admin named Administration', () => {
      const el = render({ permissions: [ADMIN_ACCESS, 'users:view'] });
      expect(links(el).filter((href) => href === '/admin').length).toBe(1);
      expect(links(el)).not.toContain('/users');
      const item = el.querySelector('a[href="/admin"]')!;
      expect(item.textContent?.trim()).toBe('nav.groups.admin');
      expect(item.querySelector('i')?.className).toContain('pi-cog');
    });

    it('a full administrator: still one item, and no admin page is a rail row', () => {
      const el = render({ permissions: adminPermissions });
      expect(links(el).filter((href) => href === '/admin').length).toBe(1);
      for (const page of ADMIN_PAGES) expect(links(el)).withContext(page).not.toContain(page);
      expect(links(el)).withContext('non-vacuity: My work still renders').toContain('/home');
    });
  });

  // ACC-281 — a member of an active committee sees Committees without
  // committees:view, once membership is known. The rail reads the counts the
  // shell loaded; it starts nothing and requests nothing.
  describe('Committees for a committee member (ACC-281)', () => {
    let http: HttpTestingController;
    let myCommittees: WritableSignal<Loadable<MyCommitteesDto>>;
    let calls: string[];

    function renderMember(permissions: string[] = []): HTMLElement {
      myCommittees = signal<Loadable<MyCommitteesDto>>({ state: 'loading' });
      calls = [];
      const record = (name: string) => () => {
        calls.push(name);
      };
      const fake = {
        myTasks: signal({ state: 'loading' }),
        myOverdue: signal({ state: 'loading' }),
        awaiting: signal({ state: 'loading' }),
        myCommittees,
        isCommitteeMember: computed(() => {
          const c = myCommittees();
          return c.state === 'ready' && c.value.total > 0;
        }),
        init: record('init'),
        reload: record('reload'),
        refreshOnEntry: record('refreshOnEntry'),
        loadMyCommittees: record('loadMyCommittees'),
      };
      const el = render({
        permissions,
        extraProviders: [provideHttpClient(), provideHttpClientTesting(), { provide: MyWorkCountsService, useValue: fake }],
      });
      http = TestBed.inject(HttpTestingController);
      return el;
    }
    const committeesLink = (el: HTMLElement) => el.querySelector('a[href="/committees"]');
    const settle = (answer: Loadable<MyCommitteesDto>) => {
      myCommittees.set(answer);
      fixture.detectChanges();
    };
    const member = (total: number): Loadable<MyCommitteesDto> => ({ state: 'ready', value: { total, rows: [] } as unknown as MyCommitteesDto });

    afterEach(() => {
      http.verify();
      expect(calls).withContext('the rail called the counts service').toEqual([]);
    });

    it('a member without committees:view sees Committees', () => {
      const el = renderMember();
      settle(member(1));
      expect(committeesLinkText(el)).toBe('nav.committees');
    });

    it('while membership loads the item is absent, and it appears when the answer is known, with no request', () => {
      const el = renderMember();
      expect(committeesLink(el)).withContext('loading').toBeNull();
      settle({ state: 'failed' });
      expect(committeesLink(el)).withContext('failed').toBeNull();
      settle(member(2));
      expect(committeesLink(el)).withContext('ready').not.toBeNull();
      http.expectNone(() => true);
    });

    it('not a member (ready, 0) and no committees:view: no item', () => {
      const el = renderMember();
      settle(member(0));
      expect(committeesLink(el)).toBeNull();
    });

    it('committees:view shows it whatever the membership', () => {
      const el = renderMember(['committees:view']);
      expect(committeesLink(el)).not.toBeNull();
    });

    const committeesLinkText = (el: HTMLElement) => committeesLink(el)?.textContent?.trim() ?? null;
  });

  // ACC-120 — the Awaiting my action item: everything waiting on the person's
  // decision (stages total + change requests), read from the counts the shell
  // loaded. Always neutral. The rail starts nothing and requests nothing.
  describe('Awaiting my action badge (ACC-120)', () => {
    let http: HttpTestingController;
    let awaiting: WritableSignal<Loadable<AwaitingAnswer>>;
    let calls: string[];

    const ready = (stagesTotal: number, changes: number): Loadable<AwaitingAnswer> => ({
      state: 'ready',
      value: {
        stages: { total: stagesTotal, rows: [], oldestSince: null },
        changes: Array.from({ length: changes }, (_, i) => ({ id: `cr-${i}` })) as unknown as AwaitingAnswer['changes'],
      },
    });

    function renderAwaiting(opts: { collapsed?: boolean; language?: 'en' | 'ar' } = {}): HTMLElement {
      awaiting = signal<Loadable<AwaitingAnswer>>({ state: 'loading' });
      calls = [];
      const record = (name: string) => () => {
        calls.push(name);
      };
      const fake = {
        myTasks: signal({ state: 'loading' }),
        myOverdue: signal({ state: 'loading' }),
        awaiting,
        isCommitteeMember: signal(false),
        init: record('init'),
        reload: record('reload'),
        refreshOnEntry: record('refreshOnEntry'),
        loadAwaiting: record('loadAwaiting'),
      };
      const el = render({
        collapsed: opts.collapsed,
        extraProviders: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideFormatTesting(),
          { provide: MyWorkCountsService, useValue: fake },
        ],
      });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use(opts.language ?? 'en');
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      return el;
    }
    const set = (answer: Loadable<AwaitingAnswer>) => {
      awaiting.set(answer);
      fixture.detectChanges();
    };
    const link = (el: HTMLElement) => el.querySelector('a[href="/awaiting"]')!;
    const badge = (el: HTMLElement) => link(el).querySelector('.am-rail-badge');
    const srText = (el: HTMLElement) => badge(el)?.querySelector('.sr-only')?.textContent?.trim();

    afterEach(() => {
      http.verify();
      expect(calls).withContext('the rail called the counts service').toEqual([]);
    });

    it('the item is in My work after Tasks, for everyone (no permission)', () => {
      const el = renderAwaiting();
      const work = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href'));
      expect(work.indexOf('/awaiting')).toBe(work.indexOf('/tasks') + 1);
    });

    it('no badge while loading, after a failure, or at 0', () => {
      const el = renderAwaiting();
      expect(badge(el)).withContext('loading').toBeNull();
      set({ state: 'failed' });
      expect(badge(el)).withContext('failed').toBeNull();
      set(ready(0, 0));
      expect(badge(el)).withContext('0').toBeNull();
    });

    it('ready: stages total plus change requests, neutral, read as "3 items waiting"', () => {
      const el = renderAwaiting();
      set(ready(2, 1));
      expect(badge(el)?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('3');
      expect(badge(el)?.classList).not.toContain('am-rail-badge--alert');
      expect(srText(el)).toBe('3 items waiting');
      set(ready(1, 0));
      expect(srText(el)).toBe('1 item waiting');
    });

    // ACC-290 — the collapsed dot has its own tokens: .am-rail-dot, never the
    // badge's fill (.am-rail-badge), which fails 3:1 against the rail.
    it('collapsed: the neutral dot (.am-rail-dot, never .am-rail-badge), and the label carries the sentence', () => {
      const el = renderAwaiting({ collapsed: true });
      set(ready(3, 0));
      const dot = link(el).querySelector('.am-rail-dot')!;
      expect(dot).withContext('the dot renders').not.toBeNull();
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.classList).not.toContain('am-rail-dot--alert');
      expect(dot.classList).not.toContain('am-rail-badge');
      expect(link(el).querySelector('.am-rail-badge')).toBeNull();
      expect(link(el).getAttribute('aria-label')).toBe('Awaiting my action — 3 items waiting');
    });

    it('updates when the count changes, with no request of its own', () => {
      const el = renderAwaiting();
      set(ready(3, 0));
      set(ready(5, 2));
      expect(srText(el)).toBe('7 items waiting');
      http.expectNone(() => true);
    });

    it('in Arabic, the sentence takes the plural form for 1, 2, 3 and 11', () => {
      const el = renderAwaiting({ language: 'ar' });
      const cases: [number, string][] = [
        [1, 'عنصر واحد بالانتظار'],
        [2, 'عنصران بالانتظار'],
        [3, '3 عناصر بالانتظار'],
        [11, '11 عنصرًا بالانتظار'],
      ];
      for (const [n, sentence] of cases) {
        set(ready(n, 0));
        expect(srText(el)).withContext(String(n)).toBe(sentence);
      }
    });
  });

  // ACC-120 — the Tasks item shows the person's open tasks: Home's My tasks
  // count, read from MyWorkCountsService, which the shell loads. The rail only
  // reads its signals; it starts nothing and requests nothing.
  describe('Tasks badge (ACC-120)', () => {
    type TasksState = Loadable<ITaskRecordListDto>;
    let http: HttpTestingController;
    let myTasks: WritableSignal<TasksState>;
    let myOverdue: WritableSignal<Loadable<number>>;
    let calls: string[];

    const ready = (matching: number): TasksState => ({
      state: 'ready',
      value: { matching, total: matching + 40 } as ITaskRecordListDto,
    });

    function renderTasks(opts: { collapsed?: boolean; language?: 'en' | 'ar' } = {}): HTMLElement {
      myTasks = signal<TasksState>({ state: 'loading' });
      myOverdue = signal<Loadable<number>>({ state: 'loading' });
      calls = [];
      const record = (name: string) => () => {
        calls.push(name);
      };
      const fake = {
        myTasks,
        myOverdue,
        awaiting: signal({ state: 'loading' }),
        // ACC-281 — the rail reads membership too; not a member here.
        isCommitteeMember: signal(false),
        init: record('init'),
        reload: record('reload'),
        refreshOnEntry: record('refreshOnEntry'),
        loadMyTasks: record('loadMyTasks'),
        loadMyOverdue: record('loadMyOverdue'),
      };
      const el = render({
        collapsed: opts.collapsed,
        extraProviders: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideFormatTesting(),
          { provide: MyWorkCountsService, useValue: fake },
        ],
      });
      loadTranslationsForTest({ en, ar });
      TestBed.inject(TranslateService).use(opts.language ?? 'en');
      http = TestBed.inject(HttpTestingController);
      fixture.detectChanges();
      return el;
    }

    const set = (tasks: TasksState, overdue: Loadable<number>): void => {
      myTasks.set(tasks);
      myOverdue.set(overdue);
      fixture.detectChanges();
    };
    const tasksLink = (el: HTMLElement) => el.querySelector('a[href="/tasks"]')!;
    const badge = (el: HTMLElement) => tasksLink(el).querySelector('.am-rail-badge');
    const srText = (el: HTMLElement) => badge(el)?.querySelector('.sr-only')?.textContent?.trim();

    // Nothing is fetched by the rail, and nothing on the service is started.
    afterEach(() => {
      http.verify();
      expect(calls).withContext('the rail called the counts service').toEqual([]);
    });

    it('shows no badge while the count loads', () => {
      const el = renderTasks();
      expect(badge(el)).toBeNull();
    });

    it('shows no badge when the count failed — a failure is never a number', () => {
      const el = renderTasks();
      set({ state: 'failed' }, { state: 'ready', value: 2 });
      expect(badge(el)).toBeNull();
    });

    it('shows no badge at 0', () => {
      const el = renderTasks();
      set(ready(0), { state: 'ready', value: 0 });
      expect(badge(el)).toBeNull();
    });

    it('7 open, none overdue: "7", neutral, read as "7 open tasks" (matching, never total)', () => {
      const el = renderTasks();
      set(ready(7), { state: 'ready', value: 0 });
      expect(badge(el)?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('7');
      expect(badge(el)?.classList).not.toContain('am-rail-badge--alert');
      expect(srText(el)).toBe('7 open tasks');
    });

    it('7 open, 2 overdue: "7", the alert tone, read as "7 open tasks, some overdue"', () => {
      const el = renderTasks();
      set(ready(7), { state: 'ready', value: 2 });
      expect(badge(el)?.querySelector('[aria-hidden="true"]')?.textContent?.trim()).toBe('7');
      expect(badge(el)?.classList).toContain('am-rail-badge--alert');
      expect(srText(el)).toBe('7 open tasks, some overdue');
    });

    it('one open and overdue reads "1 open task, overdue"', () => {
      const el = renderTasks();
      set(ready(1), { state: 'ready', value: 1 });
      expect(srText(el)).toBe('1 open task, overdue');
    });

    it('the overdue count loading or failed: the count shows in the neutral tone', () => {
      const el = renderTasks();
      set(ready(7), { state: 'failed' });
      expect(badge(el)?.classList).not.toContain('am-rail-badge--alert');
      expect(srText(el)).toBe('7 open tasks');
      set(ready(7), { state: 'loading' });
      expect(badge(el)?.classList).not.toContain('am-rail-badge--alert');
      expect(srText(el)).toBe('7 open tasks');
    });

    // ACC-290 — an alert count's dot is .am-rail-dot--alert, never the badge's.
    it('collapsed: the alert dot (.am-rail-dot--alert, never .am-rail-badge), and the label carries the sentence', () => {
      const el = renderTasks({ collapsed: true });
      set(ready(7), { state: 'ready', value: 2 });
      const dot = tasksLink(el).querySelector('.am-rail-dot')!;
      expect(dot).withContext('the dot renders').not.toBeNull();
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.textContent?.trim()).toBe('');
      expect(dot.classList).toContain('am-rail-dot--alert');
      expect(dot.classList).not.toContain('am-rail-badge');
      expect(dot.classList).not.toContain('am-rail-badge--alert');
      expect(tasksLink(el).querySelector('.am-rail-badge')).toBeNull();
      expect(tasksLink(el).getAttribute('aria-label')).toBe('Tasks — 7 open tasks, some overdue');
    });

    it('updates when the count changes, with no request of its own', () => {
      const el = renderTasks();
      set(ready(7), { state: 'ready', value: 0 });
      expect(srText(el)).toBe('7 open tasks');
      set(ready(8), { state: 'ready', value: 3 });
      expect(srText(el)).toBe('8 open tasks, some overdue');
      set(ready(0), { state: 'ready', value: 0 });
      expect(badge(el)).toBeNull();
      http.expectNone(() => true);
    });

    it('in Arabic, the sentence takes the plural form for 1, 2, 3 and 11', () => {
      const el = renderTasks({ language: 'ar' });
      const cases: [number, string][] = [
        [1, 'مهمة مفتوحة واحدة'],
        [2, 'مهمتان مفتوحتان'],
        [3, '3 مهام مفتوحة'],
        [11, '11 مهمة مفتوحة'],
      ];
      for (const [n, sentence] of cases) {
        set(ready(n), { state: 'ready', value: 0 });
        expect(srText(el)).withContext(String(n)).toBe(sentence);
      }
      set(ready(3), { state: 'ready', value: 1 });
      expect(srText(el)).toBe('3 مهام مفتوحة، بعضها متأخر');
    });
  });
});

// ACC-292 — the Administration item is lit on the console and on every admin
// page, including pages below them.
describe('SidebarComponent — Administration is lit on every admin page (ACC-292)', () => {
  @Component({ template: '', standalone: true })
  class StubPageComponent {}

  async function railAt(url: string): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([{ path: '**', component: StubPageComponent }]),
        provideTranslateService(),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => [ADMIN_ACCESS, 'users:view', 'tenant:manage_config', 'org:view'].includes(p),
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
            tenantName: signal('Al Nakheel').asReadonly(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'x@y.test', name: 'Omar Haddad' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const active = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('a.am-rail-item--active')).map((a) => a.getAttribute('href'));

  for (const url of [
    '/admin',
    '/users',
    '/users/u-2',
    '/organization/units/unit-1',
    '/admin-settings/task-sla',
    '/admin-settings/storage',
    // A page the user may not open still belongs to Administration.
    '/roles/r-1/permissions',
  ]) {
    it(`on ${url}, Administration is the one current item`, async () => {
      const el = await railAt(url);
      expect(active(el)).toEqual(['/admin']);
      expect(el.querySelector('a[href="/admin"]')!.getAttribute('aria-current')).toBe('page');
    });
  }

  it('is not lit outside Administration (Home, Tasks, a look-alike path)', async () => {
    for (const url of ['/home', '/tasks', '/administration-help', '/users-guide']) {
      const el = await railAt(url);
      expect(active(el)).withContext(url).not.toContain('/admin');
    }
  });
});

// ACC-228, ACC-120 slice 3 — Tasks is lit on every view of /tasks and on a
// task's own page: All tasks and Unassigned are saved views now, not items.
describe('SidebarComponent — Tasks is lit on every view and on a task page (ACC-228, ACC-120 slice 3)', () => {
  @Component({ template: '', standalone: true })
  class StubPageComponent {}

  async function railAt(url: string): Promise<HTMLElement> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([{ path: '**', component: StubPageComponent }]),
        provideTranslateService(),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => ['committees:manage_tasks', ADMIN_ACCESS].includes(p),
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
            tenantName: signal('Al Nakheel').asReadonly(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'x@y.test', name: 'Omar Haddad' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
          },
        },
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const active = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('a.am-rail-item--active')).map((a) => a.getAttribute('href'));

  for (const url of ['/tasks', '/tasks?view=all', '/tasks?view=unit', '/tasks?view=unassigned', '/tasks/task-1']) {
    it(`on ${url}, Tasks is the one current item`, async () => {
      const el = await railAt(url);
      expect(active(el)).toEqual(['/tasks']);
      expect(el.querySelector('a[href="/tasks"]')!.getAttribute('aria-current')).toBe('page');
    });
  }

  // The defect ACC-228 found: RouterLinkActive removed aria-current after the
  // template wrote it, so no current rail item was ever announced. And the rail
  // links no view of its own: the views are on the page.
  it('announces only Tasks as the current page, and links nothing below /tasks', async () => {
    const el = await railAt('/tasks?view=unassigned');
    const current = Array.from(el.querySelectorAll('a[aria-current="page"]')).map((a) => a.getAttribute('href'));
    expect(current).toEqual(['/tasks']);
    expect(el.querySelector('a[href^="/tasks/"]')).toBeNull();
  });
});
