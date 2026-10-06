import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import {
  InterfaceLanguage,
  SignInLanguageService,
} from '../../../../core/services/sign-in-language.service';
import { LanguageToggleComponent } from '../../../../layout/language-toggle/language-toggle.component';

/**
 * ACC-120 slice 9e — the frame every sign-in screen sits in (Template 7):
 * one centred card on the page surface, with the language switch in its
 * header. Accept invitation is the first screen on it; sign-in and password
 * reset move onto it in slice 9d.
 *
 * It opens in the language last chosen on a sign-in screen (or the browser's,
 * if that is Arabic), and remembers a new choice — see SignInLanguageService.
 * Someone already signed in keeps the language their session resolved to:
 * this frame does not override a saved preference it did not set.
 *
 * The projected content is shown once that language is applied, so the card
 * does not flash English before switching to Arabic.
 */
@Component({
  selector: 'app-auth-layout',
  standalone: true,
  imports: [LanguageToggleComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="am-auth">
      <div class="am-auth__card">
        <header class="am-auth__header">
          <app-language-toggle (chosen)="remember($event)" />
        </header>
        @if (ready()) {
          <ng-content />
        }
      </div>
    </main>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .am-auth {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--am-space-24) var(--am-space-16);
        background: var(--am-surface);
      }
      .am-auth__card {
        width: 100%;
        max-width: 340px;
        display: flex;
        flex-direction: column;
        gap: var(--am-space-16);
        padding: var(--am-space-24);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-card);
      }
      .am-auth__header {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class AuthLayoutComponent {
  private readonly languageService = inject(LanguageService);
  private readonly signInLanguage = inject(SignInLanguageService);

  readonly ready = signal(false);

  constructor() {
    if (inject(AuthService).isAuthenticated()) {
      this.ready.set(true);
      return;
    }
    const lang = this.signInLanguage.initial();
    const current: InterfaceLanguage = this.languageService.isArabic() ? 'ar' : 'en';
    if (lang === current) {
      this.ready.set(true);
      return;
    }
    // Shown either way: a translation file that fails to load leaves the
    // screen in the language it already had, which is still usable.
    this.languageService.use(lang).subscribe({
      complete: () => this.ready.set(true),
      error: () => this.ready.set(true),
    });
  }

  protected remember(lang: InterfaceLanguage): void {
    this.signInLanguage.remember(lang);
  }
}
