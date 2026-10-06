import { Injectable } from '@angular/core';

export type InterfaceLanguage = 'en' | 'ar';

const STORAGE_KEY = 'am.signInLanguage';

/**
 * ACC-120 slice 9e — the language a SIGN-IN screen opens in, for someone who
 * is not signed in and so has no saved preference to read.
 *
 * Remembered in localStorage, per browser. Deliberately NOT the profile's
 * Language field: nobody is signed in to own one, and that field has
 * server-side effects (notification emails are sent in it — see
 * LanguageToggleComponent for the same line drawn in the shell).
 *
 * Every read and write is wrapped: storage can be blocked, full or absent
 * (a private window, cleared site data), and a sign-in screen must still
 * render — it falls back as though nothing were stored.
 */
@Injectable({ providedIn: 'root' })
export class SignInLanguageService {
  /** The last language chosen on a sign-in screen, else Arabic for an Arabic browser, else English. */
  initial(): InterfaceLanguage {
    return this.stored() ?? (this.browserPrefersArabic() ? 'ar' : 'en');
  }

  remember(lang: InterfaceLanguage): void {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not remembered; the choice still applies for this visit.
    }
  }

  private stored(): InterfaceLanguage | null {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === 'en' || value === 'ar' ? value : null;
    } catch {
      return null;
    }
  }

  private browserPrefersArabic(): boolean {
    const first = navigator.languages?.[0] ?? navigator.language ?? '';
    return first.toLowerCase().startsWith('ar');
  }
}
