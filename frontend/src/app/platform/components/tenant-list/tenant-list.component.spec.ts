import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { IPlatformTenantSummary, PlatformTenantService } from '../../services/platform-tenant.service';
import { TenantListComponent } from './tenant-list.component';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

// ACC-120 — Platform → Tenants on the shared list: read once, searched (name,
// slug, plan), sorted by column header (name A to Z by default), and Suspend /
// Reactivate in the row's ⋯ menu.

const tenant = (id: string, name: string, slug: string, status: IPlatformTenantSummary['status'], planName: string | null): IPlatformTenantSummary => ({
  id,
  name,
  slug,
  status,
  planId: planName ? `plan-${planName}` : null,
  planName,
  createdAt: '2026-10-01T05:00:00.000Z',
});

const TENANTS = [
  tenant('t-3', 'Riyadh Care', 'riyadh-care', 'TRIAL', 'Starter'),
  tenant('t-1', 'Al-Nakheel Hospital', 'al-nakheel', 'ACTIVE', 'Professional'),
  tenant('t-2', 'Manara Clinics', 'al-manara', 'SUSPENDED', null),
];

describe('TenantListComponent (ACC-120)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<TenantListComponent>;
  let suspend: jasmine.Spy;
  let reactivate: jasmine.Spy;
  let ask: jasmine.Spy;

  beforeEach(() => {
    for (const key of Object.keys(localStorage)) if (/platform/i.test(key)) localStorage.removeItem(key);
  });
  afterEach(() => document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove()));

  function render(language: 'en' | 'ar' = 'en'): HTMLElement {
    suspend = jasmine.createSpy('suspend').and.returnValue(of(undefined));
    reactivate = jasmine.createSpy('reactivate').and.returnValue(of(undefined));
    ask = jasmine.createSpy('ask');
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TenantListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PlatformTenantService, useValue: { listTenants: () => of(TENANTS), suspendTenant: suspend, reactivateTenant: reactivate } },
        { provide: NavigationAccessService, useValue: { isPlatformAdmin: () => true } },
        { provide: AmConfirmService, useValue: { ask } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(TenantListComponent);
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const names = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="tenant-name"]')).map((a) => a.textContent!.trim());
  const search = (el: HTMLElement, value: string) => {
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    tick(500);
    fixture.detectChanges();
  };
  const openMenu = (el: HTMLElement, id: string): string[] => {
    el.querySelector<HTMLButtonElement>(`[data-tenant-row="${id}"] [data-testid="row-menu-trigger"]`)!.click();
    fixture.detectChanges();
    return Array.from(document.querySelectorAll('[data-testid="row-menu"] [data-action]')).map((b) => b.getAttribute('data-action')!);
  };

  it('opens sorted by name, A to Z, with the Name header marked ascending', fakeAsync(() => {
    const el = render();
    expect(names(el)).toEqual(['Al-Nakheel Hospital', 'Manara Clinics', 'Riyadh Care']);
    const sorted = el.querySelector('am-sort-header[aria-sort]');
    expect(sorted?.getAttribute('aria-sort')).toBe('ascending');
    expect(sorted?.textContent).toContain('Organization Name');
  }));

  it('searches the name, the slug and the plan', fakeAsync(() => {
    const el = render();
    search(el, 'riyadh');
    expect(names(el)).toEqual(['Riyadh Care']);
    search(el, 'al-manara');
    expect(names(el)).toEqual(['Manara Clinics']);
    search(el, 'professional');
    expect(names(el)).toEqual(['Al-Nakheel Hospital']);
  }));

  it('each name links to its tenant', fakeAsync(() => {
    const el = render();
    expect(el.querySelector('[data-tenant-row="t-1"] [data-testid="tenant-name"]')!.getAttribute('href')).toBe('/platform/tenants/t-1');
  }));

  it('the ⋯ menu offers Suspend for an active tenant, and Suspend asks first', fakeAsync(() => {
    const el = render();
    expect(openMenu(el, 't-1')).toEqual(['suspend']);
    document.querySelector<HTMLButtonElement>('[data-testid="row-menu"] [data-action="suspend"]')!.click();
    fixture.detectChanges();
    expect(ask).toHaveBeenCalledTimes(1);
    expect(suspend).not.toHaveBeenCalled();
  }));

  it('the ⋯ menu offers Reactivate for a suspended tenant', fakeAsync(() => {
    const el = render();
    expect(openMenu(el, 't-2')).toEqual(['reactivate']);
    document.querySelector<HTMLButtonElement>('[data-testid="row-menu"] [data-action="reactivate"]')!.click();
    fixture.detectChanges();
    expect(reactivate).toHaveBeenCalledOnceWith('t-2');
  }));

  it('names the menu after its tenant', fakeAsync(() => {
    const el = render();
    expect(el.querySelector('[data-tenant-row="t-1"] [data-testid="row-menu-trigger"]')!.getAttribute('aria-label')).toBe('Actions for Al-Nakheel Hospital');
  }));

  it('in Arabic, the page is titled «المنشآت»', fakeAsync(() => {
    const el = render('ar');
    expect(el.querySelector('app-page-header h1')?.textContent?.trim()).toBe('المنشآت');
  }));
});
