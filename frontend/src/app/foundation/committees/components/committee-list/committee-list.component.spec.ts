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
    currentStageKey: 'active',
    isDissolving: false,
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
  }),
  committee('c', { nameEn: 'Ethics', nameAr: 'الأخلاقيات', isDissolving: true, memberCount: 5 }),
  committee('d', { nameEn: 'Board', nameAr: 'المجلس', isActive: false, isDissolving: true, typeValueId: 'type-missing' }),
];

describe('CommitteeListComponent (ACC-120 slice 4)', () => {
  let fixture: ComponentFixture<CommitteeListComponent>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let permissions: string[];

  // The Arabic case switches <html> to rtl; put it back for the specs after.
  preserveDocumentLanguage();

  function setup(perms: string[], rows: CommitteeListItemDto[] = ROWS, lang: 'en' | 'ar' = 'en'): void {
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

  it('status: active reads plain, a committee being dissolved and an inactive one say so', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    expect(cells('status')).toEqual(['Inactive', 'Being dissolved', 'Active', 'Active']);
    expect(committeeListStatus({ isActive: true, isDissolving: false })).toBe('ACTIVE');
    expect(committeeListStatus({ isActive: true, isDissolving: true })).toBe('DISSOLVING');
    expect(committeeListStatus({ isActive: false, isDissolving: true })).toBe('INACTIVE');
    expect(committeeListStatus({ isActive: false, isDissolving: false })).toBe('INACTIVE');
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
    expect(await ids({ status: 'ACTIVE' })).toEqual(['a', 'b']);
    expect(await ids({ status: 'DISSOLVING' })).toEqual(['c']);
    expect(await ids({ status: 'INACTIVE' })).toEqual(['d']);
    expect(await ids({ typeValueId: 'type-safety' })).toEqual(['b']);
    expect(await ids({ status: 'ACTIVE', typeValueId: 'type-quality' })).toEqual(['a']);
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
    // The add form reads its own lookups as it always has.
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

  it('a row opens its committee', fakeAsync(() => {
    setup(['committees:view']);
    flush();
    fixture.detectChanges();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    el.querySelector<HTMLElement>('[data-cell="name"]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/committees', 'd']);
  }));
});
