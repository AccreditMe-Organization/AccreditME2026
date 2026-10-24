import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { Route, Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { routes as APP_ROUTES } from '../../app.routes';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { ADMIN_ACCESS } from '../../core/navigation/admin-access';
import { BreadcrumbParentService } from '../../core/navigation/breadcrumb-parent.service';
import { resolveNavLocation } from '../../core/navigation/nav-location';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { OrgChartNodeDto, OrgChartResponseDto, OrgStructureNodeDto, OrgUnitSummaryDto } from './services/org-unit.service';

// ACC-120 slice 11, PR F — on the read-only pages (/org, OS §6) every write
// affordance and every Setup health prompt is ABSENT, never disabled, and every
// link between the pages stays inside /org.
//
// Each check runs twice with the SAME selectors, through the REAL routes and
// components:
//   - at /organization, as an administrator, where each control must be
//     PRESENT (so a selector that matches nothing cannot pass by accident);
//   - at /org, as a viewer holding EVERY permission but admin:access
//     (org:manage and setup:view included), where each must be ABSENT. So it is
//     the page's mode that removes them, not a missing permission.

const ADMIN = [ADMIN_ACCESS, 'org:view', 'org:manage', 'users:view', 'committees:view', 'setup:view', 'positions:view'];
const EVERYTHING_BUT_ADMIN = ADMIN.filter((p) => p !== ADMIN_ACCESS);
const ATTENTION = { code: 'ORG_UNIT_WITHOUT_TYPE', severity: 'AT_RISK', since: '2026-10-01T09:00:00.000Z', openCount: 2 } as const;
const HEAD = { userId: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: null, role: 'substantive' as const, countedHere: true };

function unit(id: string, parentId: string | null, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto {
  return {
    id,
    parentId,
    nameEn: id,
    nameAr: null,
    code: id.toUpperCase(),
    type: null,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [HEAD],
    acting: null,
    headcount: 3,
    committees: { count: 0 },
    attention: ATTENTION,
    ...over,
  };
}
const STRUCTURE = [unit('root', null, { childCount: 1 }), unit('pharm', 'root', { childCount: 1 }), unit('pharm-ip', 'pharm')];

function chart(onlyRoot: boolean): OrgChartResponseDto {
  const nodes: OrgChartNodeDto[] = onlyRoot
    ? [{ ...unit('root', null), depth: 0 }]
    : STRUCTURE.map((n, i) => ({ ...n, depth: i }));
  return { root: { id: 'root', path: [{ id: 'root', nameEn: 'root', nameAr: null }] }, depth: 4, asOf: '', nodes };
}

function summary(id: string): OrgUnitSummaryDto {
  const leaf = id === 'pharm-ip';
  return {
    unit: { ...unit(id, leaf ? 'pharm' : 'root', { childCount: leaf ? 0 : 1 }), description: null, createdAt: '', updatedAt: '' },
    path: leaf
      ? [{ id: 'root', nameEn: 'root', nameAr: null }, { id: 'pharm', nameEn: 'pharm', nameAr: null }, { id, nameEn: id, nameAr: null }]
      : [{ id: 'root', nameEn: 'root', nameAr: null }, { id, nameEn: id, nameAr: null }],
    children: leaf ? [] : [unit('pharm-ip', id)],
    positions: [{ positionId: 'pos-dir', nameEn: 'Director', nameAr: null, grade: 10, isUnitHeadPosition: true, count: 1 }],
    people: [{ userId: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: null, isHead: true }],
    committees: { count: 0, items: [] },
    asOf: '',
  };
}

const HEAD_STATUS = {
  holders: [{ id: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: null, headSince: null }],
  pendingHeadUserId: null,
  headHandoverEffectiveDate: null,
  actingHeadUserId: null,
  lastVacancy: null,
  pendingHeadAccessSince: null,
  cover: null,
  scheduledCover: null,
  recentlyEndedCovers: [],
};

function realEntry(path: string): Route {
  const shell = APP_ROUTES.find((r) => r.children?.some((c) => c.path === path));
  const entry = shell?.children?.find((c) => c.path === path);
  if (!entry) throw new Error(`no ${path} route in app.routes.ts`);
  return entry;
}

describe('the read-only Organisation pages: every write is absent (ACC-120 slice 11, PR F)', () => {
  preserveDocumentLanguage();

  let http: HttpTestingController;
  let writes: string[];
  let onlyRoot: boolean;

  function answer(req: TestRequest): void {
    const url = req.request.url;
    if (req.request.method !== 'GET') writes.push(`${req.request.method} ${url}`);
    const m = /\/organization\/units\/([^/]+)\/(summary|history|head)$/.exec(url);
    if (url.endsWith('/organization/units/structure')) return req.flush({ nodes: STRUCTURE, asOf: '' });
    if (url.endsWith('/organization/units/chart')) return req.flush(chart(onlyRoot));
    if (m?.[2] === 'summary') return req.flush(summary(m[1]!));
    if (m?.[2] === 'history') return req.flush({ items: [], total: 0, skip: 0, take: 5 });
    if (m?.[2] === 'head') return req.flush(HEAD_STATUS);
    if (url.endsWith('/users')) return req.flush({ data: [], total: 0, page: 1, pageSize: 200 });
    return req.flush([]);
  }

  async function open(url: string, permissions: string[], opts: { onlyRoot?: boolean } = {}) {
    writes = [];
    onlyRoot = !!opts.onlyRoot;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([realEntry('organization'), realEntry('org'), { path: 'home', children: [] }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p), hasTrustworthyPermissions: () => true, isModuleEnabled: () => false, isPlatformAdmin: () => false },
        },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'viewer', email: 'v@x', name: 'Viewer' }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use('en');
    http = TestBed.inject(HttpTestingController);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle(harness);
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }

  async function settle(harness: RouterTestingHarness): Promise<void> {
    for (let i = 0; i < 8; i++) {
      for (const req of http.match(() => true)) answer(req);
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  afterEach(() => {
    expect(writes).withContext('no request but a GET').toEqual([]);
    TestBed.resetTestingModule();
  });

  const present = (el: HTMLElement, sel: string) => el.querySelector(sel) !== null;
  const menuItems = async (harness: RouterTestingHarness, el: HTMLElement, unitId: string) => {
    el.querySelector<HTMLButtonElement>(`tr[data-unit="${unitId}"] [data-testid="row-menu-trigger"]`)!.click();
    await settle(harness);
    const items = Array.from(document.querySelectorAll('[data-testid="row-menu"] [cdkMenuItem], [data-testid="row-menu"] .am-row-menu__item')).map((i) =>
      i.textContent!.replace(/\s+/g, ' ').trim(),
    );
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return items;
  };

  // ── the tree ──────────────────────────────────────────────────────────────
  const TREE_WRITES = ['[data-testid="tree-add-unit"]', '[data-testid="tree-show-inactive"]', 'th[data-col="attention"]', '[data-testid="attention-chip"]'];

  it('tree, /organization as an administrator: every write control the spec looks for is there', async () => {
    const { harness, el } = await open('/organization', ADMIN);
    expect(present(el, 'tr[data-unit="root"]')).toBeTrue();
    for (const sel of TREE_WRITES) expect(present(el, sel)).withContext(sel).toBeTrue();
    expect(el.querySelector('h1')!.textContent!.trim()).toBe('Organization Structure');
    const items = await menuItems(harness, el, 'pharm');
    expect(items).toEqual(jasmine.arrayContaining(['Add sub-unit', 'Edit', 'Deactivate', 'Open unit', 'Show on chart', 'Headship details']));
  });

  it('tree, /org: no Add unit, no Show deactivated, no Attention, a ⋯ with the View items only, links inside /org', async () => {
    const { harness, el } = await open('/org', EVERYTHING_BUT_ADMIN);
    expect(present(el, 'tr[data-unit="root"]')).toBeTrue();
    for (const sel of TREE_WRITES) expect(present(el, sel)).withContext(sel).toBeFalse();
    expect(el.querySelector('h1')!.textContent!.trim()).toBe('Organization');
    expect(el.querySelector('tr[data-unit="root"] a[data-testid="unit-name"]')!.getAttribute('href')).toBe('/org/units/root');
    expect(await menuItems(harness, el, 'pharm')).toEqual(['Open unit', 'Show on chart']);
    expect(present(el, 'am-headship-actions')).toBeFalse();
  });

  // ── the chart ─────────────────────────────────────────────────────────────
  const panelActions = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid="chart-panel"] a[data-testid], [data-testid="chart-panel"] button[data-testid]')).map((a) => a.getAttribute('data-testid'));

  it('chart, /organization as an administrator: the chips and the add-first action are there', async () => {
    const tree = await open('/organization?view=chart&sel=pharm', ADMIN);
    expect(present(tree.el, '[data-testid="box-chip"]')).toBeTrue();
    expect(tree.el.querySelector('[data-testid="panel-open"]')!.getAttribute('href')).toBe('/organization/units/pharm');
    TestBed.resetTestingModule();
    const only = await open('/organization?view=chart', ADMIN, { onlyRoot: true });
    expect(present(only.el, '[data-testid="chart-only-root"] button')).toBeTrue();
  });

  it('chart, /org: no severity chip, no add-first action, the panel keeps its three actions, all inside /org', async () => {
    const tree = await open('/org?view=chart&sel=pharm', EVERYTHING_BUT_ADMIN);
    expect(present(tree.el, '[data-box="pharm"]')).toBeTrue();
    expect(present(tree.el, '[data-testid="box-chip"]')).toBeFalse();
    expect(panelActions(tree.el)).toEqual(['panel-open', 'panel-show-from-here', 'panel-find-in-tree']);
    expect(tree.el.querySelector('[data-testid="panel-open"]')!.getAttribute('href')).toBe('/org/units/pharm');
    tree.el.querySelector<HTMLButtonElement>('[data-testid="panel-find-in-tree"]')!.click();
    await settle(tree.harness);
    expect(TestBed.inject(Router).url.startsWith('/org?')).toBeTrue();
    TestBed.resetTestingModule();
    const only = await open('/org?view=chart', EVERYTHING_BUT_ADMIN, { onlyRoot: true });
    expect(present(only.el, '[data-testid="chart-only-root"]')).toBeTrue();
    expect(present(only.el, '[data-testid="chart-only-root"] button')).toBeFalse();
  });

  // ── the record ────────────────────────────────────────────────────────────
  const RECORD_WRITES = [
    '[data-testid="unit-actions"]',
    '[data-testid="unit-edit"]',
    '[data-testid="unit-add-child"]',
    '[data-testid="unit-strip"]',
    '[data-testid="unit-strip-fix"]',
    '[data-testid="headship-actions"]',
  ];

  it('record, /organization as an administrator: every write control and the Setup health strip are there', async () => {
    const { el } = await open('/organization/units/pharm', ADMIN);
    for (const sel of RECORD_WRITES) expect(present(el, sel)).withContext(sel).toBeTrue();
    expect(present(el, 'am-headship-panel a[href="/users/fahad"]')).withContext('the head links to their record').toBeTrue();
    TestBed.resetTestingModule();
    const leaf = await open('/organization/units/pharm-ip', ADMIN);
    expect(present(leaf.el, '[data-testid="unit-subs-add"]')).toBeTrue();
  });

  it('record, /org: no Edit, Add sub-unit, ⋯, Setup health strip or headship action; its links stay in /org', async () => {
    const { el } = await open('/org/units/pharm', EVERYTHING_BUT_ADMIN);
    expect(present(el, '[data-testid="unit-header"]')).toBeTrue();
    expect(present(el, '[data-row]')).withContext('the Headship panel shows its state rows').toBeTrue();
    for (const sel of RECORD_WRITES) expect(present(el, sel)).withContext(sel).toBeFalse();
    expect(el.querySelector('[data-testid="unit-show-in-tree"]')!.getAttribute('href')).toBe('/org?show=pharm');
    const hrefs = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href')!);
    expect(hrefs.filter((h) => h.startsWith('/organization'))).toEqual([]);
    // users:view without admin:access: names, never a link to a page that refuses them (D7, ACC-123).
    expect(hrefs.filter((h) => h.startsWith('/users'))).toEqual([]);
    expect(hrefs).toContain('/org/units/pharm-ip');
    expect(hrefs).toContain('/org/units/root');
    const crumb = TestBed.inject(BreadcrumbParentService).current();
    expect(crumb?.forPath).toBe('/org/units/pharm');
    expect(crumb?.url).toBe('/org/units/root');
    TestBed.resetTestingModule();
    const leaf = await open('/org/units/pharm-ip', EVERYTHING_BUT_ADMIN);
    expect(present(leaf.el, '[data-testid="unit-subs-add"]')).toBeFalse();
  });

  it('the breadcrumb reads from Quality management on /org, Administration on /organization', () => {
    const access = (perms: string[]) => ({ hasPermission: (p: string) => perms.includes(p), isModuleEnabled: () => false, isPlatformAdmin: () => false });
    expect(resolveNavLocation('/org/units/pharm', access(['org:view']))?.group.key).toBe('quality');
    expect(resolveNavLocation('/organization/units/pharm', access(ADMIN))?.group.key).toBe('admin');
    writes = [];
  });
});
