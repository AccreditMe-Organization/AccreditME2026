import { NavAccess } from './nav-items';
import { normalizePath, resolveNavLocation } from './nav-location';

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
      access(['tasks:manage']),
    );
    expect(loc?.item.key).toBe('unassignedTasks');
    expect(loc?.isSectionPage).toBe(true);
  });

  it('marks a page below its section as not the section page', () => {
    const loc = resolveNavLocation(
      '/roles/abc/permissions',
      access(['roles:view']),
    );
    expect(loc?.item.key).toBe('roles');
    expect(loc?.isSectionPage).toBe(false);
  });

  it('resolves only among items this user can see', () => {
    expect(resolveNavLocation('/users', access([]))).toBeNull();
    expect(resolveNavLocation('/users', access(['users:view']))?.item.key).toBe(
      'users',
    );
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
