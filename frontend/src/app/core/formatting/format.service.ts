// ACC-94 — the one place the app turns a date, a time span or a number into
// text. The rule (CLAUDE.md, ACC-94): components ask for a MEANING — date,
// dateTime, relative, duration, number — never an Angular format string, and
// never construct Intl formatters or call toLocale*String themselves.
//
//   date       15 Sep 2026                   15 سبتمبر 2026
//   dateTime   15 Sep 2026, 14:05            15 سبتمبر 2026، 14:05
//   relative   3 days ago · now              قبل 3 أيام · الآن
//   duration   5 hours · less than a minute  5 ساعات · أقل من دقيقة
//
// Decisions (backend/Plans/step-94-formatting-layer.md):
// - Month as a word, day first: "9/15/26" reads as 9 October in the GCC.
//   English is assembled from parts, because en-GB now writes "Sept".
// - 24-hour in both languages (D5).
// - Digits are Latin always (Ahmad's decision). An Arabic REGION can default
//   to Arabic-Indic digits (ar-SA, ar-EG do), so numberingSystem is pinned on
//   every formatter rather than trusted to the locale.
// - The time zone is the tenant's and the calendar is the user's (FormatContext).
// - Hijri is display only (D4): Hijri first, Gregorian in brackets. Pickers,
//   API values and anything machine-readable never come through here.
// - A missing or unparseable value renders EMPTY_VALUE, never the raw input.
//
// Every method reads FormatContext's signals, so calling one inside a
// computed() re-evaluates on a language, zone or calendar change.
import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { DisplayCalendar, DisplayLanguage, FormatContext } from './format-context';

export const EMPTY_VALUE = '—';

export type DateInput = string | number | Date | null | undefined;

// Arabic formats as ar-SA, a GCC region whose DEFAULT digits are Arabic-Indic.
// With numberingSystem pinned the text is identical to plain 'ar' (checked),
// and the pin is then load-bearing: remove it and the Latin-digits spec fails.
const LOCALE: Record<DisplayLanguage, string> = { en: 'en', ar: 'ar-SA' };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

type Parts = Partial<Record<Intl.DateTimeFormatPartTypes, string>>;

@Injectable({ providedIn: 'root' })
export class FormatService {
  private readonly context = inject(FormatContext);
  private readonly translate = inject(TranslateService);

  // Intl formatters are costly to construct and cheap to reuse; pipes call these
  // on every change-detection pass.
  private readonly dateFormats = new Map<string, Intl.DateTimeFormat>();
  private readonly numberFormats = new Map<string, Intl.NumberFormat>();
  private readonly relativeFormats = new Map<string, Intl.RelativeTimeFormat>();

  date(value: DateInput): string {
    const at = toDate(value);
    const { language, timeZone, calendar } = this.snapshot();
    if (!at) return EMPTY_VALUE;
    const gregorian = this.gregorianDate(at, language, timeZone);
    return calendar === 'islamic-umalqura' ? `${this.hijriDate(at, language, timeZone)} (${gregorian})` : gregorian;
  }

  dateTime(value: DateInput): string {
    const at = toDate(value);
    const { language, timeZone, calendar } = this.snapshot();
    if (!at) return EMPTY_VALUE;
    const gregorian = this.gregorianDate(at, language, timeZone);
    const time = this.time(at, language, timeZone);
    const separator = language === 'ar' ? '، ' : ', ';
    return calendar === 'islamic-umalqura'
      ? `${this.hijriDate(at, language, timeZone)}${separator}${time} (${gregorian})`
      : `${gregorian}${separator}${time}`;
  }

  // How long ago (or until) an instant, for recency summaries only. Anything a
  // person acts on or cites is shown absolutely (date/dateTime), with this at
  // most beside it.
  relative(value: DateInput, now: Date = new Date()): string {
    const at = toDate(value);
    const { language } = this.snapshot();
    if (!at) return EMPTY_VALUE;
    const diff = at.getTime() - now.getTime();
    const abs = Math.abs(diff);
    if (abs < MINUTE_MS) return this.relativeFormat(LOCALE[language], 'auto').format(0, 'second');
    const [amount, unit] = splitElapsed(abs);
    return this.relativeFormat(LOCALE[language], 'always').format(Math.sign(diff) * amount, unit);
  }

