import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ADMIN_ACCESS } from '../../../core/navigation/admin-access';
import { visibleNavGroups } from '../../../core/navigation/nav-items';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { ADMIN_SETTINGS_ROUTES } from '../admin-settings.routes';

// ACC-260, PR A — who reaches /admin-settings/storage, through the REAL
// admin-settings route (its guard and path), with a stub page in place of the
// lazily loaded one; and where its rail item sits.

@Component({ standalone: true, template: '<p data-testid="page">page</p>' })
class PageStub {}

describe('File storage route and rail item (ACC-260, PR A)', () => {
  async function at(url: string, permissions: string[]): Promise<string> {
    const real = ADMIN_SETTINGS_ROUTES.find((r) => r.path === 'storage')!;
    const { loadComponent: _lazy, ...rest } = real;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'admin-settings', children: [{ ...rest, component: PageStub }] }, { path: 'home', children: [] }]),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p), hasTrustworthyPermissions: () => true },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('a tenant admin (admin:access + tenant:manage_config) reaches it', async () => {
    expect(await at('/admin-settings/storage', [ADMIN_ACCESS, 'tenant:manage_config'])).toBe('/admin-settings/storage');
  });

  it('without tenant:manage_config, or without admin:access, it is refused', async () => {
    expect(await at('/admin-settings/storage', [ADMIN_ACCESS, 'tenant:view'])).toBe('/home');
    TestBed.resetTestingModule();
    expect(await at('/admin-settings/storage', ['tenant:manage_config'])).toBe('/home');
  });

  it('the rail item "File storage" sits in Administration right after AI credits', () => {
    const access = (perms: string[]) => ({ hasPermission: (p: string) => perms.includes(p), isModuleEnabled: () => false, isPlatformAdmin: () => false });
    const admin = visibleNavGroups(access([ADMIN_ACCESS, 'tenant:manage_config', 'tenant:view'])).find((g) => g.key === 'admin')!;
    const keys = admin.items.map((i) => i.key);
    expect(keys.slice(-2)).toEqual(['aiCredits', 'fileStorage']);
    expect(admin.items.at(-1)).toEqual(jasmine.objectContaining({ route: '/admin-settings/storage', labelKey: 'nav.fileStorage', requiredPermission: 'tenant:manage_config' }));
    expect(visibleNavGroups(access([ADMIN_ACCESS, 'tenant:view'])).find((g) => g.key === 'admin')?.items.map((i) => i.key) ?? []).not.toContain('fileStorage');
  });
});
