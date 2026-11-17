import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { LanguageService } from '../../../../core/services/language.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { LookupService } from '../../services/lookup.service';
import { LookupValueFormComponent } from './lookup-value-form.component';

// ACC-310 — an attribute's name comes from the category's schema, which now
// states it in both languages (properties.<key>.labelEn / labelAr). The form
// resolves it at DISPLAY time through LanguageService.bilingual() (ACC-160), so
// a language switch reaches it with no reload; a schema with only the old
// single `label` still shows it, one with no name shows the key, and an empty
// Arabic name falls back to the English one, never blank.
//
// Each name is read from the <label for="attr_<key>"> the field renders: the
// checkbox's own label for a boolean, am-field's for a number or a string.

type Props = Record<string, { type: string; labelEn?: string; labelAr?: string }>;

// document_type's five attributes, as lane B's seed (#305) states them.
const DOCUMENT_TYPE: Props = {
  requiresFlowchart: { type: 'boolean', labelEn: 'Requires a flowchart', labelAr: 'يتطلب مخططًا انسيابيًا' },
  defaultReviewCycleMonths: { type: 'number', labelEn: 'Default review cycle (months)', labelAr: 'دورة المراجعة الافتراضية (بالأشهر)' },
  numberingPrefix: { type: 'string', labelEn: 'Numbering prefix', labelAr: 'بادئة الترقيم' },
};

describe('LookupValueFormComponent — attribute names in both languages (ACC-310)', () => {
  preserveDocumentLanguage();
  let getCategoryByKey: jasmine.Spy;

  function render(properties: Props) {
    getCategoryByKey = jasmine
      .createSpy('getCategoryByKey')
      .and.returnValue(of({ key: 'document_type', attributeSchema: { type: 'object', properties } }));
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [LookupValueFormComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG(),
        { provide: LookupService, useValue: { getCategoryByKey } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use('en');
    const fixture = TestBed.createComponent(LookupValueFormComponent);
    fixture.componentInstance.categoryKey = 'document_type';
    fixture.detectChanges();
    fixture.componentInstance.step.set(2);
    fixture.detectChanges();
    // am-field wires its label's `for` in afterNextRender, so one more pass.
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const nameOf = (key: string) => el.querySelector(`label[for="attr_${key}"]`)?.textContent?.trim() ?? null;
    const switchTo = (language: 'en' | 'ar') => {
      TestBed.inject(LanguageService).use(language);
      fixture.detectChanges();
    };
    return { fixture, nameOf, switchTo };
  }

  it('English shows labelEn; Arabic shows labelAr after a live switch, with no reload', () => {
    const { nameOf, switchTo } = render(DOCUMENT_TYPE);
    expect(nameOf('requiresFlowchart')).toBe('Requires a flowchart');
    expect(nameOf('defaultReviewCycleMonths')).toBe('Default review cycle (months)');
    expect(nameOf('numberingPrefix')).toBe('Numbering prefix');

    switchTo('ar');
    expect(nameOf('requiresFlowchart')).toBe('يتطلب مخططًا انسيابيًا');
    expect(nameOf('defaultReviewCycleMonths')).toBe('دورة المراجعة الافتراضية (بالأشهر)');
    expect(nameOf('numberingPrefix')).toBe('بادئة الترقيم');

    switchTo('en');
    expect(nameOf('numberingPrefix')).toBe('Numbering prefix');
    // The category was read once: the names followed the language, not a reload.
    expect(getCategoryByKey).toHaveBeenCalledTimes(1);
  });

  it('a schema with no labelEn shows the key, in both languages (the old `label` is not read)', () => {
    const { nameOf, switchTo } = render({ required: { type: 'boolean', label: 'Old seat name' } as Props[string] });
    expect(nameOf('required')).toBe('required');
    switchTo('ar');
    expect(nameOf('required')).toBe('required');
  });

  it('labelEn and labelAr name the attribute', () => {
    const { nameOf, switchTo } = render({
      required: { type: 'boolean', labelEn: 'Required seat', labelAr: 'مقعد مطلوب' },
    });
    expect(nameOf('required')).toBe('Required seat');
    switchTo('ar');
    expect(nameOf('required')).toBe('مقعد مطلوب');
  });

  it('a schema with neither name shows the key', () => {
    const { nameOf, switchTo } = render({ defaultRetentionYears: { type: 'number' } });
    expect(nameOf('defaultRetentionYears')).toBe('defaultRetentionYears');
    switchTo('ar');
    expect(nameOf('defaultRetentionYears')).toBe('defaultRetentionYears');
  });

  it('an empty labelAr falls back to English in Arabic, never blank', () => {
    const { nameOf, switchTo } = render({
      numberingPrefix: { type: 'string', labelEn: 'Numbering prefix', labelAr: '' },
      requiresFlowchart: { type: 'boolean', labelEn: 'Requires a flowchart', labelAr: '   ' },
    });
    switchTo('ar');
    expect(nameOf('numberingPrefix')).toBe('Numbering prefix');
    expect(nameOf('requiresFlowchart')).toBe('Requires a flowchart');
  });
});
