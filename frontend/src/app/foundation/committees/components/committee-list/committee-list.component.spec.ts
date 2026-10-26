import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { environment } from '../../../../../environments/environment';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { CommitteeListItemDto } from '../../services/committee.service';
import { CommitteeListComponent, committeeListStatus } from './committee-list.component';
import { ACTIVE_RULES, DISSOLVED_RULES, SEEDED_STAGE_RULES, tenantStageRules } from '../../testing';
import { NO_STAGE_RULES } from '../../committee-offers';

const DISSOLUTION_PENDING_RULES = SEEDED_STAGE_RULES[4]!.rules;

// ACC-120 slice 4 — the committees list (plan: step-120-4-committees-list.md).
// Six columns from GET /committees; search over both names; sort by name, type,
// stage or members; filter by status or type; both empties; Add committee only
// with committees:create.

const API = `${environment.apiUrl}`;

function committee(id: string, over: Partial<CommitteeListItemDto> = {}): CommitteeListItemDto {
  return {
    id,
    organizationId: 'org-1',
    nameEn: `Committee ${id}`,
    nameAr: `لجنة ${id}`,
    typeValueId: 'type-quality',
    purpose: null,
    quorumCount: 3,
    meetingFrequency: 'MONTHLY',
    parentCommitteeId: null,
    orgUnitId: 'unit-1',
    termsOfReferenceDocumentId: null,
    reportingToCommitteeId: null,
    formedAt: null,
    dissolvedAt: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    memberCount: 4,
    currentStageNameEn: 'Active',
    currentStageNameAr: 'نشطة',
    stageRules: ACTIVE_RULES,
    isDissolving: false,
    typeValue: null,
    ...over,
  };
}

const TYPES = [
  { id: 'type-quality', labelEn: 'Quality', labelAr: 'الجودة' },
  { id: 'type-safety', labelEn: 'Safety', labelAr: 'السلامة' },
];

const ROWS = [
  committee('a', { nameEn: 'Pharmacy and Therapeutics', nameAr: 'الصيدلة والعلاجات', memberCount: 7 }),
  committee('b', {
    nameEn: 'Infection Control',
    nameAr: null,
    typeValueId: 'type-safety',
    parentCommitteeId: 'a',
    memberCount: 2,
    currentStageNameEn: null,
    currentStageNameAr: null,
    stageRules: NO_STAGE_RULES,
  }),
  committee('c', { nameEn: 'Ethics', nameAr: 'الأخلاقيات', isDissolving: true, memberCount: 5, stageRules: DISSOLUTION_PENDING_RULES }),
  committee('d', {
    nameEn: 'Board',
    nameAr: 'المجلس',
    isActive: false,
    isDissolving: true,
    typeValueId: 'type-missing',
    stageRules: DISSOLVED_RULES,
  }),
];

