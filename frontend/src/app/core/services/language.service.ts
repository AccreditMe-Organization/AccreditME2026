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
// ACC-237 — THE CDK DOES NEED IT, and it is written HERE, beside <html dir>, so
// direction is still set in exactly one place. The CDK's root Directionality
// reads <html dir> once, in its constructor (@angular/cdk 21.2.14,
// _directionality-chunk.mjs:25-34), and nothing in the CDK updates it after
// that; its `change` emitter is never fired by the root service itself. So
// after a switch without a reload, every CDK overlay that positions by start /
// end (the row menu, the rail's user menu, the overlay select, the task page's
// menu) opened as if the page were still in the old direction. Its value is a
// public WritableSignal (types/_bidi-module-chunk.d.ts:15), so the effect
// below sets it and emits `change` — only when it actually changes, because
// `change` means "it changed". This replaces ACC-235's per-trigger [dir]
// wrappers.
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
import { Direction, Directionality } from '@angular/cdk/bidi';
import { Observable } from 'rxjs';
import { TranslateService } from '@ngx-translate/core';
import { PrimeNG } from 'primeng/config';
import { pickBilingualName } from '../../shared/utils/bilingual-name.util';

const RTL_LANGUAGES = new Set(['ar']);
const DEFAULT_LANGUAGE = 'en';

@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly translate = inject(TranslateService);
  private readonly primeng = inject(PrimeNG);
  // The ROOT Directionality: this service is providedIn 'root', so this is the
  // instance every overlay and every injector without a [dir] above it gets.
  private readonly directionality = inject(Directionality);

  constructor() {
    // TranslateService.currentLang is a real Signal<Language | null>
    // (confirmed directly against the installed @ngx-translate/core@18.0.0
    // package, not assumed) — this effect re-runs on every language change,
    // the same reactive primitive TranslatePipe itself relies on
    // internally (it's declared pure: false specifically so template
    // bindings update when this signal changes).
    effect(() => {
      const lang = this.translate.currentLang() ?? DEFAULT_LANGUAGE;
      const dir: Direction = RTL_LANGUAGES.has(lang) ? 'rtl' : 'ltr';
      document.documentElement.dir = dir;
      document.documentElement.lang = lang;

      // ACC-237 — the CDK's root Directionality, which never re-reads <html
      // dir> (see the header). Menus pass this object to their overlay and read
      // it live; the overlay select passes it too.
      if (this.directionality.value !== dir) {
        this.directionality.valueSignal.set(dir);
        this.directionality.change.emit(dir);
      }

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

  /**
   * ACC-160 — which of a tenant record's two names to show: the Arabic one in
   * an Arabic session when it exists, otherwise the English one. The rule and
   * its reasoning live in `pickBilingualName()`; this is what call sites use,
   * because it reads the language at CALL time and so cannot freeze.
   *
   * Safe in a template and in a `computed()`: `isArabic()` reads
   * `translate.currentLang()`, a real signal, so both re-evaluate on a switch.
   * Not a pipe — a pure pipe caches on its inputs, and the language is not one.
   */
  bilingual(en: string, ar: string | null | undefined): string {
    return pickBilingualName(en, ar, this.isArabic());
  }
}
