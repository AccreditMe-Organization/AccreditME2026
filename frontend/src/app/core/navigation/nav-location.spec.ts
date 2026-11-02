import { NavAccess } from './nav-items';
import { normalizePath, resolveNavLocation } from './nav-location';
import { ADMIN_ACCESS } from './admin-access';

describe('resolveNavLocation (ACC-79)', () => {
  const access = (
    permissions: string[] = [],
    platformAdmin = false,
  ): NavAccess => ({
    hasPermission: (p) => permissions.includes(p),
    isModuleEnabled: () => false,
    isPlatformAdmin: () => platformAdmin,
  });

  it('matches on whole segments, so a route that merely starts with the same letters does not match', () => {
    // '/tasks' must not claim '/tasks-archive'. A plain startsWith would.
    expect(resolveNavLocation('/tasks-archive', access())).toBeNull();
  });

  // ACC-120 slice 3 — the views of /tasks are one item: the query names the
  // view and is dropped, so every view is the Tasks section page. (The
  // longest-match rule stays for nested items; since All tasks and Unassigned
  // left the rail there are none, which nav-items.spec pins.)
  it('resolves every view of /tasks to Tasks, as the section page', () => {
    for (const url of ['/tasks', '/tasks?view=all', '/tasks?view=unit', '/tasks?view=unassigned&reassign=t-1']) {
      const loc = resolveNavLocation(url, access([ADMIN_ACCESS, 'committees:manage_tasks', 'committees:view_all_tasks']));
      expect(loc?.item.key).withContext(url).toBe('tasks');
      expect(loc?.isSectionPage).withContext(url).toBe(true);
    }
  });

  it('marks a page below its section as not the section page', () => {
    const loc = resolveNavLocation(
      '/roles/abc/permissions',
      access([ADMIN_ACCESS, 'roles:view']),
    );
    expect(loc?.item.key).toBe('roles');
    expect(loc?.isSectionPage).toBe(false);
  });

  it('resolves only among items this user can see', () => {
    expect(resolveNavLocation('/users', access([]))).toBeNull();
    // ACC-123 — users:view alone no longer reaches the item: Administration
    // takes admin:access too, and this resolver reads the same rail the user
    // sees. A trail naming a section they cannot open would be its own defect.
    expect(resolveNavLocation('/users', access(['users:view']))).toBeNull();
    expect(
      resolveNavLocation('/users', access([ADMIN_ACCESS, 'users:view']))?.item.key,
    ).toBe('users');
  });

  it('resolves platform routes only for a platform admin', () => {
    expect(
      resolveNavLocation('/platform/plans/abc', access([], false)),
    ).toBeNull();
    expect(
      resolveNavLocation('/platform/plans/abc', access([], true))?.item.key,
    ).toBe('plans');
  });

  describe('normalizePath', () => {
    it('drops the query string, fragment and trailing slash', () => {
      expect(normalizePath('/users?users.scope=ACTIVE')).toBe('/users');
      expect(normalizePath('/users#top')).toBe('/users');
      expect(normalizePath('/users/')).toBe('/users');
      expect(normalizePath('')).toBe('/');
    });
  });
});
