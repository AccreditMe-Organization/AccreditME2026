import {
  NavAccess,
  NavItem,
  PLATFORM_NAV_GROUPS,
  ROUTE_PERMISSIONS,
  TENANT_NAV_GROUPS,
  isNavItemVisible,
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
        { group: 'work', items: ['home', 'myTasks'] },
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
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'myTasks'] },
      ]);
    });

    // The other direction, so the group permission is not quietly doing all
    // the work: admin:access on its own opens nothing.
    it('shows nothing in the section to a role holding admin:access and no page permission', () => {
      const groups = visibleNavGroups(access({ permissions: [ADMIN_ACCESS] }));
      expect(keysOf(groups)).toEqual([
        { group: 'work', items: ['home', 'myTasks'] },
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
      // /tasks/all is a stopgap route with no nav item, not an Administration
      // screen, so ACC-123 left it on tasks:view alone.
      expect(ROUTE_PERMISSIONS.get('tasks/all')).toEqual(['tasks:view']);
      expect(ROUTE_PERMISSIONS.get('tasks/unassigned')).toEqual([
        ADMIN_ACCESS,
        'tasks:manage',
      ]);
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
      for (const screen of ['email-provider', 'ai-settings', 'task-sla']) {
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
      expect(admin.items.length).withContext('the section is not empty').toBe(13);
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
