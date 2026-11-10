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
import { IAiFeatureCost, PlanService } from '../../services/plan.service';
import { AiFeatureCostListComponent } from './ai-feature-cost-list.component';
import { preserveDocumentLanguage } from '../../../../testing/document-language';

// ACC-264 — each row's Edit names the feature it edits, so a screen reader
// hears "Edit document_summary" rather than the same button per row.
// ACC-120 — on the shared list (searched by feature key, sorted by it A to Z by
// default), and the dialog on the dialog rules: Save is never disabled; on an
// empty form it shows the error and sends nothing.

const COSTS: IAiFeatureCost[] = [
  { id: 'c-1', featureKey: 'task_description_drafting', creditCost: 2, description: null },
  { id: 'c-2', featureKey: 'document_summary', creditCost: 15, description: null },
  { id: 'c-3', featureKey: 'morning_briefing', creditCost: 5, description: 'Home briefing' },
];

describe('AiFeatureCostListComponent (ACC-264, ACC-120)', () => {
  // First, so it runs last: the Arabic tests switch the document's language.
  preserveDocumentLanguage();

  let fixture: ComponentFixture<AiFeatureCostListComponent>;
  let upsert: jasmine.Spy;

  beforeEach(() => {
    for (const key of Object.keys(localStorage)) if (/platform/i.test(key)) localStorage.removeItem(key);
  });
  afterEach(() => document.querySelectorAll('.p-dialog-mask, .cdk-overlay-container').forEach((n) => n.remove()));

  function render(language: 'en' | 'ar' = 'en'): HTMLElement {
    upsert = jasmine.createSpy('upsert').and.returnValue(of({}));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AiFeatureCostListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: PlanService, useValue: { listAiFeatureCosts: () => of(COSTS), upsertAiFeatureCost: upsert } },
        { provide: NavigationAccessService, useValue: { isPlatformAdmin: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    fixture = TestBed.createComponent(AiFeatureCostListComponent);
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const keys = (el: HTMLElement) => Array.from(el.querySelectorAll('[data-testid="cost-key"]')).map((c) => c.textContent!.trim());
  const names = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-testid="feature-cost-edit"] button')).map((b) => b.getAttribute('aria-label'));
  const errors = () =>
    Array.from(document.querySelectorAll('[data-testid="cost-form"] .am-field__message--error')).map((e) => e.textContent!.trim());
  const pressSave = () => {
    document.querySelector<HTMLButtonElement>('[data-testid="cost-save"] button')!.click();
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  };
  const open = (edit?: IAiFeatureCost) => {
    if (edit) fixture.componentInstance.openEdit(edit);
    else fixture.componentInstance.openAdd();
    fixture.detectChanges();
    tick(500);
    fixture.detectChanges();
  };

  it('opens sorted by feature key, A to Z, with that header marked ascending', fakeAsync(() => {
    const el = render();
    expect(keys(el)).toEqual(['document_summary', 'morning_briefing', 'task_description_drafting']);
    const sorted = el.querySelector('am-sort-header[aria-sort]');
    expect(sorted?.getAttribute('aria-sort')).toBe('ascending');
    expect(sorted?.textContent).toContain('Feature Key');
  }));

  it('searches the feature key', fakeAsync(() => {
    const el = render();
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    input.value = 'brief';
    input.dispatchEvent(new Event('input'));
    tick(500);
    fixture.detectChanges();
    expect(keys(el)).toEqual(['morning_briefing']);
  }));

  it('each Edit names its feature', fakeAsync(() => {
    expect(names(render())).toEqual(['Edit document_summary', 'Edit morning_briefing', 'Edit task_description_drafting']);
  }));

  it('in Arabic too', fakeAsync(() => {
    expect(names(render('ar'))).toEqual(['تعديل document_summary', 'تعديل morning_briefing', 'تعديل task_description_drafting']);
  }));

  it('Save on an empty form shows the errors and sends nothing', fakeAsync(() => {
    render();
    open();
    fixture.componentInstance.form.patchValue({ featureKey: '', creditCost: null });
    fixture.detectChanges();
    const save = document.querySelector<HTMLButtonElement>('[data-testid="cost-save"] button')!;
    expect(save.disabled).withContext('Save is never disabled').toBeFalse();
    pressSave();
    expect(errors()).toEqual(['This field is required.', 'This field is required.']);
    expect(upsert).not.toHaveBeenCalled();
    flush();
  }));

  it('in Arabic, Save on an empty form shows the error', fakeAsync(() => {
    render('ar');
    open();
    pressSave();
    expect(errors()).toEqual([ar.validation.required]);
    expect(upsert).not.toHaveBeenCalled();
    flush();
  }));

  it('editing sends exactly what it sent before, and the header names the feature', fakeAsync(() => {
    render();
    open(COSTS[1]);
    expect(document.querySelector('.p-dialog')?.textContent).toContain('Edit document_summary');
    fixture.componentInstance.form.patchValue({ creditCost: 20 });
    fixture.detectChanges();
    pressSave();
    expect(upsert).toHaveBeenCalledOnceWith({ featureKey: 'document_summary', creditCost: 20, description: '' });
    flush();
  }));
});
