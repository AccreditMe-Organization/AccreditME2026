import {
  ADMIN_CONSOLE_GROUPS,
  NavAccess,
  NavItem,
  PLATFORM_NAV_GROUPS,
  ROUTE_PERMISSIONS,
  TENANT_NAV_GROUPS,
  canOpenAdminConsole,
  isNavItemVisible,
  railNavGroups,
  visibleAdminConsoleItems,
  visibleNavGroups,
} from './nav-items';
import { ADMIN_ACCESS } from './admin-access';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';

// ACC-79 — the rail's visibility rule, tested without HTTP or TestBed. What a
// user sees is computed from permissions and entitlements alone; nothing here
// may know what role anyone holds.
describe('nav-items (ACC-79)', () => {
  const access = (opts: {
    permissions?: string[];
    modules?: string[];
    platformAdmin?: boolean;
  }): NavAccess => ({
    hasPermission: (p) => (opts.permissions ?? []).includes(p),
    isModuleEnabled: (m) => (opts.modules ?? []).includes(m),
    isPlatformAdmin: () => opts.platformAdmin ?? false,
  });

  const keysOf = (groups: ReturnType<typeof visibleNavGroups>) =>
    groups.map((g) => ({ group: g.key, items: g.items.map((i) => i.key) }));

  // Every permission any tenant item OR GROUP declares — a stand-in for a
  // tenant admin, derived from the model so a new item cannot be missed by
  // this test. ACC-123 added the group half: without it this "tenant admin"
  // would silently stop being one.
  const ALL_TENANT_PERMISSIONS = [
    ...TENANT_NAV_GROUPS.map((g) => g.requiredPermission),
    ...TENANT_NAV_GROUPS.flatMap((g) => g.items).map((i) => i.requiredPermission),
  ].filter((p): p is string => !!p);

  // A rail label is DATA — item.labelKey piped through translate — so no
  // template check sees it, and a missing key renders as the raw key string in
  // the rail, the breadcrumb and the tab title at once. ACC-79 added eight.
  describe('labels', () => {
    const lookup = (dict: unknown, key: string): unknown =>
      key
        .split('.')
        .reduce<unknown>(
          (node, part) =>
            node && typeof node === 'object'
              ? (node as Record<string, unknown>)[part]
              : undefined,
          dict,
        );

    const allGroups = [...TENANT_NAV_GROUPS, ...PLATFORM_NAV_GROUPS];
    const keys = [
      ...allGroups.map((g) => g.labelKey),
      ...allGroups.flatMap((g) => g.items.map((i) => i.labelKey)),
    ];

    it('resolves every group and item label in English and Arabic', () => {
      for (const key of keys) {
        expect(typeof lookup(en, key))
          .withContext(`en: ${key}`)
          .toBe('string');
        expect(typeof lookup(ar, key))
          .withContext(`ar: ${key}`)
          .toBe('string');
      }
    });
  });

  describe('group order', () => {
    it('is My work, then Quality management, then Administration', () => {
      expect(TENANT_NAV_GROUPS.map((g) => g.key)).toEqual([
        'work',
        'quality',
        'admin',
      ]);
    });
  });

  describe('a user with NO permissions (the ACC-79 non-admin case)', () => {
    // Dr. Yasser Al-Amri in the seeded tenant holds zero permissions. Before
    // ACC-79 his rail was completely empty. My work is self-scoped, so he gets
    // it — and nothing he cannot use.
    it('sees My work, and no empty headings for the groups he cannot use', () => {
      expect(keysOf(visibleNavGroups(access({})))).toEqual([
        { group: 'work', items: ['home', 'tasks', 'awaiting'] },
      ]);
    });
  });

  // ACC-120 slice 3 — ONE rail item for every view of /tasks. All tasks and
  // Unassigned became saved views of the list (Task Screens: "The Unassigned
  // rail item goes"), so no permission brings either back.
  describe('Tasks', () => {
    const taskItems = (permissions: string[]) =>
      visibleNavGroups(access({ permissions }))
        .flatMap((g) => g.items)
        .filter((i) => i.route.startsWith('/tasks'))
        .map((i) => `${i.key}:${i.route}:${i.labelKey}`);

    it('is one item, "Tasks" at /tasks, for a user with no permissions', () => {
      expect(taskItems([])).toEqual(['tasks:/tasks:nav.tasks']);
    });

    it('stays one item for the holders of View all tasks and Manage tasks', () => {
      expect(taskItems(['committees:view_all_tasks', 'committees:manage_tasks', ADMIN_ACCESS])).toEqual(['tasks:/tasks:nav.tasks']);
      expect(taskItems(ALL_TENANT_PERMISSIONS)).toEqual(['tasks:/tasks:nav.tasks']);
    });

    it('has no All tasks or Unassigned item anywhere', () => {
      const keys = TENANT_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.key));
      expect(keys).withContext('non-vacuity: the tasks item is there').toContain('tasks');
      expect(keys).not.toContain('allTasks');
      expect(keys).not.toContain('unassignedTasks');
    });
  });

  describe('a user holding every tenant permission', () => {
    it('sees all three groups, with Administration last', () => {
      const groups = visibleNavGroups(
        access({ permissions: ALL_TENANT_PERMISSIONS }),
      );
      expect(groups.map((g) => g.key)).toEqual(['work', 'quality', 'admin']);
    });
  });

  // ACC-82 — Setup health leads Administration, and only setup:view shows it.
  describe('Setup health', () => {
    it('is the first Administration item for a holder of setup:view, with its badge', () => {
      const admin = visibleNavGroups(access({ permissions: ALL_TENANT_PERMISSIONS })).find((g) => g.key === 'admin');
      expect(admin?.items[0]).toEqual(
        jasmine.objectContaining({ key: 'setupHealth', route: '/setup-health', badge: 'setupHealth' }),
      );
    });

    it('is absent without setup:view, even with every other admin permission', () => {
      const permissions = ALL_TENANT_PERMISSIONS.filter((p) => p !== 'setup:view');
      const items = visibleNavGroups(access({ permissions })).flatMap((g) => g.items.map((i) => i.key));
      expect(items).not.toContain('setupHealth');
    });

    it('guards its route with setup:view, and with admin:access (ACC-123)', () => {
      expect(ROUTE_PERMISSIONS.get('setup-health')).toEqual([
        ADMIN_ACCESS,
        'setup:view',
      ]);
    });
  });

  // ACC-123 — the section is for administrators, and "administrator" is a
  // PERMISSION. Both halves are tested, because each on its own is a different
  // product: the group permission alone would hand a custom admin role every
  // admin page, and the item permission alone is what shipped and showed
  // QUALITY_MANAGER the whole section.
  describe('Administration is gated per item AND by admin:access, never on a role', () => {
    it('shows a custom role holding admin:access exactly the items it also has the page permission for', () => {
      const groups = visibleNavGroups(
        access({ permissions: [ADMIN_ACCESS, 'lookups:view'] }),
      );
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'tasks', 'awaiting'] },
        { group: 'admin', items: ['lookups'] },
      ]);
    });

    // Yasser's case, which is the whole ticket. He holds users:view, org:view,
    // lookups:view and workflows:view — for the task assignee picker and the
    // rest — and is not an administrator.
    it('hides the whole section from a working role holding four page permissions', () => {
      const groups = visibleNavGroups(
        access({
          permissions: ['users:view', 'org:view', 'lookups:view', 'workflows:view'],
        }),
      );
      // ACC-120 slice 11, PR F — his org:view now opens the read-only
      // Organisation page under Quality management, never Administration.
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'tasks', 'awaiting'] },
        { group: 'quality', items: ['organizationReadOnly'] },
      ]);
    });

    // ACC-255 PR 4a, Q-D: the Workflows item is the Organization
    // Administrator's (workflows:manage, root-only since ACC-258). A tenant-made
    // admin role with workflows:view but not workflows:manage gets no item.
    it('shows Workflows only with workflows:manage, not workflows:view', () => {
      const items = (permissions: string[]) =>
        visibleNavGroups(access({ permissions: [ADMIN_ACCESS, 'lookups:view', ...permissions] })).flatMap((g) => g.items.map((i) => i.key));
      expect(items(['workflows:view'])).withContext('non-vacuity: the admin group renders').toContain('lookups');
      expect(items(['workflows:view'])).not.toContain('workflows');
      expect(items(['workflows:view', 'workflows:manage'])).toContain('workflows');
    });

    // The other direction, so the group permission is not quietly doing all
    // the work: admin:access on its own opens nothing.
    it('shows nothing in the section to a role holding admin:access and no page permission', () => {
      const groups = visibleNavGroups(access({ permissions: [ADMIN_ACCESS] }));
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'tasks', 'awaiting'] },
      ]);
    });

    it('declares the permission on the group, so every item inherits it', () => {
      const admin = TENANT_NAV_GROUPS.find((g) => g.key === 'admin');
      expect(admin?.requiredPermission).toBe(ADMIN_ACCESS);
      for (const group of TENANT_NAV_GROUPS.filter((g) => g.key !== 'admin')) {
        expect(group.requiredPermission).withContext(group.key).toBeUndefined();
      }
    });
  });

  // ── OPTION A, PINNED ─────────────────────────────────────────────────────
  //
  // Committees is the one Quality item that is NOT entitlement-driven. No
  // tenant has any module switched on, so gating it on
  // isModuleEnabled('committees') would remove it from every rail. If this
  // test fails because someone added a moduleKey, read the comment on the
  // committees item in nav-items.ts first: the data has to be switched on
  // before the gate is.
  describe('Committees (deliberately permission-gated only)', () => {
    it('shows with committees:view even though the committees module is NOT enabled', () => {
      const groups = visibleNavGroups(
        access({ permissions: ['committees:view'], modules: [] }),
      );
      expect(keysOf(groups)).toContain({
        group: 'quality',
        items: ['committees'],
      });
    });

    it('carries no moduleKey', () => {
      const committees = TENANT_NAV_GROUPS.flatMap((g) => g.items).find(
        (i) => i.key === 'committees',
      );
      expect(committees?.moduleKey).toBeUndefined();
    });

    // ACC-281 — the permission is met by holding it OR by sitting on an active
    // committee (orWhen: 'committeeMember'), and only once membership is known.
    describe('or a committee member (ACC-281)', () => {
      const item = TENANT_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'committees')!;
      const withMembership = (permissions: string[], member: boolean): NavAccess => ({
        ...access({ permissions }),
        isCommitteeMember: () => member,
      });

      it('carries orWhen: committeeMember, and keeps committees:view', () => {
        expect(item.orWhen).toBe('committeeMember');
        expect(item.requiredPermission).toBe('committees:view');
      });

      it('permission held, not a member: shows', () => {
        expect(isNavItemVisible(item, withMembership(['committees:view'], false))).toBeTrue();
      });

      it('no permission, a member: shows', () => {
        expect(isNavItemVisible(item, withMembership([], true))).toBeTrue();
      });

      it('no permission, not a member (or not known yet): hides', () => {
        expect(isNavItemVisible(item, withMembership([], false))).toBeFalse();
      });

      it('no permission, and an access that cannot answer membership: hides', () => {
        expect(isNavItemVisible(item, access({ permissions: [] }))).toBeFalse();
      });

      it('membership opens no other item', () => {
        const others = TENANT_NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.requiredPermission && i.key !== 'committees');
        for (const other of others) {
          expect(isNavItemVisible(other, withMembership([], true))).withContext(other.key).toBeFalse();
        }
      });

      it('ROUTE_PERMISSIONS is unchanged: committees still maps to committees:view', () => {
        expect(ROUTE_PERMISSIONS.get('committees')).toEqual(['committees:view']);
      });
    });
  });

  // ACC-120 slice 11, PR F (D1, B1) — the read-only Organisation page.
  describe('the read-only Organisation item', () => {
    const orgItems = (groups: ReturnType<typeof visibleNavGroups>) =>
      groups.flatMap((g) => g.items.filter((i) => i.route === '/org' || i.route === '/organization').map((i) => `${g.key}:${i.route}`));

    it('a quality manager (org:view, no admin:access) gets it under Quality management, and no Administration', () => {
      const groups = visibleNavGroups(access({ permissions: ['org:view', 'users:view', 'committees:view'] }));
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'tasks', 'awaiting'] },
        { group: 'quality', items: ['committees', 'organizationReadOnly'] },
      ]);
      expect(orgItems(groups)).toEqual(['quality:/org']);
    });

    it('a user without org:view gets neither item', () => {
      expect(orgItems(visibleNavGroups(access({ permissions: ['committees:view', 'users:view'] })))).toEqual([]);
      expect(orgItems(visibleNavGroups(access({ permissions: [ADMIN_ACCESS, 'users:view'] })))).toEqual([]);
    });

    it('an administrator sees only Organization Structure under Administration, never both', () => {
      expect(orgItems(visibleNavGroups(access({ permissions: [ADMIN_ACCESS, 'org:view'] })))).toEqual(['admin:/organization']);
      expect(orgItems(visibleNavGroups(access({ permissions: ALL_TENANT_PERMISSIONS })))).toEqual(['admin:/organization']);
    });

    it('its route needs org:view only; /organization still needs admin:access as well', () => {
      expect(ROUTE_PERMISSIONS.get('org')).toEqual(['org:view']);
      expect(ROUTE_PERMISSIONS.get('organization')).toEqual([ADMIN_ACCESS, 'org:view']);
    });

    it('hiddenWithPermission hides the link only for a holder of that permission', () => {
      const item = TENANT_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'organizationReadOnly')!;
      expect(item.hiddenWithPermission).toBe(ADMIN_ACCESS);
      expect(isNavItemVisible(item, access({ permissions: ['org:view'] }))).toBe(true);
      expect(isNavItemVisible(item, access({ permissions: ['org:view', ADMIN_ACCESS] }))).toBe(false);
    });
  });

  describe('an entitlement-driven item', () => {
    const documents: NavItem = {
      key: 'documents',
      labelKey: 'nav.documents',
      icon: 'pi pi-file',
      route: '/documents',
      requiredPermission: 'documents:view',
      moduleKey: 'documents',
    };

    it('is hidden when the module is not usable, even with the permission', () => {
      expect(
        isNavItemVisible(
          documents,
          access({ permissions: ['documents:view'] }),
        ),
      ).toBe(false);
    });

    it('is hidden without the permission, even when the module is usable', () => {
      expect(
        isNavItemVisible(documents, access({ modules: ['documents'] })),
      ).toBe(false);
    });

    // isModuleEnabled is true for READ_ONLY as well as FULL — a read-only
    // module is fully present in the rail; its write controls are decided on
    // the page.
    it('is shown when both the permission and the entitlement allow it', () => {
      expect(
        isNavItemVisible(
          documents,
          access({ permissions: ['documents:view'], modules: ['documents'] }),
        ),
      ).toBe(true);
    });
  });

  describe('platform admin', () => {
    it('sees the platform group and NOTHING from the tenant groups', () => {
      const groups = visibleNavGroups(
        access({ platformAdmin: true, permissions: ALL_TENANT_PERMISSIONS }),
      );
      expect(groups.map((g) => g.key)).toEqual(['platform']);
    });

    // Before ACC-79 the platform rail had one link, and two of these screens
    // were reachable only by typing their URLs.
    it('reaches every built platform screen from the rail', () => {
      const groups = visibleNavGroups(access({ platformAdmin: true }));
      expect(groups[0]!.items.map((i) => i.route)).toEqual([
        '/platform/tenants',
        '/platform/plans',
        '/platform/ai-credit-packs',
        '/platform/ai-feature-costs',
        '/platform/settings',
      ]);
    });
  });

  describe('ROUTE_PERMISSIONS (what permissionGuard reads)', () => {
    it('does not gate My tasks, which is self-scoped', () => {
      expect(ROUTE_PERMISSIONS.has('tasks')).toBe(false);
    });

    // ACC-120 slice 3 — /tasks/all and /tasks/unassigned are redirects to saved
    // views now; a view a viewer lacks is refused by its own list, so neither
    // path is a route the guard maps.
    it('maps neither old task path: both are redirects to saved views', () => {
      expect(ROUTE_PERMISSIONS.has('tasks/all')).toBe(false);
      expect(ROUTE_PERMISSIONS.has('tasks/unassigned')).toBe(false);
    });

    // ACC-79 — the hub is gone. Its four screens are rail items, so they are
    // mapped from the groups; the bare parent path must NOT be, or it would
    // silently re-impose one permission on all four.
    it('maps each admin-settings screen, and not the removed hub', () => {
      expect(ROUTE_PERMISSIONS.has('admin-settings')).toBe(false);
      expect(ROUTE_PERMISSIONS.get('admin-settings/organization-profile')).toEqual([
        ADMIN_ACCESS,
        'tenant:view',
      ]);
      for (const screen of ['email-provider', 'ai-settings', 'storage', 'task-sla']) {
        expect(ROUTE_PERMISSIONS.get(`admin-settings/${screen}`))
          .withContext(screen)
          .toEqual([ADMIN_ACCESS, 'tenant:manage_config']);
      }
    });

    // The single-source guarantee: a link and its route cannot disagree. It now
    // covers the group permission too, which is what makes "every
    // Administration route is guarded by it" true of routes nobody listed by
    // hand — including any item added later.
    it('contains every tenant item that declares a permission, with that permission and its group\u0027s', () => {
      for (const group of TENANT_NAV_GROUPS) {
        for (const item of group.items) {
          if (!item.requiredPermission) continue;
          const expected = group.requiredPermission
            ? [group.requiredPermission, item.requiredPermission]
            : [item.requiredPermission];
          expect(ROUTE_PERMISSIONS.get(item.route.replace(/^\//, '')))
            .withContext(item.key)
            .toEqual(expected);
        }
      }
    });

    // ACC-123 — stated as its own assertion rather than left implied by the
    // loop above, because "every Administration route requires admin:access"
    // is the acceptance criterion and should fail by name if it stops holding.
    it('requires admin:access on EVERY Administration route', () => {
      const admin = TENANT_NAV_GROUPS.find((g) => g.key === 'admin')!;
      for (const item of admin.items) {
        expect(ROUTE_PERMISSIONS.get(item.route.replace(/^\//, '')))
          .withContext(item.key)
          .toContain(ADMIN_ACCESS);
      }
      // ACC-260 — File storage is the fourteenth, the Recycle bin (PR D) the
      // fifteenth; ACC-120 slice 3 — Unassigned tasks left the section (a saved
      // view of /tasks now), so there are fourteen.
      expect(admin.items.length).withContext('the section is not empty').toBe(14);
    });

    it('holds no platform routes — /platform is guarded as a whole', () => {
      const platformRoutes = PLATFORM_NAV_GROUPS.flatMap((g) => g.items).map(
        (i) => i.route.replace(/^\//, ''),
      );
      for (const route of platformRoutes) {
        expect(ROUTE_PERMISSIONS.has(route)).withContext(route).toBe(false);
      }
    });
  });
});

// ACC-228, ACC-120 slice 3 — Tasks is the rail item of every view of /tasks
// and of a task's own page. It is lit by PREFIX, which is only safe while no
// other item lives under /tasks: an item there would make the rail fall back to
// an exact match, and every view (?view=) and /tasks/:id would go dark.
describe('Tasks owns everything under /tasks (ACC-228, ACC-120 slice 3)', () => {
  const tasks = TENANT_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.key === 'tasks')!;

  it('is the only item whose route is /tasks or below it', () => {
    const under = TENANT_NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.route === '/tasks' || i.route.startsWith('/tasks/'));
    expect(under.map((i) => i.key)).toEqual(['tasks']);
  });

  it('needs no alsoActiveFor pattern: the prefix covers /tasks/:id', () => {
    expect(tasks.route).toBe('/tasks');
    expect(tasks.alsoActiveFor).toBeUndefined();
  });
});

// ACC-292 — the Administration console's cards come from the admin items, and
// the rail draws the group as ONE item to /admin.
describe('the Administration console in the nav model (ACC-292)', () => {
  const access = (permissions: string[], platformAdmin = false): NavAccess => ({
    hasPermission: (p) => permissions.includes(p),
    isModuleEnabled: () => false,
    isPlatformAdmin: () => platformAdmin,
  });
  const admin = TENANT_NAV_GROUPS.find((g) => g.key === 'admin')!;
  const lookup = (dict: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), dict);

  it('gives every admin item a card except Setup health', () => {
    expect(admin.items.filter((i) => !i.console).map((i) => i.key)).toEqual(['setupHealth']);
  });

  it('orders the cards as the design does: 13, in four groups', () => {
    const carded = admin.items.filter((i) => i.console);
    expect(carded.map((i) => `${i.console!.group}:${i.key}`)).toEqual([
      'people:users',
      'people:roles',
      'organisation:organization',
      'organisation:orgPositions',
      'organisation:organizationProfile',
      'work:workflows',
      'work:workingCalendar',
      'work:taskSla',
      'work:lookups',
      'connections:emailProvider',
      'connections:aiCredits',
      'connections:fileStorage',
      'connections:recycleBin',
    ]);
    expect(ADMIN_CONSOLE_GROUPS.map((g) => g.key)).toEqual(['people', 'organisation', 'work', 'connections']);
  });

  it('resolves every card line and console group name in English and Arabic', () => {
    const keys = [...ADMIN_CONSOLE_GROUPS.map((g) => g.labelKey), ...admin.items.filter((i) => i.console).map((i) => i.console!.lineKey)];
    for (const key of keys) {
      expect(typeof lookup(en, key)).withContext(`en: ${key}`).toBe('string');
      expect(typeof lookup(ar, key)).withContext(`ar: ${key}`).toBe('string');
    }
  });

  it('keeps synonyms in lower case, with the design’s own example', () => {
    for (const item of admin.items) {
      for (const synonym of item.console?.synonyms ?? []) expect(synonym).withContext(item.key).toBe(synonym.toLowerCase());
    }
    expect(admin.items.find((i) => i.key === 'emailProvider')!.console!.synonyms).toContain('smtp');
  });

  it('gives the group its own page, /admin', () => {
    expect(admin.route).toBe('/admin');
    for (const group of TENANT_NAV_GROUPS.filter((g) => g.key !== 'admin')) expect(group.route).withContext(group.key).toBeUndefined();
  });

  describe('canOpenAdminConsole', () => {
    it('no admin:access: no (whatever page permissions)', () => {
      expect(canOpenAdminConsole(access(['users:view', 'org:view', 'lookups:view']))).toBe(false);
    });
    it('admin:access and no admin page: no', () => {
      expect(canOpenAdminConsole(access([ADMIN_ACCESS]))).toBe(false);
    });
    it('admin:access and one admin page: yes', () => {
      expect(canOpenAdminConsole(access([ADMIN_ACCESS, 'roles:view']))).toBe(true);
    });
    it('a platform admin: no', () => {
      expect(canOpenAdminConsole(access([ADMIN_ACCESS, 'users:view'], true))).toBe(false);
    });
    it('STANDALONE_ROUTE_PERMISSIONS maps admin to admin:access, the floor', () => {
      expect(ROUTE_PERMISSIONS.get('admin')).toEqual([ADMIN_ACCESS]);
    });
  });

  describe('visibleAdminConsoleItems', () => {
    it('a custom role: only the carded items it may see', () => {
      expect(visibleAdminConsoleItems(access([ADMIN_ACCESS, 'setup:view', 'users:view', 'roles:view'])).map((i) => i.key)).toEqual([
        'users',
        'roles',
      ]);
    });
    it('no admin:access: none', () => {
      expect(visibleAdminConsoleItems(access(['users:view']))).toEqual([]);
    });
  });

  describe('railNavGroups', () => {
    const railAdmin = (permissions: string[]) => railNavGroups(access(permissions)).find((g) => g.key === 'admin');

    it('draws the admin group as one item to /admin, named as the group', () => {
      const group = railAdmin([ADMIN_ACCESS, 'users:view', 'roles:view', 'tenant:manage_config'])!;
      expect(group.items.length).toBe(1);
      expect(group.items[0]!.route).toBe('/admin');
      expect(group.items[0]!.labelKey).toBe('nav.groups.admin');
    });

    it('no admin group at all without access', () => {
      expect(railAdmin(['users:view'])).toBeUndefined();
      expect(railAdmin([ADMIN_ACCESS])).toBeUndefined();
    });

    it('carries the Setup health badge only for a setup:view holder', () => {
      expect(railAdmin([ADMIN_ACCESS, 'setup:view'])!.items[0]!.badge).toBe('setupHealth');
      expect(railAdmin([ADMIN_ACCESS, 'setup:view'])!.items[0]!.collapsedLabelKey).toBe('shell.adminOpenProblems');
      expect(railAdmin([ADMIN_ACCESS, 'users:view'])!.items[0]!.badge).toBeUndefined();
    });

    it('is lit on every admin route and below it, never on a look-alike', () => {
      const pattern = railAdmin([ADMIN_ACCESS, 'users:view'])!.items[0]!.alsoActiveFor!;
      for (const item of admin.items) {
        expect(pattern.test(item.route)).withContext(item.route).toBe(true);
        expect(pattern.test(`${item.route}/x`)).withContext(`${item.route}/x`).toBe(true);
      }
      for (const path of ['/users-guide', '/home', '/tasks', '/admin-settings']) expect(pattern.test(path)).withContext(path).toBe(false);
    });

    it('leaves every other group as it is', () => {
      const groups = railNavGroups(access([ADMIN_ACCESS, 'users:view', 'committees:view']));
      const plain = visibleNavGroups(access([ADMIN_ACCESS, 'users:view', 'committees:view']));
      expect(groups.filter((g) => g.key !== 'admin')).toEqual(plain.filter((g) => g.key !== 'admin'));
    });
  });
});
