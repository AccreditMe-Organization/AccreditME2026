import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { BreadcrumbParentService } from '../../../../core/navigation/breadcrumb-parent.service';
import { AmConfirmOptions, AmConfirmService } from '../../../../shared/components/confirm/am-confirm.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import {
  OrgStructureNodeDto,
  OrgUnitDto,
  OrgUnitHistoryEntryDto,
  OrgUnitHistoryPageDto,
  OrgUnitPersonDto,
  OrgUnitService,
  OrgUnitSummaryDto,
} from '../../services/org-unit.service';
import { HeadshipPanelComponent } from '../headship-panel/headship-panel.component';
import { OrgUnitRecordComponent } from './org-unit-record.component';
import { UnitListPanelComponent } from './unit-list-panel.component';

// ACC-120 slice 11, PR D — the org unit record, /organization/units/:id, as each
// viewer sees it: the header and its relations, the Setup health strip only
// while a condition is open, each panel's empty state, names withheld (D7),
// and the deactivated state. The Headship panel has its own spec; here a stub
// in its place records what the page hands it.

@Component({ selector: 'am-headship-panel', standalone: true, template: '<div data-testid="headship-stub"></div>' })
class HeadshipStubComponent {
  readonly orgUnitId = input.required<string>();
  readonly unitName = input.required<string>();
  readonly readOnly = input(false);
}

@Component({ standalone: true, template: '' })
class BlankComponent {}

const DEPT = { id: 't-dept', key: 'department', labelEn: 'Department', labelAr: 'قسم', isRetired: false };
const SECTION = { id: 't-sec', key: 'section', labelEn: 'Section', labelAr: 'قسم فرعي', isRetired: false };

