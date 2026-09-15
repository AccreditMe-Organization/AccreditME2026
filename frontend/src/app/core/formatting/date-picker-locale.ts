// ACC-94 (approved addition 1) — PrimeNG date pickers DISPLAY in the UI
// language, in the app's date format. Without this every picker used PrimeNG's
// defaults: "mm/dd/yy" (the same ambiguity as "9/15/26") and English month and
// day names in an Arabic session.
//
// Display only. The value a picker produces — and how a picked day becomes a
// stored instant — is unchanged (ACC-96), and it stays Gregorian whatever the
// user's calendar preference (decision D4: anything a person picks is
// Gregorian).
import { EnvironmentProviders, effect, inject, provideEnvironmentInitializer } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { PrimeNG } from 'primeng/config';
import { DisplayLanguage } from './format-context';

// PrimeNG's tokens: d = day without padding, M = short month name, yy = 4-digit
// year, giving "15 Sep 2026" and "15 سبتمبر 2026" — the layer's date format.
const DATE_FORMAT = 'd M yy';
// The GCC working week starts on Sunday.
const FIRST_DAY_OF_WEEK = 0;

const LOCALE: Record<DisplayLanguage, string> = { en: 'en', ar: 'ar-SA' };

// The keys PrimeNG's date picker reads for its visible and accessible labels,
// under datePicker.* in both translation files.
const LABEL_KEYS = [
  'today',
  'clear',
  'chooseDate',
  'chooseMonth',
  'chooseYear',
  'prevDecade',
  'nextDecade',
  'prevYear',
  'nextYear',
  'prevMonth',
  'nextMonth',
  'weekHeader',
] as const;

// Month and day names come from Intl for the UI language — the same source as
// FormatService's dates, so a picker and the text beside it agree.
export function datePickerTranslation(language: DisplayLanguage, labels: Record<string, string>) {
  const locale = LOCALE[language];
  const month = (style: 'long' | 'short') =>
    Array.from({ length: 12 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { month: style, timeZone: 'UTC', calendar: 'gregory' }).format(Date.UTC(2026, i, 15)),
    );
  // 4 January 2026 is a Sunday.
  const weekday = (style: 'long' | 'short' | 'narrow') =>
    Array.from({ length: 7 }, (_, i) =>
      new Intl.DateTimeFormat(locale, { weekday: style, timeZone: 'UTC', calendar: 'gregory' }).format(Date.UTC(2026, 0, 4 + i)),
    );
  const short = weekday('short');
  return {
    monthNames: month('long'),
    monthNamesShort: month('short'),
    dayNames: weekday('long'),
    dayNamesShort: short,
    // English single letters repeat (S, T), so two letters; Arabic's standard
    // one-letter forms are distinct.
    dayNamesMin: language === 'ar' ? weekday('narrow') : short.map((d) => d.slice(0, 2)),
    dateFormat: DATE_FORMAT,
    firstDayOfWeek: FIRST_DAY_OF_WEEK,
    ...Object.fromEntries(LABEL_KEYS.filter((key) => typeof labels[key] === 'string').map((key) => [key, labels[key]])),
  };
}

// Registered once in app.config.ts. Re-applies on every language switch, and
// when a language file finishes loading (instant() reads the translation store's
// signals).
export function provideDatePickerLocale(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const primeng = inject(PrimeNG);
    const translate = inject(TranslateService);
    effect(() => {
      const language: DisplayLanguage = translate.currentLang() === 'ar' ? 'ar' : 'en';
      const labels = translate.instant('datePicker') as unknown;
      primeng.setTranslation(
        datePickerTranslation(language, labels !== null && typeof labels === 'object' ? (labels as Record<string, string>) : {}),
      );
    });
  });
}