describe('CommitteeListComponent (ACC-120 slice 4)', () => {
  let fixture: ComponentFixture<CommitteeListComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let permissions: string[];

  // The Arabic case switches <html> to rtl; put it back for the specs after.
  preserveDocumentLanguage();

  function setup(perms: string[], rows: CommitteeListItemDto[] = ROWS, lang: 'en' | 'ar' = 'en', phone = false): void {
    permissions = perms;
    TestBed.configureTestingModule({
      imports: [CommitteeListComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CommitteeListComponent);
    // The test window is narrower than a desktop, so the layout is chosen
    // here rather than left to the window: wide unless a case asks for phone.
    fixture.componentInstance.phone.set(phone);
    el = fixture.nativeElement;
    fixture.detectChanges();
    http.expectOne(`${API}/lookups/categories/committee_type/values`).flush(TYPES);
    fixture.detectChanges();
    http.expectOne(`${API}/committees`).flush(rows);
    fixture.detectChanges();
  }

  const cells = (name: string): string[] =>
    Array.from(el.querySelectorAll<HTMLElement>(`[data-cell="${name}"]`)).map((c) => c.textContent!.trim());

  beforeEach(() => {
    try {
      localStorage.clear();
    } catch {
      /* no storage in this browser: nothing to clear */
    }
  });

  afterEach(() => http.verify());

  it('draws one row per committee, sorted A–Z by default, with every column filled from the list', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    // Non-vacuity first: rows exist before anything about them is asserted.
    expect(cells('name').length).withContext('rows rendered').toBe(4);
    expect(cells('name')).toEqual(['Board', 'Ethics', 'Infection Control', 'Pharmacy and Therapeutics']);
    expect(cells('parent')).toEqual(['—', '—', 'Pharmacy and Therapeutics', '—']);
    expect(cells('stage')).toEqual(['Active', 'Active', '—', 'Active']);
    expect(cells('members')).toEqual(['4', '5', '2', '7']);
  }));

  it('a type the lookup does not have reads "—", never its id', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    expect(cells('type')).toEqual(['—', 'Quality', 'Safety', 'Quality']);
    expect(el.textContent).not.toContain('type-missing');
  }));

  it('status: in force reads plain, the other three say what they are', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    expect(cells('status')).toEqual(['Inactive', 'Being dissolved', 'Not yet in force', 'In force']);
    // In force is the normal case and draws no chip; the other three are muted chips, none with the attention dot.
    const chipped = Array.from(el.querySelectorAll<HTMLElement>('[data-cell="status"]')).map((c) => !!c.querySelector('.inline-flex'));
    expect(chipped).toEqual([true, true, true, false]);
    expect(el.querySelectorAll('[data-cell="status"] .rounded-full').length).withContext('no attention dot').toBe(0);
  }));

  it('a stage a tenant renamed or added reads by its flags, never its name', fakeAsync(() => {
    setup(['committees:view'], [
      // Named "Active", but configured with no meaning: not in force.
      committee('p', { nameEn: 'P', currentStageNameEn: 'Active', currentStageNameAr: 'نشطة', stageRules: tenantStageRules([], []) }),
      // A tenant's own name for an in-force stage.
      committee('q', {
        nameEn: 'Q',
        currentStageNameEn: 'Approved and running',
        currentStageNameAr: 'معتمدة وجارية',
        stageRules: tenantStageRules(['add_member'], ['IN_FORCE']),
      }),
      // A renamed winding-down stage.
      committee('r', { nameEn: 'R', currentStageNameEn: 'Closing', currentStageNameAr: 'قيد الإغلاق', stageRules: tenantStageRules([], ['DISSOLVING']) }),
    ]);
    flush();
    fixture.detectChanges();
    expect(cells('name')).withContext('rows rendered').toEqual(['P', 'Q', 'R']);
    expect(cells('stage')).toEqual(['Active', 'Approved and running', 'Closing']);
    expect(cells('status')).toEqual(['Not yet in force', 'In force', 'Being dissolved']);
  }));

  it('says the four statuses in Arabic', fakeAsync(() => {
    setup(['committees:view'], [...ROWS, committee('e', { nameEn: 'Audit', nameAr: 'التدقيق', stageRules: SEEDED_STAGE_RULES[0]!.rules })], 'ar');
    flush();
    fixture.detectChanges();
    expect(cells('status').sort()).toEqual(['سارية', 'غير سارية بعد', 'غير سارية بعد', 'غير نشطة', 'قيد الحل'].sort());
    expect(el.textContent).not.toContain('committee.status');
    // The Status filter offers the same four, in lifecycle order.
    expect(fixture.componentInstance.statusOptions()).toEqual([
      { value: 'NOT_YET_IN_FORCE', label: 'غير سارية بعد' },
      { value: 'IN_FORCE', label: 'سارية' },
      { value: 'DISSOLVING', label: 'قيد الحل' },
      { value: 'INACTIVE', label: 'غير نشطة' },
    ]);
  }));

  it('search reads both names: the Arabic name finds a committee in an English session', async () => {
    setup(['committees:view']);
    const page = await firstValueFrom(fixture.componentInstance.source({ search: 'الأخلاق' }));
    expect(page.data.map((c) => c.id)).toEqual(['c']);
    const english = await firstValueFrom(fixture.componentInstance.source({ search: 'infection' }));
    expect(english.data.map((c) => c.id)).toEqual(['b']);
  });

  it('filters by status and by type, and the two combine', async () => {
    setup(['committees:view']);
    const src = fixture.componentInstance.source;
    const ids = async (filters: Record<string, string | null>) =>
      (await firstValueFrom(src({ filters }))).data.map((c) => c.id).sort();
    expect(await ids({ status: 'IN_FORCE' })).toEqual(['a']);
    expect(await ids({ status: 'NOT_YET_IN_FORCE' })).toEqual(['b']);
    expect(await ids({ status: 'DISSOLVING' })).toEqual(['c']);
    expect(await ids({ status: 'INACTIVE' })).toEqual(['d']);
    expect(await ids({ typeValueId: 'type-safety' })).toEqual(['b']);
    expect(await ids({ status: 'IN_FORCE', typeValueId: 'type-quality' })).toEqual(['a']);
    expect(await ids({ status: 'NOT_YET_IN_FORCE', typeValueId: 'type-quality' })).toEqual([]);
    expect(await ids({ status: null, typeValueId: null })).toEqual(['a', 'b', 'c', 'd']);
  });

  it('the filter controls drive the list: choosing a status narrows the rows on screen', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    expect(cells('name').length).toBe(4);
    fixture.componentInstance.list().setFilter('status', 'DISSOLVING');
    // amListRow decides the first row's tab stop from the DOM after the rows
    // render (the shared directive's own behaviour), so the pass that swaps the
    // rows runs without the no-changes check and the next one runs with it.
    fixture.detectChanges(false);
    tick(400);
    fixture.detectChanges(false);
    fixture.detectChanges();
    expect(cells('name')).toEqual(['Ethics']);
  }));

  it('sorts by members, by type and by stage; a committee with no stage is last both ways', async () => {
    setup(['committees:view']);
    const src = fixture.componentInstance.source;
    const ids = async (sortBy: string, sortDir: 'asc' | 'desc') =>
      (await firstValueFrom(src({ sortBy, sortDir }))).data.map((c) => c.id);
    expect(await ids('members', 'asc')).toEqual(['b', 'd', 'c', 'a']);
    expect(await ids('members', 'desc')).toEqual(['a', 'c', 'd', 'b']);
    // Type by its label: "—" (missing), Quality ×2, Safety.
    expect((await ids('type', 'desc'))[0]).toBe('b');
    expect((await ids('stage', 'asc')).at(-1)).toBe('b');
    expect((await ids('stage', 'desc')).at(-1)).toBe('b');
  });

  it('in Arabic the name sorts by the Arabic name, and one with none is last both ways (ACC-160)', async () => {
    setup(['committees:view'], ROWS, 'ar');
    const src = fixture.componentInstance.source;
    const asc = (await firstValueFrom(src({}))).data.map((c) => c.id);
    expect(asc.at(-1)).withContext('default sort, Arabic session').toBe('b');
    const desc = (await firstValueFrom(src({ sortBy: 'nameAr', sortDir: 'desc' }))).data.map((c) => c.id);
    expect(desc.at(-1)).toBe('b');
    expect(fixture.componentInstance.columns()[0].sortBy).toBe('nameAr');
  });

  it('Add Committee is shown only with committees:create, and opens the existing form', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Add Committee');
    TestBed.resetTestingModule();

    setup(['committees:view', 'committees:create']);
    flush();
    fixture.detectChanges();
    const add = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.includes('Add Committee'));
    expect(add).withContext('Add Committee rendered').toBeDefined();
    add!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.formVisible()).toBeTrue();
    // The add form reads its own lists: types and units in one read (ACC-255,
    // plan §10.5), the committees in another.
    http.expectOne(`${API}/committees/form-choices`).flush({ committeeTypes: [], orgUnits: [] });
    // …never the lookup or unit lists, which need lookups:view and org:view
    // that a tenant-made committee editor may not hold.
    http.expectNone(`${API}/lookups/categories/committee_type/values`);
    http.expectNone(`${API}/organization/units/flat`);
    http.match(() => true).forEach((r) => r.flush([]));
  }));

  it('nothing at all: "No committees yet", with a line pointing to Add Committee only for a creator', fakeAsync(() => {
    setup(['committees:view'], []);
    flush();
    fixture.detectChanges();
    expect(el.textContent).toContain('No committees yet');
    expect(el.textContent).not.toContain('Add the first one');
    TestBed.resetTestingModule();

    setup(['committees:view', 'committees:create'], []);
    flush();
    fixture.detectChanges();
    expect(el.textContent).toContain('No committees yet');
    expect(el.textContent).toContain('Add the first one with Add Committee.');
  }));

  it('on a phone: one name column carrying type, stage and a status that is not In force, the count, and the filters above', fakeAsync(() => {
    setup(['committees:view'], ROWS, 'en', true);
    flush();
    fixture.detectChanges();
    const c = fixture.componentInstance;
    expect(c.columns().map((col) => col.key)).toEqual(['name', 'members']);
    expect(cells('name').length).withContext('rows rendered').toBe(4);
    for (const wide of ['type', 'parent', 'stage', 'status']) {
      expect(cells(wide).length).withContext(`no ${wide} cell on a phone`).toBe(0);
    }
    expect(cells('meta')).toEqual([
      '— · Active · Inactive',
      'Quality · Active · Being dissolved',
      'Safety · — · Not yet in force',
      'Quality · Active',
    ]);
    expect(cells('members')).toEqual(['4', '5', '2', '7']);
    const phoneFilters = el.querySelector('[data-testid="committee-filters-phone"]');
    expect(phoneFilters?.querySelectorAll('app-overlay-select').length).withContext('both filters above the list').toBe(2);
    expect(el.querySelector('app-data-list [data-filter]')).withContext('none left in the toolbar').toBeNull();
  }));

  it('a row opens its committee', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    el.querySelector<HTMLElement>('[data-cell="name"]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/committees', 'd']);
  }));

  // ACC-234 — the list sorts by its column headers, through am-sort-header.
  describe('sort by column header (ACC-234)', () => {
    const headerRow = () => el.querySelector<HTMLElement>('app-data-list [role="row"]')!;
    const sortHeader = (key: string) => headerRow().querySelector<HTMLElement>(`am-sort-header[data-sort-key="${key}"]`)!;
    function press(key: string): void {
      sortHeader(key).querySelector('button')!.click();
      flush();
      fixture.detectChanges();
    }

    it('Name, Type, Stage and Members are headers named "Sort by …"; Parent and Status stay text', fakeAsync(() => {
      setup(['committees:view']);
      flush();
      fixture.detectChanges();
      expect(headerRow()).withContext('the header row is laid out').not.toBeNull();
      expect(Array.from(headerRow().querySelectorAll('am-sort-header')).map((h) => h.getAttribute('data-sort-key'))).toEqual(['name', 'type', 'stage', 'members']);
      expect(Array.from(headerRow().querySelectorAll('am-sort-header button')).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Sort by Name',
        'Sort by Type',
        'Sort by Stage',
        'Sort by Members',
      ]);
      const plain = Array.from(headerRow().querySelectorAll<HTMLElement>(':scope > span[role="columnheader"]')).map((s) => s.textContent!.trim());
      expect(plain).toEqual(['Parent', 'Status']);
      expect(headerRow().querySelectorAll('.pi-arrow-up, .pi-arrow-down').length).withContext('the old inline arrows are gone').toBe(0);
    }));

    it('each press sorts on the same field, ascending then descending; aria-sort and ▲/▼ follow', fakeAsync(() => {
      setup(['committees:view']);
      flush();
      fixture.detectChanges();
      press('members');
      expect(cells('members')).toEqual(['2', '4', '5', '7']);
      expect(sortHeader('members').getAttribute('aria-sort')).toBe('ascending');
      expect(sortHeader('members').textContent).toContain('▲');
      expect(headerRow().querySelectorAll('[aria-sort]').length).withContext('only the sorted column').toBe(1);
      press('members');
      expect(cells('members')).toEqual(['7', '5', '4', '2']);
      expect(sortHeader('members').getAttribute('aria-sort')).toBe('descending');
      expect(sortHeader('members').textContent).toContain('▼');
      press('name');
      expect(cells('name')).toEqual(['Board', 'Ethics', 'Infection Control', 'Pharmacy and Therapeutics']);
      expect(sortHeader('name').getAttribute('aria-sort')).toBe('ascending');
      expect(sortHeader('members').hasAttribute('aria-sort')).toBeFalse();
      press('name');
      expect(cells('name')).toEqual(['Pharmacy and Therapeutics', 'Infection Control', 'Ethics', 'Board']);
      expect(sortHeader('name').getAttribute('aria-sort')).toBe('descending');
      // The same fields as before: the header sends the column's own sortBy.
      expect(fixture.componentInstance.columns().filter((c) => c.sortBy).map((c) => c.sortBy)).toEqual(['nameEn', 'type', 'stage', 'members']);
    }));

    it('Arabic: the accessible name is translated and the arrow follows the label', fakeAsync(() => {
      setup(['committees:view'], ROWS, 'ar');
      flush();
      fixture.detectChanges();
      press('members');
      const button = sortHeader('members').querySelector('button')!;
      expect(button.getAttribute('aria-label')).toBe('ترتيب حسب الأعضاء');
      expect(Array.from(button.children).map((c) => c.textContent!.trim())).toEqual(['الأعضاء', '▲']);
    }));
  });
});

