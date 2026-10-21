import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { IOrgUnitHeadStatus } from '../../services/org-unit-head.service';
import { OrgStructureNodeDto, OrgUnitDto } from '../../services/org-unit.service';
import { HeadshipActionsComponent } from '../headship-actions/headship-actions.component';
import { OrgUnitTreeComponent } from './org-unit-tree.component';

// ACC-120 slice 11 (PR C) — /organization, the tree, as each viewer sees it:
// the toolbar (search with its ancestors, the Type filter with "(No type)",
// Show deactivated for org:manage only), the expand state kept per user, the
// row menu in all six headship states and its read-only shape, and Deactivate
// with its confirm and its coded refusal.

const API = environment.apiUrl;
const BASE = `${API}/organization/units`;
const USER = 'u-hessa';
const STORAGE_KEY = `am.orgTree.expanded.${USER}`;

const DEPT = { id: 't-dept', key: 'department', labelEn: 'Department', labelAr: 'قسم', isRetired: false };
const SECTION = { id: 't-sec', key: 'section', labelEn: 'Section', labelAr: 'قسم فرعي', isRetired: false };
const ORG = { id: 't-org', key: 'organization', labelEn: 'Organization', labelAr: 'منشأة', isRetired: false };

function node(id: string, parentId: string | null, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto {
  return {
    id,
    parentId,
    nameEn: id,
    nameAr: null,
    code: id.toUpperCase().slice(0, 10),
    type: DEPT,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [],
    acting: null,
    headcount: 0,
    committees: { count: 0 },
    ...over,
  };
}

const HEAD = (userId: string, name: string | null, role: 'substantive' | 'incoming' = 'substantive') => ({
  userId,
  name,
  positionId: 'pos',
  positionNameEn: 'Director',
  positionNameAr: 'مدير',
  role,
  countedHere: true,
});

const NODES: OrgStructureNodeDto[] = [
  node('root', null, { nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي', type: ORG, childCount: 2, heads: [HEAD('saleh', 'Dr. Saleh Al-Qahtani')], headcount: 6 }),
  node('med', 'root', { nameEn: 'Medical Services', nameAr: 'الخدمات الطبية', childCount: 1, heads: [HEAD('reem', 'Dr. Reem Al-Harbi')], headcount: 31 }),
  node('pharm', 'med', {
    nameEn: 'Pharmacy',
    nameAr: 'الصيدلية',
    childCount: 2,
    heads: [HEAD('fahad', 'Dr. Fahad Al-Anazi')],
    acting: { userId: 'huda', name: 'Dr. Huda Zahrani', reason: 'ABSENCE', validFrom: '2026-09-25T12:00:00.000Z', validTo: null, countedHere: false },
    headcount: 14,
  }),
  node('pharm-ip', 'pharm', { nameEn: 'Inpatient Pharmacy', nameAr: 'صيدلية المرضى المنومين', type: SECTION, headcount: 8 }),
  node('pharm-op', 'pharm', { nameEn: 'Outpatient Pharmacy', nameAr: 'صيدلية العيادات الخارجية', type: SECTION, heads: [HEAD('omar', 'Dr. Omar Haddad')], headcount: 5 }),
  node('pharm-old', 'pharm', { nameEn: 'Retired Pharmacy', isActive: false }),
  node('lab', 'root', { nameEn: 'Laboratory', nameAr: 'المختبر', type: null, headcount: 9 }),
];

const RECORDS: OrgUnitDto[] = NODES.map(
  (n) => ({ ...n, organizationId: 'org', typeValueId: n.type?.id ?? null, typeValue: n.type, description: null, isCodeLocked: false, createdAt: '', updatedAt: '' }) as unknown as OrgUnitDto,
);

// ── head statuses for the six states (ACC-133's matrix) ─────────────────────
const noon = (day: string) => `${day}T12:00:00.000Z`;
const H = { id: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos', positionNameEn: 'Director', positionNameAr: 'مدير', headSince: null };
const I = { id: 'huda', name: 'Dr. Huda Zahrani', positionId: 'pos', positionNameEn: 'Director', positionNameAr: 'مدير', headSince: noon('2026-10-25') };
function status(over: Partial<IOrgUnitHeadStatus> = {}): IOrgUnitHeadStatus {
  return {
    holders: [],
    pendingHeadUserId: null,
    headHandoverEffectiveDate: null,
    actingHeadUserId: null,
    lastVacancy: null,
    pendingHeadAccessSince: null,
    cover: null,
    scheduledCover: null,
    recentlyEndedCovers: [],
    ...over,
  };
}
const covered = (reason: 'VACANCY' | 'ABSENCE') => ({
  cover: { userId: 'tariq', name: 'Dr. Tariq Suleiman', reason, validFrom: noon('2026-09-25'), validTo: null },
  actingHeadUserId: 'tariq',
});
const successor = { holders: [H, I], pendingHeadUserId: 'huda', headHandoverEffectiveDate: noon('2026-11-01'), pendingHeadAccessSince: noon('2026-10-25') };
const STATES: [number, IOrgUnitHeadStatus, string[]][] = [
  [1, status(), ['appointHead', 'arrangeCover']],
  [2, status(covered('VACANCY')), ['appointHead', 'endCover']],
  [3, status({ holders: [H] }), ['appointSuccessor', 'arrangeCover', 'vacate']],
  [4, status({ holders: [H], ...covered('ABSENCE') }), ['endCover', 'appointSuccessor', 'vacate']],
  [5, status(successor), ['startNewHeadToday', 'withdrawAppointment']],
  [6, status({ ...successor, ...covered('ABSENCE') }), ['startNewHeadToday', 'withdrawAppointment', 'endCover']],
];

describe('OrgUnitTreeComponent (ACC-120 slice 11, PR C)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<OrgUnitTreeComponent>;
  let http: HttpTestingController;
  let asked: AmConfirmOptions[];
  let permissions: string[];

  function render(
    perms: string[] = ['org:view', 'org:manage', 'users:view', 'setup:view'],
    opts: { lang?: 'en' | 'ar'; nodes?: OrgStructureNodeDto[] } = {},
  ): HTMLElement {
    permissions = perms;
    asked = [];
    TestBed.configureTestingModule({
      imports: [OrgUnitTreeComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: USER, email: 'h@x', name: 'Hessa' }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.lang ?? 'en');
    TestBed.inject(LanguageService).use(opts.lang ?? 'en');
    fixture = TestBed.createComponent(OrgUnitTreeComponent);
    fixture.detectChanges();
    http = TestBed.inject(HttpTestingController);
    const manage = perms.includes('org:manage');
    const structure = http.expectOne((r) => r.url === `${BASE}/structure`);
    expect(structure.request.params.get('includeInactive')).toBe(manage ? 'true' : null);
    structure.flush({ nodes: opts.nodes ?? NODES, asOf: noon('2026-10-20') });
    http.expectOne(`${BASE}/flat`).flush(RECORDS);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no storage in this browser */
    }
  });
  afterEach(() => {
    http?.verify();
    TestBed.resetTestingModule();
  });

  const tree = () => fixture.componentInstance;
  const shownIds = (el: HTMLElement) => Array.from(el.querySelectorAll('tr[data-unit]')).map((r) => r.getAttribute('data-unit'));
  const expandEverything = () => {
    tree().expanded.set(new Set(NODES.map((n) => n.id)));
    fixture.detectChanges();
  };

  // ── the header, the order, no sorting ────────────────────────────────────
  it('counts "6 units · 4 levels" (active only) and keeps the structure order', () => {
    const el = render();
    expect(el.querySelector('[data-testid="tree-count"]')!.textContent!.trim()).toBe('6 units · 4 levels');
    expandEverything();
    expect(shownIds(el)).toEqual(['root', 'med', 'pharm', 'pharm-ip', 'pharm-op', 'lab']);
  });

  it('has no column sort and no aria-sort: a tree is ordered by its structure (OS L531)', () => {
    const el = render();
    expect(el.querySelectorAll('[aria-sort], am-sort-header, .p-sortable-column').length).toBe(0);
  });

  it('the Tree tab is selected; Chart waits for PR E', () => {
    const el = render();
    const tabs = Array.from(el.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent!.trim())).toEqual(['Tree']);
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true');
  });

  // ── the Head cell ────────────────────────────────────────────────────────
  it('the Head cell: the position, "Away · … covering", "+ incoming …", "Acting", and "No head" muted', () => {
    render();
    const cell = (n: OrgStructureNodeDto) => tree().headCell(n);
    expect(cell(NODES[0]!)).toEqual({ name: 'Dr. Saleh Al-Qahtani', meta: 'Director', muted: false });
    expect(cell(NODES[2]!)).toEqual({ name: 'Dr. Fahad Al-Anazi', meta: 'Away · Dr. Huda Zahrani covering', muted: false });
    expect(cell(node('x', null, { heads: [HEAD('a', 'Dr. A'), HEAD('b', 'Dr. B', 'incoming')] })).meta).toBe('+ incoming Dr. B');
    expect(cell(node('x', null, { acting: { ...NODES[2]!.acting!, reason: 'VACANCY' } }))).toEqual({ name: 'Dr. Huda Zahrani', meta: 'Acting', muted: false });
    expect(cell(NODES[3]!)).toEqual({ name: 'No head', meta: '', muted: true });
  });

  it('names withheld (no users:view) read "Head assigned" and "Cover arranged"', () => {
    render();
    expect(tree().headCell(node('x', null, { heads: [HEAD('a', null)] })).name).toBe('Head assigned');
    expect(tree().headCell(node('x', null, { acting: { ...NODES[2]!.acting!, name: null, reason: 'VACANCY' } })).name).toBe('Cover arranged');
  });

  // ── search ───────────────────────────────────────────────────────────────
  it('search "pharm": matches tinted, ancestors kept and dimmed, the count says both', () => {
    const el = render();
    tree().query.set('pharm');
    fixture.detectChanges();
    expect(shownIds(el)).toEqual(['root', 'med', 'pharm', 'pharm-ip', 'pharm-op']);
    expect(el.querySelector('[data-testid="tree-match-count"]')!.textContent!.trim()).toBe('3 units match · shown with 2 ancestors');
    expect(el.querySelector('tr[data-unit="pharm"]')!.classList).toContain('am-ot__row--match');
    expect(el.querySelector('tr[data-unit="med"]')!.classList).toContain('am-ot__row--context');
    expect(el.querySelector('tr[data-unit="med"]')!.classList).not.toContain('am-ot__row--match');
  });

  it('no match: the list says so, and the count reads 0', () => {
    const el = render();
    tree().query.set('nothing here');
    fixture.detectChanges();
    expect(el.textContent).toContain('No units match.');
  });

  // ── the Type filter ──────────────────────────────────────────────────────
  it('the Type filter offers the types units hold, then "(No type)"', () => {
    render();
    expect(tree().typeOptions().map((o) => o.label)).toEqual(['Department', 'Organization', 'Section', '(No type)']);
  });

  it('several types at once, "(No type)" included, ancestors kept', () => {
    const el = render();
    tree().types.set(['t-sec', '__no-type__']);
    fixture.detectChanges();
    expect(shownIds(el)).toEqual(['root', 'med', 'pharm', 'pharm-ip', 'pharm-op', 'lab']);
    expect(el.querySelector('tr[data-unit="lab"]')!.classList).toContain('am-ot__row--match');
    expect(el.querySelector('tr[data-unit="pharm"]')!.classList).toContain('am-ot__row--context');
  });

  // ── Show deactivated ─────────────────────────────────────────────────────
  it('Show deactivated: offered to org:manage, and shows the unit marked "Deactivated" with no menu', () => {
    const el = render();
    expect(el.querySelector('[data-testid="tree-show-inactive"]')).not.toBeNull();
    expandEverything();
    expect(shownIds(el)).not.toContain('pharm-old');
    tree().showInactive.set(true);
    fixture.detectChanges();
    const row = el.querySelector('tr[data-unit="pharm-old"]')!;
    expect(row.querySelector('[data-testid="unit-inactive"]')!.textContent!.trim()).toBe('Deactivated');
    expect(row.querySelector('am-row-menu')).toBeNull();
  });

  it('without org:manage: no Show deactivated, no Add unit, and inactive units are not asked for', () => {
    const el = render(['org:view', 'users:view']);
    expect(el.querySelector('[data-testid="tree-show-inactive"]')).toBeNull();
    expect(el.textContent).not.toContain('Add unit');
  });

  // ── the expand state (D9) ────────────────────────────────────────────────
  it('collapsed to level 2 by default: only the top level is open', () => {
    const el = render();
    expect(shownIds(el)).toEqual(['root', 'med', 'lab']);
  });

  it('the expand state is saved per user and restored on the next visit', () => {
    render();
    tree().onToggle({ data: NODES[1]! }, true);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(['root', 'med']);
    TestBed.resetTestingModule();
    const el = render();
    expect(shownIds(el)).toEqual(['root', 'med', 'pharm', 'lab']);
  });

  it('Expand all opens every parent, saves it, and becomes Collapse all', () => {
    const el = render();
    tree().toggleAll();
    fixture.detectChanges();
    expect(shownIds(el)).toEqual(['root', 'med', 'pharm', 'pharm-ip', 'pharm-op', 'lab']);
    expect(el.querySelector('[data-testid="tree-expand-all"]')!.textContent!.trim()).toBe('Collapse all');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).sort()).toEqual(['med', 'pharm', 'root']);
  });

  it('the page works when storage refuses every read and write', () => {
    const getItem = spyOn(Storage.prototype, 'getItem').and.throwError('denied');
    const setItem = spyOn(Storage.prototype, 'setItem').and.throwError('denied');
    const el = render();
    expect(shownIds(el)).toEqual(['root', 'med', 'lab']);
    expect(() => tree().onToggle({ data: NODES[1]! }, true)).not.toThrow();
    fixture.detectChanges();
    expect(shownIds(el)).toContain('pharm');
    expect(getItem).toHaveBeenCalled();
    expect(setItem).toHaveBeenCalled();
  });

  // ── Attention ─────────────────────────────────────────────────────────────
  it('Attention shows only when the response carries it', () => {
    const withIt = NODES.map((n) => ({ ...n, attention: n.id === 'pharm-ip' ? { code: 'ORG_UNIT_WITHOUT_HEAD' as const, severity: 'AT_RISK' as const, since: noon('2026-09-01'), openCount: 1 } : null }));
    let el = render(undefined, { nodes: withIt });
    expandEverything();
    expect(el.querySelector('th[data-col="attention"]')).not.toBeNull();
    expect(el.querySelector('tr[data-unit="pharm-ip"] [data-testid="attention-chip"]')!.textContent!.trim()).toBe('▲ No head');
    expect(el.querySelectorAll('[data-testid="attention-chip"]').length).toBe(1);
    TestBed.resetTestingModule();
    el = render(); // NODES carry no attention key: a caller without setup:view
    expect(el.querySelector('th[data-col="attention"]')).toBeNull();
  });

  // ── the row menu ─────────────────────────────────────────────────────────
  for (const [n, s, expected] of STATES) {
    it(`state ${n}: the menu's Headship items are exactly the panel's, in its words`, () => {
      render();
      tree().onMenuOpened(NODES[2]!);
      http.expectOne(`${BASE}/pharm/head`).flush(s);
      // am-headship-actions reads the dialogs' choices once hosted.
      fixture.detectChanges();
      http.expectOne((r) => r.url === `${API}/users`).flush({ data: [], total: 0, page: 1, pageSize: 200 });
      http.expectOne(`${API}/org-positions`).flush([{ id: 'pos', nameEn: 'Director', nameAr: null, isUnitHeadPosition: true, isActive: true }]);
      fixture.detectChanges();
      const groups = tree().menuGroups(NODES[2]!);
      expect(groups[0]!.map((i) => i.id)).toEqual(['add', 'edit']);
      expect(groups[1]!.map((i) => i.id)).toEqual(expected.map((a) => `hs:${a}`));
      expect(groups[1]!.map((i) => i.label)).toEqual(expected.map((a) => (en as unknown as { headship: { action: Record<string, string> } }).headship.action[a]!));
      // PR D — Open unit joins Headship details in the View group.
      expect(groups[2]!.map((i) => i.id)).toEqual(['open', 'headship']);
      expect(groups[3]!.map((i) => i.id)).toEqual(['deactivate']);
      expect(tree().menuLabels(NODES[2]!)).toEqual([null, 'Headship', null, null]);
    });
  }

  it('the Headship group says it is loading until the unit\'s headship arrives', () => {
    render();
    expect(tree().menuGroups(NODES[2]!)[1]).toEqual([jasmine.objectContaining({ id: 'hs-loading', disabled: true })]);
    tree().onMenuOpened(NODES[2]!);
    http.expectOne(`${BASE}/pharm/head`).flush('nope', { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${API}/users`).flush({ data: [], total: 0, page: 1, pageSize: 200 });
    http.expectOne(`${API}/org-positions`).flush([]);
    expect(tree().menuGroups(NODES[2]!)[1]).toEqual([jasmine.objectContaining({ id: 'hs-failed', disabled: true })]);
  });

  it('picking a headship item runs it through am-headship-actions: the panel\'s own confirm', () => {
    render();
    tree().onMenuOpened(NODES[2]!);
    http.expectOne(`${BASE}/pharm/head`).flush(status({ holders: [H] }));
    fixture.detectChanges();
    http.expectOne((r) => r.url === `${API}/users`).flush({ data: [], total: 0, page: 1, pageSize: 200 });
    http.expectOne(`${API}/org-positions`).flush([]);
    expect(fixture.debugElement.query((d) => d.componentInstance instanceof HeadshipActionsComponent)).not.toBeNull();
    tree().onPicked(NODES[2]!, 'hs:vacate');
    expect(asked.length).toBe(1);
    expect(asked[0]!.acceptLabel).toBe('Record departure');
    expect(asked[0]!.header).toBe('Record that Dr. Fahad Al-Anazi has left Pharmacy?');
  });

  it('read-only (no org:manage): the menu holds Headship details and nothing else, and reads no headship', () => {
    render(['org:view', 'users:view']);
    expect(tree().menuGroups(NODES[2]!)).toEqual([
      [jasmine.objectContaining({ id: 'open', label: 'Open unit' }), jasmine.objectContaining({ id: 'headship', label: 'Headship details' })],
    ]);
    expect(tree().menuLabels(NODES[2]!)).toEqual([]);
    tree().onMenuOpened(NODES[2]!);
    http.expectNone(`${BASE}/pharm/head`);
    tree().onPicked(NODES[2]!, 'headship');
    expect(tree().headPanelVisible()).toBeTrue();
    expect(tree().headPanelHeader()).toBe('Headship of Pharmacy');
  });

  it('the ⋯ is named for its unit: "Actions for Pharmacy"', () => {
    const el = render();
    expandEverything();
    const trigger = el.querySelector('tr[data-unit="pharm"] [data-testid="row-menu-trigger"]')!;
    expect(trigger.getAttribute('aria-label')).toBe('Actions for Pharmacy');
  });

  // ── Deactivate ───────────────────────────────────────────────────────────
  it('Deactivate asks first, in the drawn words, and sends nothing until accepted', () => {
    render();
    tree().onPicked(NODES[3]!, 'deactivate');
    expect(asked.length).toBe(1);
    expect(asked[0]!.tone).toBe('destructive');
    expect(asked[0]!.header).toBe('Deactivate Inpatient Pharmacy?');
    expect(asked[0]!.message).toBe(
      "It disappears from pickers, the chart and new assignments. Its history stays. This can't be undone here: there's no way to reactivate a unit from AccreditMe yet; it would need support.",
    );
    expect(asked[0]!.acceptLabel).toBe('Deactivate');
    http.expectNone(`${BASE}/pharm-ip/deactivate`);
    asked[0]!.accept();
    http.expectOne(`${BASE}/pharm-ip/deactivate`).flush({});
    http.expectOne((r) => r.url === `${BASE}/structure`).flush({ nodes: NODES, asOf: '' });
    http.expectOne(`${BASE}/flat`).flush(RECORDS);
  });

  it('a coded refusal opens the blockers dialog, each blocker counted and said', () => {
    render();
    tree().onPicked(NODES[2]!, 'deactivate');
    asked[0]!.accept();
    http.expectOne(`${BASE}/pharm/deactivate`).flush(
      {
        statusCode: 409,
        code: 'ORG_UNIT_HAS_DEPENDENCIES',
        message: 'Cannot deactivate org unit — active dependencies exist',
        blockers: [
          { code: 'ACTIVE_CHILDREN', count: 3 },
          { code: 'ACTIVE_USERS', count: 1 },
        ],
      },
      { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(tree().blockersVisible()).toBeTrue();
    expect(tree().blockersUnitName()).toBe('Pharmacy');
    const rows = Array.from(document.querySelectorAll('.p-dialog [data-testid="blocker"]')).map((r) =>
      Array.from(r.children)
        .map((c) => c.textContent!.trim())
        .join(' '),
    );
    expect(rows).toEqual(['3 active sub-units must be deactivated first Show in tree', '1 active person is assigned to this unit Show in Users']);
    expect(document.querySelector('.p-dialog')!.textContent).toContain("Pharmacy can't be deactivated yet");
  });

  it('any other failure is said above the tree, and opens no blockers dialog', () => {
    const el = render();
    tree().onPicked(NODES[2]!, 'deactivate');
    asked[0]!.accept();
    http.expectOne(`${BASE}/pharm/deactivate`).flush({ message: 'Org unit not found' }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(tree().blockersVisible()).toBeFalse();
    expect(el.querySelector('[data-testid="tree-action-error"]')!.textContent).toContain('Org unit not found');
  });

  // ── the unit dialog's titles (kept from ACC-120 slice 11 PR A) ───────────
  it('"Add unit", "Add sub-unit to {parent}" and "Edit {unit}"; Add after Edit forgets the unit', () => {
    render();
    tree().onAdd();
    expect(tree().unitDialogHeader()).toBe('Add unit');
    tree().onPicked(NODES[2]!, 'add');
    expect(tree().unitDialogHeader()).toBe('Add sub-unit to Pharmacy');
    expect(tree().newUnitParentId()).toBe('pharm');
    tree().onPicked(NODES[2]!, 'edit');
    expect(tree().unitDialogHeader()).toBe('Edit Pharmacy');
    tree().onAdd();
    expect(tree().unitDialogHeader()).toBe('Add unit');
  });

  it('in Arabic: names, the head panel title and the dialog title use the Arabic name', () => {
    render(undefined, { lang: 'ar' });
    tree().onPicked(NODES[2]!, 'edit');
    expect(tree().unitDialogHeader()).toContain('الصيدلية');
    tree().onManageHead(NODES[2]!);
    expect(tree().managingHeadUnitName()).toBe('الصيدلية');
    expect(tree().primaryName(NODES[2]!)).toBe('الصيدلية');
    expect(tree().secondaryName(NODES[2]!)).toBe('Pharmacy');
  });

  it('the head panel is titled for the viewer: "Manage Head — …" with org:manage, "Headship of …" without', () => {
    render();
    tree().onManageHead(NODES[2]!);
    expect(tree().headPanelHeader()).toContain('Pharmacy');
    expect(tree().headPanelHeader()).not.toBe('Headship of Pharmacy');
  });
});

// ACC-120 slice 11, PR D — the tree leads to each unit's record: the name is
// the link, the row menu's Open unit goes there, and the record's Show in tree
// (?show=<id>) opens the unit's parents and marks its row.
describe('OrgUnitTreeComponent — links to the record (ACC-120 slice 11, PR D)', () => {
  preserveDocumentLanguage();

  async function render(url: string, perms = ['org:view', 'org:manage', 'users:view']) {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* no storage in this browser */
    }
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'organization', component: OrgUnitTreeComponent },
          { path: 'organization/units/:id', children: [] },
        ]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => perms.includes(p) } },
        { provide: AmConfirmService, useValue: { ask: () => undefined } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: USER, email: 'h@x', name: 'Hessa' }) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use('en');
    const harness = await RouterTestingHarness.create();
    const tree = await harness.navigateByUrl(url, OrgUnitTreeComponent);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne((r) => r.url === `${BASE}/structure`).flush({ nodes: NODES, asOf: noon('2026-10-20') });
    http.expectOne(`${BASE}/flat`).flush(RECORDS);
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { tree, harness, el: harness.routeNativeElement as HTMLElement, http };
  }

  afterEach(() => TestBed.resetTestingModule());

  it('each unit’s name is the link to its record', async () => {
    const { el } = await render('/organization');
    const name = el.querySelector<HTMLAnchorElement>('tr[data-unit="root"] a[data-testid="unit-name"]')!;
    expect(name).not.toBeNull();
    expect(name.getAttribute('href')).toBe('/organization/units/root');
  });

  it('Open unit goes to the record', async () => {
    const { tree } = await render('/organization');
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    expect(tree.menuGroups(NODES[0]!)[2]!.map((i) => i.label)).toEqual(['Open unit', 'Headship details']);
    tree.onPicked(NODES[0]!, 'open');
    expect(navigate).toHaveBeenCalledWith(['/organization/units', 'root']);
  });

  it('?show=<id> opens the unit’s parents, marks its row, and leaves the parameter behind', async () => {
    const { el, harness } = await render('/organization?show=pharm-ip');
    harness.detectChanges();
    const shown = Array.from(el.querySelectorAll('tr[data-unit]')).map((r) => r.getAttribute('data-unit'));
    expect(shown).toContain('pharm-ip');
    expect(el.querySelector('tr[data-unit="pharm-ip"]')!.classList).toContain('am-ot__row--sought');
    expect(el.querySelectorAll('.am-ot__row--sought').length).toBe(1);
    await harness.fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/organization');
  });

  it('without ?show, nothing is marked', async () => {
    const { el } = await render('/organization');
    expect(el.querySelectorAll('.am-ot__row--sought').length).toBe(0);
  });
});
