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
//   - committee_member_role: six checkboxes, `required` and the five seat
//     actions (#307, CC-283).
// And CC-283's gap: every attribute is separated from the next by the SAME
// vertical gap, the form's row token (--am-form-row-gap), whatever the pair:
// checkbox→input, input→input, input→checkbox, checkbox→checkbox. The body
// heights are pinned within 2px of what was measured.
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
  // The seed's six booleans since #307 (lookup.seed.ts), named by labelEn / labelAr.
  committee_member_role: {
    required: { type: 'boolean', labelEn: 'Required seat', labelAr: 'مقعد مطلوب' },
    seatAddsMember: { type: 'boolean', labelEn: 'Add members', labelAr: 'إضافة أعضاء' },
    seatRemovesMember: { type: 'boolean', labelEn: 'Remove members', labelAr: 'إزالة أعضاء' },
    seatChangesSeat: { type: 'boolean', labelEn: "Change a member's seat", labelAr: 'تغيير مقعد عضو' },
    seatRequestsChange: { type: 'boolean', labelEn: 'Request a change', labelAr: 'طلب تغيير' },
    seatDecidesReportingChanges: {
      type: 'boolean',
      labelEn: 'Decide changes of committees that report to it',
      labelAr: 'البتّ في تغييرات اللجان التابعة لها',
    },
  },
} as const;

// The body heights measured with the gap fix (CC-283), pinned within 2px so a
// layout change that moves them is seen.
const PINNED: Record<string, number> = {
  'document_type en': 256,
  'document_type ar': 262,
  'committee_member_role en': 180,
  'committee_member_role ar': 180,
};
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
        expect(body().getBoundingClientRect().height).withContext('the body is laid out').toBeGreaterThan(100);

        // The gap between each attribute and the next, by kind of pair.
        const token = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--am-form-row-gap'));
        expect(token).withContext('--am-form-row-gap resolved').toBeGreaterThan(0);
        const blocks = Array.from(document.querySelectorAll<HTMLElement>('[data-attribute-field]'));
        expect(blocks.length).toBe(keys.length);
        const kind = (b: HTMLElement) => (b.querySelector('p-checkbox') ? 'checkbox' : 'input');
        const gaps: string[] = [];
        for (let i = 1; i < blocks.length; i++) {
          const gap = blocks[i]!.getBoundingClientRect().top - blocks[i - 1]!.getBoundingClientRect().bottom;
          const pair = `${kind(blocks[i - 1]!)}→${kind(blocks[i]!)}`;
          gaps.push(`${pair} ${Math.round(gap * 10) / 10}`);
          expect(Math.abs(gap - token)).withContext(`${pair} gap ${gap}px, token ${token}px`).toBeLessThan(0.5);
        }

        measured.push(`${category} ${language}: ${height}px; gaps ${gaps.join(', ')}`);
        expect(height).withContext(`${category} ${language}: body ${height}px`).toBeLessThanOrEqual(CAP);
        const pinned = PINNED[`${category} ${language}`];
        if (pinned !== undefined) {
          expect(Math.abs(height - pinned)).withContext(`${category} ${language}: ${height}px, pinned ${pinned}px`).toBeLessThanOrEqual(2);
        }
      });
    }
  }
});