// ACC-256 — the status rule itself, a pure function: kept out of the rendered
// describe above, whose afterEach verifies an HTTP backend this needs none of.
describe('committeeListStatus (ACC-256)', () => {
  it('each seeded stage reads its status from its flags', () => {
    const statuses = SEEDED_STAGE_RULES.map(({ stage, rules }) => [stage, committeeListStatus({ isActive: true, stageRules: rules })]);
    expect(statuses).toEqual([
      ['Formation', 'NOT_YET_IN_FORCE'],
      ['Terms Review', 'NOT_YET_IN_FORCE'],
      ['Active', 'IN_FORCE'],
      ['Suspended', 'IN_FORCE'],
      ['Dissolution Pending', 'DISSOLVING'],
      ['Dissolved', 'DISSOLVING'],
    ]);
    // A dissolved committee's record is inactive, and that is what it reads as.
    expect(committeeListStatus({ isActive: false, stageRules: DISSOLVED_RULES })).toBe('INACTIVE');
    expect(committeeListStatus({ isActive: false, stageRules: ACTIVE_RULES })).toBe('INACTIVE');
    // No live stage (D14): nothing is in force yet.
    expect(committeeListStatus({ isActive: true, stageRules: NO_STAGE_RULES })).toBe('NOT_YET_IN_FORCE');
  });
});
