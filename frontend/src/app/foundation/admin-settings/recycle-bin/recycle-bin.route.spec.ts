import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { ADMIN_ACCESS } from '../../../core/navigation/admin-access';
import { visibleNavGroups } from '../../../core/navigation/nav-items';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { ADMIN_SETTINGS_ROUTES } from '../admin-settings.routes';

// ACC-260, PR D — who reaches /admin-settings/recycle-bin, through the REAL
// admin-settings route (its guard and path), with a stub page in place of the
// lazily loaded one; and where its rail item sits.

@Component({ standalone: true, template: '<p data-testid="page">page</p>' })
class PageStub {}

describe('Recycle bin route and rail item (ACC-260, PR D)', () => {
  async function at(url: string, permissions: string[]): Promise<string> {
    const real = ADMIN_SETTINGS_ROUTES.find((r) => r.path === 'recycle-bin')!;
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
    expect(await at('/admin-settings/recycle-bin', [ADMIN_ACCESS, 'tenant:manage_config'])).toBe('/admin-settings/recycle-bin');
  });

  it('without tenant:manage_config, or without admin:access, it is refused', async () => {
    expect(await at('/admin-settings/recycle-bin', [ADMIN_ACCESS, 'tenant:view'])).toBe('/home');
    TestBed.resetTestingModule();
    expect(await at('/admin-settings/recycle-bin', ['tenant:manage_config'])).toBe('/home');
  });

  it('the rail item "Recycle bin" sits right after File storage and asks for tenant:manage_config', () => {
    const access = (perms: string[]) => ({ hasPermission: (p: string) => perms.includes(p), isModuleEnabled: () => false, isPlatformAdmin: () => false });
    const admin = visibleNavGroups(access([ADMIN_ACCESS, 'tenant:manage_config', 'tenant:view'])).find((g) => g.key === 'admin')!;
    const keys = admin.items.map((i) => i.key);
    expect(keys.indexOf('recycleBin')).toBe(keys.indexOf('fileStorage') + 1);
    expect(admin.items.find((i) => i.key === 'recycleBin')).toEqual(
      jasmine.objectContaining({ route: '/admin-settings/recycle-bin', labelKey: 'nav.recycleBin', requiredPermission: 'tenant:manage_config' }),
    );
    expect(visibleNavGroups(access([ADMIN_ACCESS, 'tenant:view'])).find((g) => g.key === 'admin')?.items.map((i) => i.key) ?? []).not.toContain('recycleBin');
  });
});
