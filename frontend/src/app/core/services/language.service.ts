// Central mechanism for language switching and RTL activation (ACC-19).
//
// Before this existed, translate.use() was never called anywhere in the
// app (confirmed via a full grep during planning), and the RTL CSS rules
// then in styles.scss ([dir='rtl']/[dir='ltr'] on sidebar-active-stripe, removed ACC-79)
// were permanently inert since nothing ever set the dir attribute on
// <html> — the same "written, never wired" situation ACC-15 found with
// Tailwind before its Commit 1.
//
// Every call site that needs to change or read the current language goes
// through this service — never TranslateService.use() or
// document.documentElement.dir/lang directly — so there is exactly one
// place this logic lives, not one per component (which is how the three
// orphaned TODOs this ticket closes came to exist in the first place).
//
// PrimeNG needs no equivalent DIRECTION config: confirmed directly against
// the installed PrimeNGConfigType (no rtl/direction option exists) — it
// activates automatically via CSS logical properties the moment
// <html dir="rtl"> is set, which is exactly what this effect does.
//
// ACC-83 — BUT IT DOES NEED TRANSLATION CONFIG, and that sentence used to read
// "PrimeNG needs no equivalent config", which over-read the direction finding
// into a general one. PrimeNG ships its own English strings for text IT
// renders, and the confirm dialog's buttons are the live case: verified in
// primeng-confirmdialog.mjs, each button resolves as
//
//     this.option('acceptLabel')
//       || this.getAcceptButtonProps()?.label
//       || this.config.getTranslation(TranslationKeys.ACCEPT)
//
// and primeng-config.mjs defaults ACCEPT to 'Yes' and REJECT to 'No'. So a
// confirmation that passes no labels renders Latin "Yes"/"No" inside a fully
// Arabic RTL dialog. Measured: 19 of the app's 22 confirm() calls pass none.
//
// Fixed HERE rather than at 22 call sites, because this is the one place the
// language is already applied and because a per-call fix cannot cover the
// twenty-third dialog. ConfirmDialog subscribes to config.translationObserver,
// which setTranslation() notifies, so an open dialog follows a live switch.
import { Injectable, effect, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { PrimeNG } from 'primeng/config';

const RTL_LANGUAGES = new Set(['ar']);
const DEFAULT_LANGUAGE = 'en';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly primeng = inject(PrimeNG);

  constructor() {
    // TranslateService.currentLang is a real Signal<Language | null>
    // (confirmed directly against the installed @ngx-translate/core@18.0.0
    // package, not assumed) — this effect re-runs on every language change,
    // the same reactive primitive TranslatePipe itself relies on
    // internally (it's declared pure: false specifically so template
    // bindings update when this signal changes).
    effect(() => {
      const lang = this.translate.currentLang() ?? DEFAULT_LANGUAGE;
      document.documentElement.dir = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
      document.documentElement.lang = lang;

      // ACC-83 — the strings PrimeNG renders ITSELF, in the same effect as the
      // direction, because they change for the same reason and must not be able
      // to disagree about which language is current.
      this.primeng.setTranslation({
        accept: this.translate.instant('common.yes'),
        reject: this.translate.instant('common.no'),
      });
    });
  }

  // Returns the load Observable (use() fetches the translation file via the
  // HTTP loader before resolving) so callers that must wait for the switch
  // to actually complete — app bootstrap, in particular — can do so.
  use(lang: string): Observable<unknown> {
    return this.translate.use(lang);
  }

  isRtl(): boolean {
    return RTL_LANGUAGES.has(this.translate.currentLang() ?? DEFAULT_LANGUAGE);
  }

  isArabic(): boolean {
    return (this.translate.currentLang() ?? DEFAULT_LANGUAGE) === 'ar';
  }
}
