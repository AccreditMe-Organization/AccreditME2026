// ACC-94 — what drives what (backend/Plans/step-94-formatting-layer.md §1).
//
//   text language  → the UI language           (TranslateService.currentLang)
//   digits         → always Latin              (FormatService, not a locale)
//   time zone      → the TENANT                (working-calendar zone, GET /auth/me)
//   calendar       → the USER's own preference (User.hijriDisplay, GET /auth/me)
//
// None of them is the browser's. A browser time zone is where the reader happens
// to be; the day an instant belongs to is where the organisation works, and the
// SLA engine already decides "due" in that zone. Rendering "today" in the
// browser's zone is how a task already overdue reads "due today".
//
// Every value here is a signal, so anything that reads it — FormatService inside
// a computed(), or a pipe — re-evaluates when the language, zone or calendar
// changes (ACC-55's instant()-in-computed() rule, satisfied by construction).
import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { AuthService } from '../services/auth.service';

export type DisplayLanguage = 'en' | 'ar';
export type DisplayCalendar = 'gregory' | 'islamic-umalqura';

// The backend's GCC_DEFAULT (WorkingCalendarService) — used before /auth/me has
// answered, and in place of a zone the platform does not recognise.
export const DEFAULT_TIME_ZONE = 'Asia/Riyadh';

export function isValidTimeZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Injectable as the abstract type everywhere; the session context by default,
// TestFormatContext in specs (provideFormatTesting). A factory rather than
// useExisting, because SessionFormatContext is declared below this class.
@Injectable({ providedIn: 'root', useFactory: () => inject(SessionFormatContext) })
export abstract class FormatContext {
  abstract readonly language: Signal<DisplayLanguage>;
  abstract readonly timeZone: Signal<string>;
  abstract readonly calendar: Signal<DisplayCalendar>;
}

// The app's context: the signed-in session.
@Injectable({ providedIn: 'root' })
export class SessionFormatContext extends FormatContext {
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);

  readonly language = computed<DisplayLanguage>(() => (this.translate.currentLang() === 'ar' ? 'ar' : 'en'));

  readonly timeZone = computed(() => {
    const zone = this.auth.displayPreferences()?.timeZone;
    return isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  });

  readonly calendar = computed<DisplayCalendar>(() =>
    this.auth.displayPreferences()?.hijriDisplay ? 'islamic-umalqura' : 'gregory',
  );
}

// For specs: the language still follows TranslateService, so a spec switches
// language the way the app does; the zone and calendar are set directly.
@Injectable()
export class TestFormatContext extends FormatContext {
  private readonly translate = inject(TranslateService);

  readonly zone = signal(DEFAULT_TIME_ZONE);
  readonly hijri = signal(false);

  readonly language = computed<DisplayLanguage>(() => (this.translate.currentLang() === 'ar' ? 'ar' : 'en'));
  readonly timeZone = this.zone.asReadonly();
  readonly calendar = computed<DisplayCalendar>(() => (this.hijri() ? 'islamic-umalqura' : 'gregory'));
}
