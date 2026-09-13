import {
  NavAccess,
  NavItem,
  PLATFORM_NAV_GROUPS,
  ROUTE_PERMISSIONS,
  TENANT_NAV_GROUPS,
  isNavItemVisible,
  visibleNavGroups,
} from './nav-items';

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

  // Every permission any tenant item declares — a stand-in for a tenant admin,
  // derived from the model so a new item cannot be missed by this test.
  const ALL_TENANT_PERMISSIONS = TENANT_NAV_GROUPS.flatMap((g) => g.items)
    .map((i) => i.requiredPermission)
    .filter((p): p is string => !!p);

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
        { group: 'work', items: ['home', 'myTasks'] },
      ]);
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

  describe('Administration is gated per item, never on a role', () => {
    it('shows the group to a custom role holding a single admin permission', () => {
      const groups = visibleNavGroups(
        access({ permissions: ['lookups:view'] }),
      );
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'myTasks'] },
        { group: 'admin', items: ['lookups'] },
      ]);
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

    it('still gates the task routes that are not self-scoped', () => {
      expect(ROUTE_PERMISSIONS.get('tasks/all')).toBe('tasks:view');
      expect(ROUTE_PERMISSIONS.get('tasks/unassigned')).toBe('tasks:manage');
    });

    it('gates Admin Settings, now that it is a nav item rather than a standalone entry', () => {
      expect(ROUTE_PERMISSIONS.get('admin-settings')).toBe(
        'tenant:manage_config',
      );
    });

    // The single-source guarantee: a link and its route cannot disagree.
    it('contains every tenant item that declares a permission, with that permission', () => {
      for (const item of TENANT_NAV_GROUPS.flatMap((g) => g.items)) {
        if (!item.requiredPermission) continue;
        expect(ROUTE_PERMISSIONS.get(item.route.replace(/^\//, '')))
          .withContext(item.key)
          .toBe(item.requiredPermission);
      }
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
