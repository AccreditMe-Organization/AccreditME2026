import { Component, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../../core/services/language.service';

type InterfaceLanguage = 'en' | 'ar';

// ACC-79 — the reading-mode toggle: EN / ع in the top bar, from the page-level
// design references (Users List, Committee Record).
//
// SESSION-SCOPED, AND DELIBERATELY SO. It calls LanguageService.use() and
// nothing else. It does NOT write the user's saved language preference, and
// must not be changed to. The two are different behaviours:
//
//   this toggle          "show me this in English for a moment" — gone on
//                        reload, and on the next sign-in
//   profile Language     "this is my language" — saved, applied at sign-in,
//                        and read server-side (notification emails are sent in
//                        it, notification-email.processor.ts)
//
// A reviewer who flips to English once to read something must not start
// receiving English email, nor be pinned out of their organisation's default.
// If a toggle ever needs to survive a reload, that is sessionStorage in THIS
// component — still not the saved preference.
//
// WHAT IT SWITCHES, AND WHAT IT NEVER WILL. Interface language controls the
// chrome, and which of a record's two stored names (nameEn / nameAr) is shown
// for tenant data. It is unrelated to a document's language, and always will
// be: a document's language is a property of the file, not of who is reading
// it. An Arabic-speaking reviewer opening an English policy sees an English
// policy, with the interface around it in Arabic. (A decision, recorded in
// CLAUDE.md, for Document Management to inherit rather than re-derive.)
//
// Plain buttons rather than p-selectButton: two fixed options need no widget,
// and aria-pressed on a native button is the whole accessibility story.
@Component({
  selector: 'app-language-toggle',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div
      role="group"
      [attr.aria-label]="'shell.interfaceLanguage' | translate"
      class="flex overflow-hidden rounded-md border border-[var(--am-border)]"
    >
      @for (option of options; track option.lang) {
        <!-- Each label is marked in its OWN language, so a screen reader
             pronounces "العربية" as Arabic even in an English session. -->
        <button
          type="button"
          class="am-lang-option px-2.5 py-1 text-xs font-semibold leading-none"
          [class.am-lang-option--active]="current() === option.lang"
          [attr.lang]="option.lang"
          [attr.aria-label]="option.name"
          [attr.aria-pressed]="current() === option.lang"
          [disabled]="switching()"
          (click)="choose(option.lang)"
        >
          {{ option.mark }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      .am-lang-option {
        color: var(--am-text-secondary);
        background: var(--am-card);
        cursor: pointer;
      }
      .am-lang-option:hover {
        background: var(--am-surface);
      }
      .am-lang-option--active,
      .am-lang-option--active:hover {
        color: var(--am-card);
        background: var(--am-blue-primary);
      }
      .am-lang-option:focus-visible {
        outline: 2px solid var(--am-blue-primary);
        outline-offset: -2px;
      }
      .am-lang-option:disabled {
        cursor: progress;
      }
    `,
  ],
})
export class LanguageToggleComponent {
  private readonly languageService = inject(LanguageService);

  // Names are written in their own language, never translated: someone who
  // cannot read the current interface must still recognise their language.
  readonly options: readonly {
    lang: InterfaceLanguage;
    mark: string;
    name: string;
  }[] = [
    { lang: 'en', mark: 'EN', name: 'English' },
    { lang: 'ar', mark: 'ع', name: 'العربية' },
  ];

  readonly switching = signal(false);

  current(): InterfaceLanguage {
    return this.languageService.isArabic() ? 'ar' : 'en';
  }

  choose(lang: InterfaceLanguage): void {
    if (lang === this.current() || this.switching()) return;
    this.switching.set(true);
    // The translation file may need fetching on first switch; keep the
    // control disabled until it lands so a double click cannot race it.
    this.languageService.use(lang).subscribe({
      complete: () => this.switching.set(false),
      error: () => this.switching.set(false),
    });
  }
}
