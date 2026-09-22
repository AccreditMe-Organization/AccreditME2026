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

  it('prefers the longest matching route', () => {
    const loc = resolveNavLocation(
      '/tasks/unassigned',
      access([ADMIN_ACCESS, 'tasks:manage']),
    );
    expect(loc?.item.key).toBe('unassignedTasks');
    expect(loc?.isSectionPage).toBe(true);
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
