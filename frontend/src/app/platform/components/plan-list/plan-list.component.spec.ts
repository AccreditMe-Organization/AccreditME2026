import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { PlanListComponent } from './plan-list.component';
import { IPlan, PlanService } from '../../services/plan.service';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';

// ACC-263 — the plan list shows each plan's Full users and Staff limits, or
// Unlimited where the limit is null.

function plan(id: string, maxFullUsers: number | null, maxStaff: number | null): IPlan {
  return {
    id,
    name: id.toUpperCase(),
    nameEn: id,
    nameAr: id,
    monthlyPrice: '0',
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

async function render(plans: IPlan[], language: 'en' | 'ar' = 'en') {
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
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const cells = (el: HTMLElement, testId: string) =>
  Array.from(el.querySelectorAll(`[data-testid="${testId}"]`)).map((c) => (c.textContent ?? '').trim());

describe('PlanListComponent — seat limits (ACC-263)', () => {
  const PLANS = [plan('starter', 15, 250), plan('professional', 60, 1500), plan('enterprise', null, null)];

  it('heads the two columns', async () => {
    const el = await render(PLANS);
    const heads = Array.from(el.querySelectorAll('th')).map((t) => (t.textContent ?? '').trim());
    expect(heads).toContain('Full users');
    expect(heads).toContain('Staff');
  });

  it('shows a number, or Unlimited for null', async () => {
    const el = await render(PLANS);
    expect(cells(el, 'plan-max-full-users')).toEqual(['15', '60', 'Unlimited']);
    expect(cells(el, 'plan-max-staff')).toEqual(['250', '1,500', 'Unlimited']);
  });

  it('in Arabic, Unlimited is translated and digits stay Latin', async () => {
    const el = await render(PLANS, 'ar');
    expect(cells(el, 'plan-max-full-users')).toEqual(['15', '60', 'غير محدود']);
    expect(cells(el, 'plan-max-staff')[1]).toMatch(/^1[,٬]500$/);
    expect(cells(el, 'plan-max-staff')[2]).toBe('غير محدود');
  });

  // ACC-264 — the pencil names the plan it opens.
  it('each edit button names its plan, in both languages', async () => {
    const names = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="plan-edit"] button, [data-testid="plan-edit"] a')).map((b) => b.getAttribute('aria-label'));
    expect(names(await render(PLANS))).toEqual(['Edit starter', 'Edit professional', 'Edit enterprise']);
    expect(names(await render(PLANS, 'ar'))).toEqual(['تعديل starter', 'تعديل professional', 'تعديل enterprise']);
  });

  it('the empty row still spans every column', async () => {
    const el = await render([]);
    expect(el.querySelector('td[colspan]')?.getAttribute('colspan')).toBe(String(el.querySelectorAll('th').length));
  });
});