function node(id: string, over: Partial<OrgStructureNodeDto> = {}): OrgStructureNodeDto {
  return {
    id,
    parentId: 'pharm',
    nameEn: id,
    nameAr: null,
    code: id.toUpperCase(),
    type: SECTION,
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

const person = (userId: string, name: string | null, position: string | null, isHead = false): OrgUnitPersonDto => ({
  userId,
  name,
  positionId: position ? `pos-${position}` : null,
  positionNameEn: position,
  positionNameAr: null,
  isHead,
});

function summary(over: Partial<OrgUnitSummaryDto> = {}, unit: Partial<OrgUnitSummaryDto['unit']> = {}): OrgUnitSummaryDto {
  return {
    unit: {
      ...node('pharm', {
        parentId: 'med',
        nameEn: 'Pharmacy',
        nameAr: 'الصيدلية',
        code: 'PHARM',
        type: DEPT,
        childCount: 2,
        heads: [{ userId: 'fahad', name: 'Dr. Fahad Al-Anazi', positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: 'مدير', role: 'substantive', countedHere: true }],
        acting: { userId: 'huda', name: 'Dr. Huda Zahrani', reason: 'ABSENCE', validFrom: '2026-09-25T12:00:00.000Z', validTo: null, countedHere: true },
        headcount: 3,
        committees: { count: 1 },
        attention: null,
      }),
      description: null,
      createdAt: '2025-01-10T09:00:00.000Z',
      updatedAt: '2026-10-01T09:00:00.000Z',
      ...unit,
    },
    path: [
      { id: 'root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' },
      { id: 'med', nameEn: 'Medical Services', nameAr: 'الخدمات الطبية' },
      { id: 'pharm', nameEn: 'Pharmacy', nameAr: 'الصيدلية' },
    ],
    children: [
      node('pharm-ip', { nameEn: 'Inpatient Pharmacy', headcount: 8 }),
      node('pharm-op', { nameEn: 'Outpatient Pharmacy', headcount: 5, heads: [{ userId: 'omar', name: 'Dr. Omar Haddad', positionId: 'p', positionNameEn: 'Head', positionNameAr: null, role: 'substantive', countedHere: true }] }),
    ],
    positions: [{ positionId: 'pos-dir', nameEn: 'Director', nameAr: 'مدير', grade: 10, isUnitHeadPosition: true, count: 1 }],
    people: [person('fahad', 'Dr. Fahad Al-Anazi', 'Director', true), person('salem', 'Salem Al-Dosari', 'Pharmacist'), person('mona', 'Mona Fathy', 'Technician')],
    committees: { count: 1, items: [{ id: 'cm-pt', nameEn: 'Pharmacy & Therapeutics', nameAr: null, stageNameEn: 'Active', stageNameAr: 'نشطة' }] },
    asOf: '2026-10-21T09:00:00.000Z',
    ...over,
  };
}

const actor = (name: string | null, inOrganization = true) => ({ userId: 'nora', name, inOrganization, positionNameEn: 'Quality Director', positionNameAr: null });
const HISTORY: OrgUnitHistoryEntryDto[] = [
  { id: 'head:e1', source: 'HEAD_EVENT', kind: 'ACTING_ASSIGNED', at: '2026-09-25T09:00:00.000Z', effectiveDate: '2026-09-25T09:00:00.000Z', actor: actor('Nora Al-Otaibi'), subject: { userId: 'huda', name: 'Dr. Huda Zahrani', inOrganization: true, positionNameEn: 'Clinical Pharmacist', positionNameAr: null }, position: null },
  { id: 'audit:a1', source: 'AUDIT', kind: 'CHANGED', at: '2025-03-02T09:00:00.000Z', actor: actor('Omar Bakri'), fields: ['parent'], movedTo: { id: 'med', nameEn: 'Medical Services', nameAr: null } },
];
const page = (items: OrgUnitHistoryEntryDto[] = HISTORY, over: Partial<OrgUnitHistoryPageDto> = {}): OrgUnitHistoryPageDto => ({ items, total: items.length, skip: 0, take: 5, ...over });

const ALL = ['admin:access', 'org:view', 'org:manage', 'users:view', 'committees:view', 'setup:view'];

describe('OrgUnitRecordComponent (ACC-120 slice 11, PR D)', () => {
  preserveDocumentLanguage();

  let permissions: string[];
  let summaryResult: Observable<OrgUnitSummaryDto>;
  let historyResult: Observable<OrgUnitHistoryPageDto>;
  let getById: jasmine.Spy;
  let asked: AmConfirmOptions[];

  async function render(
    opts: { perms?: string[]; summary?: OrgUnitSummaryDto; summaryError?: number; history?: OrgUnitHistoryPageDto; lang?: 'en' | 'ar'; url?: string } = {},
  ) {
    permissions = opts.perms ?? ALL;
    summaryResult = opts.summaryError
      ? throwError(() => new HttpErrorResponse({ status: opts.summaryError }))
      : of(opts.summary ?? summary());
    historyResult = of(opts.history ?? page());
    asked = [];
    getById = jasmine.createSpy('getById').and.returnValue(of({ id: 'pharm', nameEn: 'Pharmacy' } as OrgUnitDto));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'organization/units/:id', component: OrgUnitRecordComponent },
          { path: '**', component: BlankComponent },
        ]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: AmConfirmService, useValue: { ask: (o: AmConfirmOptions) => asked.push(o) } },
        {
          provide: OrgUnitService,
          useValue: {
            getSummary: () => summaryResult,
            getHistory: () => historyResult,
            getById,
            getFlat: () => of([]),
            deactivate: () => of({}),
          },
        },
      ],
    });
    TestBed.overrideComponent(OrgUnitRecordComponent, { remove: { imports: [HeadshipPanelComponent] }, add: { imports: [HeadshipStubComponent] } });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.lang ?? 'en');
    TestBed.inject(LanguageService).use(opts.lang ?? 'en');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(opts.url ?? '/organization/units/pharm', OrgUnitRecordComponent);
    harness.detectChanges();
    return { el: harness.routeNativeElement as HTMLElement, harness };
  }

  afterEach(() => TestBed.resetTestingModule());

  // Each text node, joined by a space: Angular drops the whitespace between
  // elements, so textContent would run "Medical Services" into "2 Mar 2025".
  const text = (el: Element | null): string => {
    if (!el) return '';
    const parts: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.textContent ?? '');
    // The isolates around a name in a sentence are invisible; one test below
    // pins that they are there.
    return parts.join(' ').replace(/[\u2068\u2069]/g, '').replace(/\s+/g, ' ').trim();
  };
  const q = (el: HTMLElement, id: string) => el.querySelector(`[data-testid="${id}"]`);
  const panel = (el: HTMLElement, prefix: string) => el.querySelector(`[data-testid="${prefix}-panel"]`);
  const rows = (el: HTMLElement, prefix: string) => Array.from(panel(el, prefix)?.querySelectorAll('li.am-cp-row') ?? []).map(text);

  // ── the header ────────────────────────────────────────────────────────────
  it('the header: both names, "Department · PHARM · active", and Parent unit · Head · Acting head', async () => {
    const { el } = await render();
    expect(text(q(el, 'unit-name'))).toBe('Pharmacy');
    expect(text(q(el, 'unit-other-name'))).toBe('الصيدلية');
    expect(q(el, 'unit-other-name')!.getAttribute('dir')).toBe('rtl');
    expect(text(q(el, 'unit-meta'))).toBe('Department · PHARM · active');
    expect(text(q(el, 'relation-parent'))).toBe('Parent unit ▦ Medical Services');
    expect(q(el, 'relation-parent')!.querySelector('a')!.getAttribute('href')).toBe('/organization/units/med');
    expect(text(q(el, 'relation-head'))).toBe('Head ◉ Dr. Fahad Al-Anazi · Director');
    expect(q(el, 'relation-head')!.querySelector('a')!.getAttribute('href')).toBe('/users/fahad');
    expect(text(q(el, 'relation-acting'))).toBe('Acting head ◉ Dr. Huda Zahrani · no end date');
    expect(q(el, 'unit-edit')).not.toBeNull();
    expect(q(el, 'unit-add-child')).not.toBeNull();
  });

  it('the breadcrumb is the unit’s parents, top first; the tab names the unit', async () => {
    await render();
    expect(TestBed.inject(BreadcrumbParentService).current()).toEqual({
      forPath: '/organization/units/pharm',
      url: '/organization/units/med',
      text: 'Medical Services',
      above: [{ url: '/organization/units/root', text: 'Al Nakheel Specialist Hospital' }],
    });
  });

  it('the top unit: "None — this is the top unit", no head, no acting head', async () => {
    const { el } = await render({
      summary: summary({ path: [{ id: 'pharm', nameEn: 'Pharmacy', nameAr: null }] }, { parentId: null, heads: [], acting: null }),
    });
    expect(text(q(el, 'relation-parent'))).toBe('Parent unit None — this is the top unit');
    expect(text(q(el, 'relation-head'))).toBe('Head No head');
    expect(q(el, 'relation-acting')).toBeNull();
    expect(TestBed.inject(BreadcrumbParentService).current()).toBeNull();
  });

  it('read-only (no org:manage): no Edit, no Add sub-unit, no ⋯', async () => {
    const { el } = await render({ perms: ['org:view', 'users:view', 'admin:access'] });
    expect(q(el, 'unit-actions')).toBeNull();
    expect(q(el, 'unit-subs-add')).toBeNull();
  });

  // ── the Setup health strip ───────────────────────────────────────────────
  it('no strip while nothing is open, or without setup:view (attention absent)', async () => {
    const first = await render();
    expect(q(first.el, 'unit-strip')).toBeNull();
    TestBed.resetTestingModule();
    const s = summary();
    delete (s.unit as Partial<OrgUnitSummaryDto['unit']>).attention;
    const second = await render({ summary: s });
    expect(q(second.el, 'unit-strip')).toBeNull();
  });

  it('the strip: the highest condition, its date, Fix in Headship, and "+ 1 more" to Setup health for this unit', async () => {
    const { el, harness } = await render({
      summary: summary({}, { attention: { code: 'ACTING_HEAD_OPEN_ENDED', severity: 'AT_RISK', since: '2026-12-24T12:00:00.000Z', openCount: 2 } }),
    });
    expect(text(q(el, 'unit-strip-since'))).toBe('▲ At risk from 24 Dec 2026');
    expect(text(q(el, 'unit-strip'))).toContain('Acting head with no end date');
    expect(text(q(el, 'unit-strip-fix'))).toBe('Fix in Headship');
    const more = q(el, 'unit-strip-more') as HTMLAnchorElement;
    expect(text(more)).toBe('+ 1 more');
    expect(more.getAttribute('href')).toBe('/setup-health?object=pharm');
    expect(q(el, 'unit-strip')!.classList).not.toContain('am-ur__strip--blocks');
    harness.detectChanges();
  });

  it('one condition: no "+ more"; no type: Set type opens Edit; blocks work is marked', async () => {
    const { el, harness } = await render({
      summary: summary({}, { attention: { code: 'ORG_UNIT_WITHOUT_TYPE', severity: 'BLOCKS_WORK', since: '2026-09-15T12:00:00.000Z', openCount: 1 } }),
    });
    expect(q(el, 'unit-strip-more')).toBeNull();
    expect(q(el, 'unit-strip')!.classList).toContain('am-ur__strip--blocks');
    (q(el, 'unit-strip-fix') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(getById).toHaveBeenCalledWith('pharm');
  });

  it('a viewer who can’t fix it sees the strip with no Fix', async () => {
    const { el } = await render({
      perms: ['org:view', 'setup:view'],
      summary: summary({}, { attention: { code: 'ORG_UNIT_WITHOUT_HEAD', severity: 'AT_RISK', since: '2026-09-01T12:00:00.000Z', openCount: 1 } }),
    });
    expect(q(el, 'unit-strip')).not.toBeNull();
    expect(q(el, 'unit-strip-fix')).toBeNull();
  });

  // ── the panels ────────────────────────────────────────────────────────────
  it('the panels in the drawn order, each list capped in am-capped-panel', async () => {
    const { el } = await render();
    const order = Array.from(q(el, 'unit-panels')!.children).map((c) => c.getAttribute('data-testid') ?? c.querySelector('[data-testid$="-panel"]')?.getAttribute('data-testid') ?? c.tagName.toLowerCase());
    expect(order).toEqual(['am-headship-panel', 'unit-subs-panel', 'unit-people-panel', 'unit-positions-panel', 'unit-committees-panel', 'unit-history-panel']);
    expect(rows(el, 'unit-subs')).toEqual(['Inpatient Pharmacy 8 people Section · No head', 'Outpatient Pharmacy 5 people Section · Dr. Omar Haddad']);
    expect(panel(el, 'unit-subs')!.querySelector('li a')!.getAttribute('href')).toBe('/organization/units/pharm-ip');
    expect(rows(el, 'unit-people')[0]).toBe('Dr. Fahad Al-Anazi Director · head');
    expect(rows(el, 'unit-positions')).toEqual(['Director 1 person confers headship']);
    expect(rows(el, 'unit-committees')).toEqual(['Pharmacy & Therapeutics Active']);
    expect(rows(el, 'unit-history')).toEqual([
      'Dr. Huda Zahrani set as acting head 25 Sep 2026 · Nora Al-Otaibi',
      'Parent changed to Medical Services 2 Mar 2025 · Omar Bakri',
    ]);
    expect((q(el, 'unit-show-in-tree') as HTMLAnchorElement).getAttribute('href')).toBe('/organization?show=pharm');
  });

  const headship = (harness: RouterTestingHarness) =>
    harness.fixture.debugElement.query((d) => d.componentInstance instanceof HeadshipStubComponent)!.componentInstance as HeadshipStubComponent;

  it('the Headship panel is embedded for this unit, with its actions', async () => {
    const { el, harness } = await render();
    expect(headship(harness).orgUnitId()).toBe('pharm');
    expect(headship(harness).unitName()).toBe('Pharmacy');
    expect(headship(harness).readOnly()).toBe(false);
    expect(el.querySelector('am-headship-panel')!.getAttribute('id')).toBe('unit-headship');
  });

  it('every panel has a truthful empty state; Positions is absent with no people', async () => {
    const { el } = await render({
      summary: summary({ children: [], people: [], positions: [], committees: { count: 0, items: [] } }, { headcount: 0, childCount: 0 }),
      history: page([]),
    });
    expect(text(q(el, 'unit-subs-empty'))).toBe('No sub-units');
    expect(q(el, 'unit-subs-add')).not.toBeNull();
    expect(text(q(el, 'unit-people-empty'))).toBe('No one has Pharmacy as their unit');
    expect(text(q(el, 'unit-people-users'))).toBe('Users');
    expect(panel(el, 'unit-positions')).toBeNull();
    expect(text(q(el, 'unit-committees-empty'))).toBe('This unit owns no committees');
    expect(text(q(el, 'unit-history-empty'))).toBe('No changes recorded');
  });

  it('committees without committees:view: the count, no names, no See all', async () => {
    const { el } = await render({
      perms: ['org:view', 'users:view', 'admin:access'],
      summary: summary({ committees: { count: 3, items: null } }),
    });
    expect(text(q(el, 'unit-committees-count'))).toBe('3');
    expect(text(q(el, 'unit-committees-empty'))).toBe('Committee names need permission to view committees.');
    expect(q(el, 'unit-committees-foot')).toBeNull();
  });

  it('more than five: the first five and "Showing 5 of 7 · See all"', async () => {
    const children = Array.from({ length: 7 }, (_, i) => node(`c${i}`, { nameEn: `Child ${i}` }));
    const { el } = await render({ summary: summary({ children }) });
    expect(rows(el, 'unit-subs').length).toBe(5);
    expect(text(q(el, 'unit-subs-foot'))).toBe('Showing 5 of 7 · See all');
  });

  it('above ten people, grouped by position: heads first, then each position together', async () => {
    const people = [
      person('a', 'Zaid', 'Pharmacist'),
      person('b', 'Amal', 'Technician'),
      person('c', 'Basma', 'Pharmacist'),
      person('h', 'Yara', 'Director', true),
      ...Array.from({ length: 8 }, (_, i) => person(`t${i}`, `Tech ${i}`, 'Technician')),
    ];
    const { el } = await render({ summary: summary({ people }) });
    expect(rows(el, 'unit-people')).toEqual([
      'Yara Director · head',
      'Basma Pharmacist',
      'Zaid Pharmacist',
      'Amal Technician',
      'Tech 0 Technician',
    ]);
  });

  it('ten or fewer people keep the server’s order (by name)', async () => {
    const { el } = await render();
    expect(rows(el, 'unit-people').map((r) => r.split(' ')[0])).toEqual(['Dr.', 'Salem', 'Mona']);
  });

  it('See all searches and sorts in memory', async () => {
    const { harness } = await render();
    const panelCmp = harness.fixture.debugElement.query((d) => d.componentInstance instanceof UnitListPanelComponent)!.componentInstance as UnitListPanelComponent;
    let got: string[] = [];
    panelCmp.loadPage({ q: 'outp', sort: 'name', dir: 'asc', take: 50, skip: 0 }).subscribe((p) => (got = p.items.map((i) => i.primary)));
    expect(got).toEqual(['Outpatient Pharmacy']);
    panelCmp.loadPage({ sort: 'people', dir: 'desc', take: 50, skip: 0 }).subscribe((p) => (got = p.items.map((i) => i.primary)));
    expect(got).toEqual(['Inpatient Pharmacy', 'Outpatient Pharmacy']);
  });

  // ── names withheld (D7) ───────────────────────────────────────────────────
  it('without users:view: the position and "Name hidden", never a blank, and no person link', async () => {
    const hidden = summary(
      { people: [person('fahad', null, 'Director', true), person('x', null, null)] },
      {
        heads: [{ userId: 'fahad', name: null, positionId: 'pos-dir', positionNameEn: 'Director', positionNameAr: 'مدير', role: 'substantive', countedHere: true }],
        acting: { userId: 'huda', name: null, reason: 'ABSENCE', validFrom: '2026-09-25T12:00:00.000Z', validTo: '2026-11-30T12:00:00.000Z', countedHere: true },
      },
    );
    const history = page([{ ...HISTORY[0]!, actor: actor(null), subject: { userId: 'huda', name: null, inOrganization: true, positionNameEn: 'Clinical Pharmacist', positionNameAr: null } } as OrgUnitHistoryEntryDto]);
    const { el } = await render({ perms: ['org:view'], summary: hidden, history });
    expect(text(q(el, 'relation-head'))).toBe('Head ◉ Director · Name hidden');
    expect(q(el, 'relation-head')!.querySelector('a')).toBeNull();
    expect(q(el, 'relation-head')!.querySelector('.am-rel__value--hidden')).not.toBeNull();
    expect(text(q(el, 'relation-acting'))).toBe('Acting head ◉ Cover arranged · Name hidden · until 30 Nov 2026');
    expect(rows(el, 'unit-people')).toEqual(['Name hidden Director · head', 'Name hidden No position']);
    expect(rows(el, 'unit-history')).toEqual(['Clinical Pharmacist (name hidden) set as acting head 25 Sep 2026 · Quality Director (name hidden)']);
  });

  it('a name in a sentence is isolated (FSI … PDI), so it keeps its own direction in Arabic', async () => {
    const { el } = await render({
      lang: 'ar',
      summary: summary({}, { isActive: false }),
      history: page(HISTORY, { deactivation: { at: '2026-06-03T09:00:00.000Z', actor: actor('Nora Al-Otaibi') } }),
    });
    expect(q(el, 'unit-deactivated')!.textContent).toContain('\u2068Nora Al-Otaibi\u2069');
    expect(panel(el, 'unit-history')!.textContent).toContain('\u2068Dr. Huda Zahrani\u2069');
  });

  it('an actor from outside the organisation is said so, not "name hidden"', async () => {
    const { el } = await render({ history: page([{ ...HISTORY[1]!, actor: actor(null, false) } as OrgUnitHistoryEntryDto]) });
    expect(rows(el, 'unit-history')).toEqual(['Parent changed to Medical Services 2 Mar 2025 · someone outside this organization']);
  });

  // ── the deactivated state ────────────────────────────────────────────────
  it('deactivated: when and by whom, no actions, and the one line about reactivation', async () => {
    const { el, harness } = await render({
      summary: summary({}, { isActive: false }),
      history: page(HISTORY, { deactivation: { at: '2026-06-03T09:00:00.000Z', actor: actor('Nora Al-Otaibi') } }),
    });
    expect(text(q(el, 'unit-meta'))).toBe('Department · PHARM · deactivated');
    expect(text(q(el, 'unit-deactivated'))).toBe("Deactivated 3 Jun 2026 by Nora Al-Otaibi Deactivated units can't be reactivated from AccreditMe.");
    expect(q(el, 'unit-actions')).toBeNull();
    expect(q(el, 'unit-subs-add')).toBeNull();
    expect(q(el, 'unit-strip-fix')).toBeNull();
    expect(headship(harness).readOnly()).toBe(true);
  });

  it('deactivated with no recorded row: "no date recorded", never a guessed date', async () => {
    const { el } = await render({ summary: summary({}, { isActive: false }), history: page([], { deactivation: null }) });
    expect(text(q(el, 'unit-deactivated'))).toContain('Deactivated · no date recorded');
  });

  // ── loading the unit ─────────────────────────────────────────────────────
  it('a unit that is not there (or another organisation’s): the not-found message, nothing else', async () => {
    const { el } = await render({ summaryError: 404 });
    expect(q(el, 'unit-not-found')).not.toBeNull();
    expect(q(el, 'unit-header')).toBeNull();
  });

  it('another failure: the error, with Retry', async () => {
    const { el } = await render({ summaryError: 500 });
    expect(q(el, 'unit-load-error')).not.toBeNull();
    expect(q(el, 'unit-not-found')).toBeNull();
  });

  it('Setup health’s Set type Fix (?edit=1) opens Edit once the unit has loaded', async () => {
    await render({ url: '/organization/units/pharm?edit=1' });
    expect(getById).toHaveBeenCalledWith('pharm');
  });

  it('Arabic: the Arabic name leads, the English one follows in its own direction', async () => {
    const { el } = await render({ lang: 'ar' });
    expect(text(q(el, 'unit-name'))).toBe('الصيدلية');
    expect(text(q(el, 'unit-other-name'))).toBe('Pharmacy');
    expect(q(el, 'unit-other-name')!.getAttribute('dir')).toBe('ltr');
    expect(text(q(el, 'unit-meta'))).toBe('قسم · PHARM · نشطة');
  });
});
