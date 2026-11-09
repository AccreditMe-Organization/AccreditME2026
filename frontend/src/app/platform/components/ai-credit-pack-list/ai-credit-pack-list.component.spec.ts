import { ComponentFixture, TestBed, fakeAsync, flush, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { IAiCreditPack, PlanService } from '../../services/plan.service';
import { AiCreditPackListComponent } from './ai-credit-pack-list.component';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

// ACC-120 — Platform → AI credit packs on the shared list (searched by name,
// sorted by credits, fewest first, by default), and its Add dialog on the
// dialog rules: Save is never disabled; on an empty form it shows the errors
// and sends nothing.

const pack = (id: string, name: string, credits: number, price: string, nameAr: string | null = null): IAiCreditPack => ({
  id,
  name,
  nameAr,
  credits,
  price,
  isActive: true,
  availableTo: [],
  sortOrder: 0,
});

const PACKS = [pack('p-2', 'Large', 5000, '450'), pack('p-1', 'Small', 500, '49.9', 'صغيرة'), pack('p-3', 'Medium', 1500, '140')];

describe('AiCreditPackListComponent (ACC-120)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<AiCreditPackListComponent>;
  let create: jasmine.Spy;

  beforeEach(() => {
    for (const key of Object.keys(localStorage)) if (/platform/i.test(key)) localStorage.removeItem(key);
  });
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((n) => n.remove()));

  function render(language: 'en' | 'ar' = 'en'): HTMLElement {
    create = jasmine.createSpy('create').and.returnValue(of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AiCreditPackListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PlanService, useValue: { listAiCreditPacks: () => of(PACKS), createAiCreditPack: create } },
        { provide: NavigationAccessService, useValue: { isPlatformAdmin: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(AiCreditPackListComponent);
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const cells = (el: HTMLElement, testId: string) => Array.from(el.querySelectorAll(`[data-testid="${testId}"]`)).map((c) => c.textContent!.trim());
  const search = (el: HTMLElement, value: string) => {
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    tick(500);
    fixture.detectChanges();
  };
  const openAdd = () => {
    fixture.componentInstance.openAdd();
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
  };
  const errors = () =>
    Array.from(document.querySelectorAll('[data-testid="pack-form"] .am-field__message--error')).map((e) => e.textContent!.trim());

  it('opens sorted by credits, fewest first, with that header marked ascending', fakeAsync(() => {
    const el = render();
    expect(cells(el, 'pack-name')).toEqual(['Small', 'Medium', 'Large']);
    expect(cells(el, 'pack-credits')).toEqual(['500', '1,500', '5,000']);
    expect(cells(el, 'pack-price')).toEqual(['49.9', '140', '450']);
    const sorted = el.querySelector('am-sort-header[aria-sort]');
    expect(sorted?.getAttribute('aria-sort')).toBe('ascending');
    expect(sorted?.textContent).toContain('Credits');
  }));

  it('searches the English and the Arabic name', fakeAsync(() => {
    const el = render();
    search(el, 'med');
    expect(cells(el, 'pack-name')).toEqual(['Medium']);
    search(el, 'صغ');
    expect(cells(el, 'pack-name')).toEqual(['Small']);
  }));

  it('Save on an empty form shows the errors and sends nothing', fakeAsync(() => {
    render();
    openAdd();
    fixture.componentInstance.form.patchValue({ name: '', credits: null, price: '' });
    fixture.detectChanges();
    const save = document.querySelector<HTMLButtonElement>('[data-testid="pack-save"] button')!;
    expect(save.disabled).withContext('Save is never disabled').toBeFalse();
    save.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(errors()).toEqual(['This field is required.', 'This field is required.', 'This field is required.']);
    expect(create).not.toHaveBeenCalled();
    flush();
  }));

  it('in Arabic too', fakeAsync(() => {
    render('ar');
    openAdd();
    fixture.componentInstance.form.patchValue({ name: '' });
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-testid="pack-save"] button')!.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
    expect(errors()).toEqual([ar.validation.required]);
    expect(create).not.toHaveBeenCalled();
    flush();
  }));

  it('a valid form sends exactly what it sent before', fakeAsync(() => {
    render();
    openAdd();
    fixture.componentInstance.form.patchValue({ name: 'Starter pack', credits: 250, price: '19.5' });
    fixture.detectChanges();
    document.querySelector<HTMLButtonElement>('[data-testid="pack-save"] button')!.click();
    fixture.detectChanges();
    tick(500);
    expect(create).toHaveBeenCalledOnceWith({ name: 'Starter pack', credits: 250, price: '19.5' });
    flush();
  }));
});