  // A span of time, as a quantity: "Open 7 days", "Overdue 5 hours". The same
  // thresholds as relative(), so no span ever reads "0 days" (ACC-94 addition 3).
  duration(ms: number | null | undefined): string {
    const { language } = this.snapshot();
    if (ms === null || ms === undefined || !Number.isFinite(ms)) return EMPTY_VALUE;
    const abs = Math.abs(ms);
    if (abs < MINUTE_MS) return this.translate.instant('format.lessThanMinute');
    const [amount, unit] = splitElapsed(abs);
    return this.numberFormat(LOCALE[language], { style: 'unit', unit, unitDisplay: 'long' }).format(amount);
  }

  // The span between two instants, e.g. how long a task has been overdue.
  elapsed(from: DateInput, to: DateInput = new Date()): string {
    const start = toDate(from);
    const end = toDate(to);
    // Read the context even on the empty path, so a computed() that starts
    // empty still subscribes to a language change.
    this.snapshot();
    if (!start || !end) return EMPTY_VALUE;
    return this.duration(end.getTime() - start.getTime());
  }

  number(value: number | null | undefined): string {
    const { language } = this.snapshot();
    if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
    return this.numberFormat(LOCALE[language], {}).format(value);
  }

  // Which clock dates are shown in, for screens where that is not obvious —
  // e.g. platform screens, which show the signed-in session's zone rather than
  // each tenant's. "Asia/Riyadh (GMT+3)".
  zoneLabel(): string {
    const { timeZone } = this.snapshot();
    const offset = this.dateFormat('en', { timeZone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value;
    return offset ? `${timeZone} (${offset})` : timeZone;
  }

  private snapshot(): { language: DisplayLanguage; timeZone: string; calendar: DisplayCalendar } {
    return {
      language: this.context.language(),
      timeZone: this.context.timeZone(),
      calendar: this.context.calendar(),
    };
  }

  private gregorianDate(at: Date, language: DisplayLanguage, timeZone: string): string {
    const p = this.parts(at, language, { timeZone, calendar: 'gregory', day: 'numeric', month: 'short', year: 'numeric' });
    return `${p.day} ${p.month} ${p.year}`;
  }

  private hijriDate(at: Date, language: DisplayLanguage, timeZone: string): string {
    const p = this.parts(at, language, {
      timeZone,
      calendar: 'islamic-umalqura',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    return [p.day, p.month, p.year, p.era].filter(Boolean).join(' ');
  }

  private time(at: Date, language: DisplayLanguage, timeZone: string): string {
    const p = this.parts(at, language, { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    return `${p.hour}:${p.minute}`;
  }

  private parts(at: Date, language: DisplayLanguage, options: Intl.DateTimeFormatOptions): Parts {
    const parts: Parts = {};
    for (const part of this.dateFormat(LOCALE[language], options).formatToParts(at)) parts[part.type] = part.value;
    return parts;
  }

  private dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
    const key = `${locale}|${JSON.stringify(options)}`;
    let format = this.dateFormats.get(key);
    if (!format) {
      format = new Intl.DateTimeFormat(locale, { ...options, numberingSystem: 'latn' });
      this.dateFormats.set(key, format);
    }
    return format;
  }

  private numberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat {
    const key = `${locale}|${JSON.stringify(options)}`;
    let format = this.numberFormats.get(key);
    if (!format) {
      format = new Intl.NumberFormat(locale, { ...options, numberingSystem: 'latn' });
      this.numberFormats.set(key, format);
    }
    return format;
  }

  private relativeFormat(locale: string, numeric: 'auto' | 'always'): Intl.RelativeTimeFormat {
    const key = `${locale}|${numeric}`;
    let format = this.relativeFormats.get(key);
    if (!format) {
      // TypeScript's lib has no numberingSystem option on RelativeTimeFormat
      // (browsers support it); the locale extension -u-nu-latn is the same pin.
      format = new Intl.RelativeTimeFormat(`${locale}-u-nu-latn`, { numeric });
      this.relativeFormats.set(key, format);
    }
    return format;
  }
}

// Under 60 minutes, minutes; under 48 hours, hours; otherwise whole days.
// Always floored: "5 hours" late never means 4 hours 31 minutes.
function splitElapsed(abs: number): [number, 'minute' | 'hour' | 'day'] {
  if (abs < HOUR_MS) return [Math.floor(abs / MINUTE_MS), 'minute'];
  if (abs < 48 * HOUR_MS) return [Math.floor(abs / HOUR_MS), 'hour'];
  return [Math.floor(abs / DAY_MS), 'day'];
}

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const at = value instanceof Date ? value : new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}
