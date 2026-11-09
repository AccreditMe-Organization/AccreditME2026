import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { PlanListComponent } from './plan-list.component';
import { IPlan, PlanService } from '../../services/plan.service';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

// ACC-263 — the plan list shows each plan's Full users and Staff limits, or
// Unlimited where the limit is null. ACC-120 — on the shared list: searched by
// name, sorted by column header (monthly price, lowest first, by default).

function plan(id: string, maxFullUsers: number | null, maxStaff: number | null, monthlyPrice = '0', nameAr = id): IPlan {
  return {
    id,
    name: id.toUpperCase(),
    nameEn: id,
    nameAr,
    monthlyPrice,
    annualPrice: '0',
    maxFullUsers,
    maxStaff,
    maxStorageGb: 10,
    aiCreditsPerMonth: 0,
    isActive: true,
    isPublic: true,
    sortOrder: 0,
  };
}

let fixtureRef: { detectChanges(): void } | null = null;

function render(plans: IPlan[], language: 'en' | 'ar' = 'en'): HTMLElement {
  for (const key of Object.keys(localStorage)) if (/platform/i.test(key)) localStorage.removeItem(key);
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [PlanListComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({ lang: 'en' }),
      provideFormatTesting(),
      { provide: PlanService, useValue: { listPlans: () => of(plans) } },
      { provide: NavigationAccessService, useValue: { isPlatformAdmin: () => true } },
    ],
  });
  loadTranslationsForTest({ en, ar });
  TestBed.inject(TranslateService).use(language);
  const fixture = TestBed.createComponent(PlanListComponent);
  fixtureRef = fixture;
  fixture.detectChanges();
  tick(500);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const cells = (el: HTMLElement, testId: string) =>
  Array.from(el.querySelectorAll(`[data-testid="${testId}"]`)).map((c) => (c.textContent ?? '').trim());

function search(el: HTMLElement, value: string): void {
  const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  tick(500);
  fixtureRef!.detectChanges();
}

describe('PlanListComponent — seat limits (ACC-263)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  const PLANS = [plan('starter', 15, 250), plan('professional', 60, 1500), plan('enterprise', null, null)];

  it('heads the two columns', fakeAsync(() => {
    const el = render(PLANS);
    const heads = Array.from(el.querySelectorAll('[role="columnheader"]')).map((t) => (t.textContent ?? '').trim());
    expect(heads).toContain('Full users');
    expect(heads).toContain('Staff');
  }));

  it('shows a number, or Unlimited for null', fakeAsync(() => {
    const el = render(PLANS);
    expect(cells(el, 'plan-max-full-users')).toEqual(['15', '60', 'Unlimited']);
    expect(cells(el, 'plan-max-staff')).toEqual(['250', '1,500', 'Unlimited']);
  }));

  it('in Arabic, Unlimited is translated and digits stay Latin', fakeAsync(() => {
    const el = render(PLANS, 'ar');
    expect(cells(el, 'plan-max-full-users')).toEqual(['15', '60', 'غير محدود']);
    expect(cells(el, 'plan-max-staff')[1]).toMatch(/^1[,٬]500$/);
    expect(cells(el, 'plan-max-staff')[2]).toBe('غير محدود');
  }));

  // ACC-264 — the Edit button names the plan it opens.
  it('each Edit names its plan, in both languages', fakeAsync(() => {
    const names = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="plan-edit"] button, [data-testid="plan-edit"] a')).map((b) => b.getAttribute('aria-label'));
    expect(names(render(PLANS))).toEqual(['Edit starter', 'Edit professional', 'Edit enterprise']);
    expect(names(render(PLANS, 'ar'))).toEqual(['تعديل starter', 'تعديل professional', 'تعديل enterprise']);
  }));

  it('with no plans, says so', fakeAsync(() => {
    const el = render([]);
    expect(el.textContent).toContain('No plans defined yet.');
  }));
});

describe('PlanListComponent — the shared list (ACC-120)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  const PLANS = [
    plan('professional', 60, 1500, '1200', 'احترافية'),
    plan('enterprise', null, null, '4800.50', 'مؤسسات'),
    plan('starter', 15, 250, '300', 'أساسية'),
  ];

  it('opens sorted by monthly price, lowest first, with that header marked ascending', fakeAsync(() => {
    const el = render(PLANS);
    expect(cells(el, 'plan-name')).toEqual(['starter', 'professional', 'enterprise']);
    const sorted = el.querySelector('am-sort-header[aria-sort]');
    expect(sorted?.getAttribute('aria-sort')).toBe('ascending');
    expect(sorted?.textContent).toContain('Monthly Price');
  }));

  it('shows prices through the formatting layer', fakeAsync(() => {
    const el = render(PLANS);
    expect(cells(el, 'plan-monthly-price')).toEqual(['300', '1,200', '4,800.5']);
  }));

  it('searches the English and the Arabic name', fakeAsync(() => {
    const el = render(PLANS);
    search(el, 'prof');
    expect(cells(el, 'plan-name')).toEqual(['professional']);
    search(el, 'أساس');
    expect(cells(el, 'plan-name')).toEqual(['starter']);
  }));

  it('in Arabic, shows each plan by its Arabic name', fakeAsync(() => {
    const el = render(PLANS, 'ar');
    expect(cells(el, 'plan-name')).toEqual(['أساسية', 'احترافية', 'مؤسسات']);
  }));
});
