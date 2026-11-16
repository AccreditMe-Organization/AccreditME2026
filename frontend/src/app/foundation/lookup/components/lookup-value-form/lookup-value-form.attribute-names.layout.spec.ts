import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslatePipe, TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { useLayoutFonts } from '../../../../../testing/layout-fonts';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import { StepStripComponent } from '../../../../shared/components/step-strip/step-strip.component';
import { LookupService } from '../../services/lookup.service';
import { LookupValueFormComponent } from './lookup-value-form.component';

// ACC-310 — the Add value dialog's ATTRIBUTE step against the 420px body cap
// (ACC-111), now that the names come from the schema in both languages. The
// form is hosted exactly as lookup-value-list hosts it: the shell, compact
// density, the step strip in the header. Measured for the two seeded schemas
// with attributes, in English and Arabic:
//   - document_type: five attributes (two checkboxes, two numbers, a string);
//   - committee_member_role: one, `required`.
//
// NON-VACUITY FIRST (ACC-120): a body that measured 0 would pass "<= 420", so
// each case first proves step 2 is on screen with every attribute's name.

const CAP = 420;

const SCHEMAS = {
  document_type: {
    requiresFlowchart: { type: 'boolean', labelEn: 'Requires a flowchart', labelAr: 'يتطلب مخططًا انسيابيًا' },
    defaultReviewCycleMonths: { type: 'number', labelEn: 'Default review cycle (months)', labelAr: 'دورة المراجعة الافتراضية (بالأشهر)' },
    numberingPrefix: { type: 'string', labelEn: 'Numbering prefix', labelAr: 'بادئة الترقيم' },
    requiresCommitteeApproval: { type: 'boolean', labelEn: 'Requires committee approval', labelAr: 'يتطلب اعتماد لجنة' },
    defaultRetentionYears: { type: 'number', labelEn: 'Default retention (years)', labelAr: 'مدة الحفظ الافتراضية (بالسنوات)' },
  },
  committee_member_role: {
    required: { type: 'boolean', label: 'Required seat', labelEn: 'Required seat', labelAr: 'مقعد مطلوب' },
  },
} as const;
type CategoryKey = keyof typeof SCHEMAS;

@Component({
  standalone: true,
  imports: [EditDialogComponent, LookupValueFormComponent, StepStripComponent, TranslatePipe],
  template: `
    <ng-template #formTpl>
      <app-lookup-value-form [categoryKey]="categoryKey" (ready)="form.set($event)" />
    </ng-template>
    <ng-template #stepsTpl>
      @if (form(); as f) {
        <am-step-strip [steps]="f.steps()" [current]="f.step()" [ariaLabel]="'lookup.steps' | translate" />
      }
    </ng-template>
    <app-edit-dialog
      [visible]="true"
      [header]="'lookup.addValue' | translate"
      [content]="formTpl"
      [headerExtra]="stepsTpl"
      density="compact"
    />
  `,
})
class HostComponent {
  categoryKey: CategoryKey = 'document_type';
  readonly form = signal<LookupValueFormComponent | null>(null);
}

describe('LookupValueForm — the attribute step fits the 420px body (ACC-310)', () => {
  useLayoutFonts({ rtl: true });
  preserveDocumentLanguage();
  let fixture: ComponentFixture<HostComponent>;
  const measured: string[] = [];

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(language: 'en' | 'ar', category: CategoryKey): Promise<void> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        ConfirmationService,
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        {
          provide: LookupService,
          useValue: {
            getCategoryByKey: () => of({ key: category, attributeSchema: { type: 'object', properties: SCHEMAS[category] } }),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.categoryKey = category;
    await settle();
    fixture.componentInstance.form()!.step.set(2);
    await settle();
  }

  const body = () => document.querySelector<HTMLElement>('.am-dialog__body')!;

  afterEach(() => {
    fixture?.destroy();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((el) => el.remove());
  });

  afterAll(() => {
    console.log(`ACC-310 attribute step body (cap ${CAP}):\n  ${measured.join('\n  ')}`);
  });

  for (const category of Object.keys(SCHEMAS) as CategoryKey[]) {
    for (const language of ['en', 'ar'] as const) {
      it(`${category} · ${language}: every attribute named, body within ${CAP}px`, async () => {
        await render(language, category);

        // Non-vacuity: step 2, laid out, with each attribute's name in this language.
        expect(body()).withContext('.am-dialog__body not found — did the shell change?').not.toBeNull();
        const keys = Object.keys(SCHEMAS[category]);
        for (const key of keys) {
          const def = SCHEMAS[category][key as never] as { labelEn: string; labelAr: string };
          const label = document.querySelector(`label[for="attr_${key}"]`);
          expect(label).withContext(`the ${key} field rendered`).not.toBeNull();
          expect(label!.textContent!.trim()).toBe(language === 'ar' ? def.labelAr : def.labelEn);
        }
        const height = body().scrollHeight;
        // One checkbox row (committee_member_role) is about 20px tall.
        expect(body().getBoundingClientRect().height).withContext('the body is laid out').toBeGreaterThan(10);

        measured.push(`${category} ${language}: ${height}px`);
        expect(height).withContext(`${category} ${language}: body ${height}px`).toBeLessThanOrEqual(CAP);
      });
    }
  }
});
