import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { TenantDetailComponent } from './tenant-detail.component';
import { IPlatformTenantDetail, PlatformTenantService } from '../../services/platform-tenant.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';

// ACC-221 — the platform tenant page names the account owner, and moves it to
// another active Organization Administrator, after a confirm.
const LAYLA = { id: 'u-owner', name: 'Layla Al-Harbi', email: 'layla@acme.test' };
const OMAR = { id: 'u-two', name: 'Omar Siddiqui', email: 'omar@acme.test' };

function detail(over: Partial<IPlatformTenantDetail> = {}): IPlatformTenantDetail {
  return {
    id: 't1', name: 'Acme', slug: 'acme', status: 'ACTIVE', planId: null, planName: null, createdAt: '2026-10-01T00:00:00.000Z',
    userCount: 4, modules: {},
    ai: { enabled: true, monthlyCredits: 0, creditsUsed: 0, creditsRemaining: 0, resetDate: null, overageEnabled: false, pendingMonthlyCredits: null, periodStart: null, features: [] } as unknown as IPlatformTenantDetail['ai'],
    tenantAdmins: [{ ...LAYLA, isOwner: true }, { ...OMAR, isOwner: false }],
    owner: LAYLA,
    ...over,
  };
}

describe('TenantDetailComponent — the account owner (ACC-221)', () => {
  let fixture: ComponentFixture<TenantDetailComponent>;
  let service: jasmine.SpyObj<PlatformTenantService>;
  let confirm: jasmine.Spy<(c: Confirmation) => ConfirmationService>;

  function render(first: IPlatformTenantDetail, lang: 'en' | 'ar' = 'en'): HTMLElement {
    service = jasmine.createSpyObj<PlatformTenantService>('PlatformTenantService', [
      'getTenantDetail',
      'transferOwnership',
      'updateTenantModules',
      'allocateAiCredits',
      'startImpersonation',
    ]);
    service.getTenantDetail.and.returnValue(of(first));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [TenantDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: PlatformTenantService, useValue: service },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 't1' }) } } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    confirm = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    fixture = TestBed.createComponent(TenantDetailComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  const text = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  it('names the owner, and offers the other active administrators', () => {
    const el = render(detail());
    expect(text(el.querySelector('[data-tenant-owner]'))).toBe('Account owner: Layla Al-Harbi · layla@acme.test');
    expect(fixture.componentInstance.transferCandidates().map((c) => c.id)).toEqual(['u-two']);
    expect(el.querySelector('[data-action="transferOwnership"]')).not.toBeNull();
  });

  it('says "No account owner recorded" when none is', () => {
    const el = render(detail({ owner: null, tenantAdmins: [{ ...OMAR, isOwner: false }] }));
    expect(text(el.querySelector('[data-tenant-owner]'))).toBe('No account owner recorded');
  });

  it('with no other administrator, says what to do instead of offering the action', () => {
    const el = render(detail({ tenantAdmins: [{ ...LAYLA, isOwner: true }] }));
    expect(el.querySelector('[data-action="transferOwnership"]')).toBeNull();
    expect(text(el.querySelector('[data-tenant-transfer-none]'))).toBe('Give someone else Organization Administrator first.');
  });

  it('asks first; confirming transfers to the chosen administrator, then refreshes', () => {
    render(detail());
    service.transferOwnership.and.returnValue(of(void 0));
    fixture.componentInstance.transferTo.set('u-two');
    fixture.componentInstance.confirmTransfer('t1');

    expect(confirm).toHaveBeenCalledTimes(1);
    const asked = confirm.calls.mostRecent().args[0];
    expect(asked.header).toBe('Transfer ownership to Omar Siddiqui?');
    expect(asked.message).toBe("Ownership, and the protection that comes with it, moves to Omar Siddiqui. Layla Al-Harbi's roles stay as they are.");
    expect(service.transferOwnership).not.toHaveBeenCalled();

    asked.accept!();
    expect(service.transferOwnership).toHaveBeenCalledWith('t1', 'u-two');
    expect(service.getTenantDetail).toHaveBeenCalledTimes(2);
  });

  it('says OWNER_MUST_BE_ACTIVE_ADMINISTRATOR from its code', () => {
    const el = render(detail());
    service.transferOwnership.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'OWNER_MUST_BE_ACTIVE_ADMINISTRATOR', message: 'server text' } })),
    );
    fixture.componentInstance.transferTo.set('u-two');
    fixture.componentInstance.confirmTransfer('t1');
    confirm.calls.mostRecent().args[0].accept!();
    fixture.detectChanges();
    expect(el.textContent).toContain('The new account owner must be an active Organization Administrator of this organization.');
    expect(el.textContent).not.toContain('server text');
  });

  it('Arabic: «مالك الحساب» and «نقل الملكية»', () => {
    const el = render(detail(), 'ar');
    expect(text(el.querySelector('[data-tenant-owner]'))).toBe('مالك الحساب: Layla Al-Harbi · layla@acme.test');
    expect(text(el.querySelector('[data-action="transferOwnership"]'))).toBe('نقل الملكية');
  });
});
