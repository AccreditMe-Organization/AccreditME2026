import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { PrimeNG, providePrimeNG } from 'primeng/config';
import { DatePickerModule } from 'primeng/datepicker';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { datePickerTranslation, provideDatePickerLocale } from './date-picker-locale';
import { loadTranslationsForTest, provideFormatTesting } from './testing';

// ACC-94 (approved addition 1) — date pickers display in the UI language and the
// app's date format. They showed "mm/dd/yy" and English month names in Arabic.

@Component({
  standalone: true,
  imports: [DatePickerModule, FormsModule],
  template: `<p-datepicker [(ngModel)]="value" inputId="picker" />`,
})
class PickerHostComponent {
  // Local midnight: a picker holds a local calendar date (ACC-96 records what
  // that means for storage; display is what is tested here).
  value = new Date(2026, 8, 15);
}

describe('Date picker display (ACC-94)', () => {
  function setUp(language: 'en' | 'ar') {
    TestBed.configureTestingModule({
      imports: [PickerHostComponent],
      providers: [
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG(),
        provideDatePickerLocale(),
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.tick();
    return TestBed.inject(PrimeNG);
  }

  const inputText = async () => {
    const fixture = TestBed.createComponent(PickerHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('#picker')?.value;
  };

  it('shows a picked date as "15 Sep 2026" in English, not mm/dd/yy', async () => {
    const primeng = setUp('en');
    expect(primeng.getTranslation('dateFormat')).toBe('d M yy');
    expect(await inputText()).toBe('15 Sep 2026');
  });

  it('uses Arabic month and day names, with Latin digits, in an Arabic session', async () => {
    const primeng = setUp('ar');
    expect(primeng.getTranslation('monthNamesShort')[8]).toBe('سبتمبر');
    expect(primeng.getTranslation('dayNamesMin')).toEqual(['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س']);
    expect(primeng.getTranslation('prevMonth')).toBe('الشهر السابق');
    expect(await inputText()).toBe('15 سبتمبر 2026');
  });

  it('switches with the language, and starts the week on Sunday', () => {
    const primeng = setUp('en');
    expect(primeng.getTranslation('monthNames')[0]).toBe('January');
    TestBed.inject(TranslateService).use('ar');
    TestBed.tick();
    expect(primeng.getTranslation('monthNames')[0]).toBe('يناير');
    expect(primeng.getTranslation('firstDayOfWeek')).toBe(0);
  });

  it('gives English two-letter day headers, since single letters repeat', () => {
    expect(datePickerTranslation('en', {}).dayNamesMin).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  });
});
