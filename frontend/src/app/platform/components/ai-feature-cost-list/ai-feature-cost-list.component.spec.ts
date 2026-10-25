import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import en from '../../../../assets/i18n/en.json';
import ar from '../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../core/formatting/testing';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { IAiFeatureCost, PlanService } from '../../services/plan.service';
import { AiFeatureCostListComponent } from './ai-feature-cost-list.component';

// ACC-264 — each row's pencil names the feature it edits, so a screen reader
// hears "Edit document_summary" rather than the same unnamed button per row.

const COSTS: IAiFeatureCost[] = [
  { id: 'c-1', featureKey: 'task_description_drafting', creditCost: 2, description: null },
  { id: 'c-2', featureKey: 'document_summary', creditCost: 15, description: null },
];

async function render(language: 'en' | 'ar' = 'en'): Promise<HTMLElement> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [AiFeatureCostListComponent],
    providers: [
      provideNoopAnimations(),
      ConfirmationService,
      provideTranslateService({ lang: 'en' }),
      provideFormatTesting(),
      { provide: PlanService, useValue: { listAiFeatureCosts: () => of(COSTS) } },
      { provide: NavigationAccessService, useValue: { isPlatformAdmin: () => true } },
    ],
  });
  loadTranslationsForTest({ en, ar });
  TestBed.inject(TranslateService).use(language);
  const fixture = TestBed.createComponent(AiFeatureCostListComponent);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

const names = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('[data-testid="feature-cost-edit"] button')).map((b) => b.getAttribute('aria-label'));

describe('AiFeatureCostListComponent — the edit buttons are named (ACC-264)', () => {
  it('each pencil names its feature', async () => {
    expect(names(await render())).toEqual(['Edit task_description_drafting', 'Edit document_summary']);
  });

  it('in Arabic too', async () => {
    expect(names(await render('ar'))).toEqual(['تعديل task_description_drafting', 'تعديل document_summary']);
  });
});
