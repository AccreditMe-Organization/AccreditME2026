import { Component, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { BreadcrumbComponent } from './breadcrumb.component';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

// Mirrors the real architecture: BreadcrumbComponent lives inside the SHELL's
// own template (a template child, not a routed leaf), so its constructor runs
// the instant the shell activates — before Angular finishes activating the
// shell's nested, lazy-loaded child route. That timing is what reproduced the
// original ACC-14 crash, and the lazy committees route below keeps exercising it.
@Component({
  selector: 'stub-shell',
  standalone: true,
  imports: [BreadcrumbComponent],
  template: `<app-breadcrumb />`,
})
class StubShellComponent {}

@Component({ template: '', standalone: true })
class StubLeafComponent {}

const lazy = (): Promise<Routes> =>
  Promise.resolve([
    { path: '', component: StubLeafComponent },
    { path: ':id', component: StubLeafComponent },
  ] as Routes);

const routes: Routes = [
  {
    path: '',
    component: StubShellComponent,
    children: [
      { path: 'home', component: StubLeafComponent },
      { path: 'committees', loadChildren: lazy },
      { path: 'users', loadChildren: lazy },
      {
        path: 'tasks',
        children: [
          { path: '', component: StubLeafComponent },
          { path: 'unassigned', component: StubLeafComponent },
        ],
      },
      {
        path: 'platform',
        children: [
          { path: 'tenants', component: StubLeafComponent },
          { path: 'tenants/:id', component: StubLeafComponent },
        ],
      },
    ],
  },
];

import { ADMIN_ACCESS } from '../../core/navigation/admin-access';

describe('BreadcrumbComponent (ACC-79 — ancestry, stops at the parent)', () => {
  let tenantName: WritableSignal<string>;
  let permissions: WritableSignal<string[]>;
  let platformAdmin: boolean;

  function configure(
    opts: {
      permissions?: string[];
      platformAdmin?: boolean;
      tenantName?: string;
    } = {},
  ) {
    tenantName = signal(opts.tenantName ?? 'Al Nakheel Specialist Hospital');
    permissions = signal(opts.permissions ?? []);
    platformAdmin = opts.platformAdmin ?? false;
    const access: Partial<NavigationAccessService> = {
      tenantName: tenantName.asReadonly(),
      permissions: permissions.asReadonly(),
      modules: signal({}).asReadonly(),
      hasPermission: (p: string) => permissions().includes(p),
      isModuleEnabled: () => false,
      isPlatformAdmin: () => platformAdmin,
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideTranslateService({ lang: 'en' }),
        { provide: NavigationAccessService, useValue: access },
      ],
    });
  }

  async function trailAt(url: string) {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    const crumb = harness.routeDebugElement!.query(
      By.directive(BreadcrumbComponent),
    ).componentInstance as BreadcrumbComponent;
    return { harness, crumb };
  }

  const TENANT = 'Al Nakheel Specialist Hospital';

  it('shows only the tenant on the landing page, not linking to the page already open', async () => {
    configure();
    const { crumb } = await trailAt('/home');
    expect(crumb.items()).toEqual([{ text: TENANT, url: null }]);
  });

  // UX-04. The last crumb used to BE the current page, directly above an H1
  // saying the same word.
  it('never names the current page on a section page — the H1 owns that', async () => {
    configure({ permissions: [ADMIN_ACCESS, 'users:view'] });
    const { crumb } = await trailAt('/users');
    expect(crumb.items()).toEqual([
      { text: TENANT, url: '/home' },
      { labelKey: 'nav.groups.admin', url: null },
    ]);
    expect(crumb.items().some((i) => i.labelKey === 'nav.users')).toBe(false);
  });

  it('ignores the query string, so a filtered list keeps the same trail', async () => {
    configure({ permissions: [ADMIN_ACCESS, 'users:view'] });
    const { crumb } = await trailAt('/users?users.scope=ACTIVE');
    expect(crumb.items().map((i) => i.labelKey ?? i.text)).toEqual([
      TENANT,
      'nav.groups.admin',
    ]);
  });

  // Also the lazy-route timing case from ACC-14: this route is lazy-loaded and
  // nested, and the component constructed before it activated.
  it('gives a record page its section as a linked parent, without throwing on a lazy route', async () => {
    configure({ permissions: ['committees:view'] });
    const harness = await RouterTestingHarness.create();
    await expectAsync(
      harness.navigateByUrl('/committees/abc123'),
    ).toBeResolved();
    harness.detectChanges();
    const crumb = harness.routeDebugElement!.query(
      By.directive(BreadcrumbComponent),
    ).componentInstance as BreadcrumbComponent;

    expect(crumb.items()).toEqual([
      { text: TENANT, url: '/home' },
      { labelKey: 'nav.groups.quality', url: null },
      { labelKey: 'nav.committees', url: '/committees' },
    ]);
  });

  // Longest route wins: '/tasks' is a prefix of '/tasks/unassigned', but the
  // unassigned view belongs to Administration, not to My work.
  it('resolves /tasks/unassigned to Administration, not to My tasks', async () => {
    configure({ permissions: [ADMIN_ACCESS, 'tasks:manage'] });
    const { crumb } = await trailAt('/tasks/unassigned');
    expect(crumb.items()).toEqual([
      { text: TENANT, url: '/home' },
      { labelKey: 'nav.groups.admin', url: null },
    ]);
  });

  // A user without users:view on their OWN profile must not be told they are in
  // Administration, nor handed a Users link that would bounce them.
  it('shows only the tenant for a page the user reaches without its section permission', async () => {
    configure({ permissions: [] });
    const { crumb } = await trailAt('/users/me-123');
    expect(crumb.items()).toEqual([{ text: TENANT, url: '/home' }]);
  });

  describe('platform shell', () => {
    it('shows Platform alone on the platform landing page — not "Platform / Platform"', async () => {
      configure({ platformAdmin: true });
      const { crumb } = await trailAt('/platform/tenants');
      expect(crumb.items()).toEqual([
        { labelKey: 'shell.product.platform', url: null },
      ]);
    });

    // The platform landing page IS the tenants list, so the root and the
    // Tenants crumb would both lead there. Only the specific one links.
    it('links a tenant record back to the tenants list, once', async () => {
      configure({ platformAdmin: true });
      const { crumb } = await trailAt('/platform/tenants/abc123');
      expect(crumb.items()).toEqual([
        { labelKey: 'shell.product.platform', url: null },
        { labelKey: 'platform.tenants', url: '/platform/tenants' },
      ]);
    });
  });

  // On a hard reload the navigation can finish BEFORE entitlements load. A trail
  // built once at NavigationEnd would have no root and never recover.
  it('adds the tenant root when entitlements arrive after the navigation', async () => {
    configure({ permissions: [ADMIN_ACCESS, 'users:view'], tenantName: '' });
    const { harness, crumb } = await trailAt('/users');
    expect(crumb.items()).toEqual([
      { labelKey: 'nav.groups.admin', url: null },
    ]);

    tenantName.set(TENANT);
    harness.detectChanges();

    expect(crumb.items()[0]).toEqual({ text: TENANT, url: '/home' });
  });

  // ACC-14 — a failure building one trail must not kill the breadcrumb for the
  // rest of the session.
  it('recovers on the next navigation after a build failure', async () => {
    configure({ permissions: [ADMIN_ACCESS, 'users:view', 'committees:view'] });
    const { harness, crumb } = await trailAt('/users');
    const good = crumb.items();

    const original = crumb.buildBreadcrumb.bind(crumb);
    let calls = 0;
    spyOn(crumb, 'buildBreadcrumb').and.callFake((url: string) => {
      calls++;
      if (calls === 1) throw new Error('simulated breadcrumb build failure');
      return original(url);
    });

    await harness.navigateByUrl('/committees');
    harness.detectChanges();
    // Degrades to the last good trail rather than blanking or crashing.
    expect(crumb.items()).toEqual(good);

    await harness.navigateByUrl('/committees/abc123');
    harness.detectChanges();
    // Still listening to the router — not dead after the error.
    expect(crumb.items().at(-1)).toEqual({
      labelKey: 'nav.committees',
      url: '/committees',
    });
  });
});
