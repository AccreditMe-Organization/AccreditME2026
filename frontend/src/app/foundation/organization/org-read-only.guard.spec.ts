import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Route, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes as APP_ROUTES } from '../../app.routes';
import { ADMIN_ACCESS } from '../../core/navigation/admin-access';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { isOrgReadOnly } from './org-pages';
import { toAdminUrl } from './org-read-only.guard';

// ACC-120 slice 11, PR F (D1, B1) — who reaches /org, who is sent from it, and
// that /organization still refuses a viewer who does not administer. The
// routes are the REAL /org and /organization entries from app.routes.ts (their
// guards, in their order, and their data), with stub pages in place of the
// lazily loaded tree and record.

@Component({ standalone: true, template: '<p data-testid="page">page</p>' })
class PageStub {
  readonly readOnly = isOrgReadOnly(inject(ActivatedRoute).snapshot);
}
@Component({ standalone: true, template: '<p>home</p>' })
class HomeStub {}

function realEntry(path: string): Route {
  const shell = APP_ROUTES.find((r) => r.children?.some((c) => c.path === path));
  const entry = shell?.children?.find((c) => c.path === path);
  if (!entry) throw new Error(`no ${path} route in app.routes.ts`);
  const { loadChildren: _lazy, ...rest } = entry;
  return { ...rest, children: [{ path: '', component: PageStub }, { path: 'units/:id', component: PageStub }] };
}

describe('the read-only Organisation route, /org (ACC-120 slice 11, PR F)', () => {
  async function at(url: string, permissions: string[], trustworthy = true) {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([realEntry('organization'), realEntry('org'), { path: 'home', component: HomeStub }]),
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p), hasTrustworthyPermissions: () => trustworthy },
        },
      ],
    });
    const harness = await RouterTestingHarness.create();
    const page = await harness.navigateByUrl(url);
    return { url: TestBed.inject(Router).url, page: page instanceof PageStub ? page : null };
  }
  afterEach(() => TestBed.resetTestingModule());

  const QUALITY_MANAGER = ['org:view', 'users:view', 'committees:view'];
  const ADMIN = [ADMIN_ACCESS, 'org:view', 'org:manage', 'users:view'];

  it('a quality manager (org:view, no admin:access) reaches /org, read-only, with its query kept', async () => {
    const tree = await at('/org?view=chart&root=r&sel=s', QUALITY_MANAGER);
    expect(tree.url).toBe('/org?view=chart&root=r&sel=s');
    expect(tree.page?.readOnly).toBeTrue();
    TestBed.resetTestingModule();
    const record = await at('/org/units/u1', QUALITY_MANAGER);
    expect(record.url).toBe('/org/units/u1');
    expect(record.page?.readOnly).toBeTrue();
  });

  it('a user without org:view is refused /org', async () => {
    const r = await at('/org', ['committees:view', 'users:view']);
    expect(r.url).toBe('/home');
    expect(r.page).toBeNull();
  });

  it('an administrator is sent to the same place under /organization, path and query kept', async () => {
    expect((await at('/org', ADMIN)).url).toBe('/organization');
    TestBed.resetTestingModule();
    expect((await at('/org?view=chart&root=r&sel=s', ADMIN)).url).toBe('/organization?view=chart&root=r&sel=s');
    TestBed.resetTestingModule();
    const record = await at('/org/units/u1?x=1', ADMIN);
    expect(record.url).toBe('/organization/units/u1?x=1');
    expect(record.page?.readOnly).toBeFalse();
  });

  it('the read-only viewer is still refused /organization, as before', async () => {
    expect((await at('/organization', QUALITY_MANAGER)).url).toBe('/home');
    TestBed.resetTestingModule();
    expect((await at('/organization/units/u1', QUALITY_MANAGER)).url).toBe('/home');
  });

  it('with permissions not yet known, nobody is redirected (the page is then read-only, the safe way)', async () => {
    const r = await at('/org/units/u1', [], false);
    expect(r.url).toBe('/org/units/u1');
    expect(r.page?.readOnly).toBeTrue();
  });

  it('toAdminUrl moves only a leading /org segment', () => {
    expect(toAdminUrl('/org')).toBe('/organization');
    expect(toAdminUrl('/org?show=a')).toBe('/organization?show=a');
    expect(toAdminUrl('/org/units/a#x')).toBe('/organization/units/a#x');
    expect(toAdminUrl('/org-positions')).toBe('/org-positions');
    expect(toAdminUrl('/organization')).toBe('/organization');
  });
});
