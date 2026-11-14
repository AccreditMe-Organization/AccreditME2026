import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Subject, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { UserService } from '../../services/user.service';
import { TwoStepOffDialogComponent } from './two-step-off-dialog.component';
import { TwoStepResetDialogComponent } from './two-step-reset-dialog.component';

/**
 * ACC-164 — the two two-step dialogs, built to "AccreditMe Two-step Sign-in".
 * Each refusal is said where the design puts it, from its code.
 */
@Component({
  standalone: true,
  imports: [TwoStepOffDialogComponent, TwoStepResetDialogComponent],
  template: `
    @if (which() === 'off') {
      <app-two-step-off-dialog
        [visible]="visible()"
        (visibleChange)="visible.set($event)"
        (disabled)="disabled = true"
        (stale)="stale = true"
      />
    } @else {
      <app-two-step-reset-dialog
        [visible]="visible()"
        (visibleChange)="visible.set($event)"
        userId="u-lina"
        userName="Lina Haddad"
        (done)="done = true"
        (stale)="stale = true"
      />
    }
  `,
})
class Host {
  readonly which = signal<'off' | 'reset'>('off');
  readonly visible = signal(true);
  disabled = false;
  done = false;
  stale = false;
}

const refused = (status: number, body: Record<string, unknown>) =>
  throwError(() => new HttpErrorResponse({ status, error: body }));

describe('Two-step dialogs (ACC-164)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let auth: { disableMfa: jasmine.Spy };
  let users: { resetMfa: jasmine.Spy };

  function open(which: 'off' | 'reset', lang: 'en' | 'ar' = 'en'): void {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: AuthService, useValue: auth },
        { provide: UserService, useValue: users },
        {
          provide: LanguageService,
          useValue: { isArabic: () => lang === 'ar', isRtl: () => lang === 'ar', bilingual: (e: string) => e },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    host.which.set(which);
    fixture.detectChanges();
    fixture.detectChanges();
  }

  beforeEach(() => {
    auth = { disableMfa: jasmine.createSpy('disableMfa').and.returnValue(of(undefined)) };
    users = { resetMfa: jasmine.createSpy('resetMfa').and.returnValue(of(undefined)) };
  });
  afterEach(() => {
    fixture?.destroy();
  });

  const q = <T extends Element = HTMLElement>(selector: string): T | null => document.querySelector<T>(selector);
  const text = (): string => document.querySelector('.p-dialog')?.textContent ?? '';
  const type = (selector: string, value: string): void => {
    const input = q<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const click = (selector: string): void => {
    const el = q(selector)!;
    const target = el.matches('button') ? el : (el.querySelector('button') ?? el);
    (target as HTMLElement).click();
    fixture.detectChanges();
  };
  const escape = (): void => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
  };
  const fill = (password = 'typed-in-test', code = '482913'): void => {
    type('#two-step-off-password', password);
    type('#two-step-off-code', code);
  };

  describe('Turn off', () => {
    it('sends the password and the code, then closes and says it is off', () => {
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(auth.disableMfa).toHaveBeenCalledOnceWith('typed-in-test', '482913');
      expect(host.disabled).toBeTrue();
      expect(host.visible()).toBeFalse();
    });

    it('shows the design\'s intro and both fields, with the code\'s hint', () => {
      open('off');
      expect(text()).toContain('Enter your password and a code from your authenticator app.');
      expect(text()).toContain('Code from your authenticator app');
      expect(text()).toContain('The 6-digit code showing in your app now.');
      const code = q<HTMLInputElement>('#two-step-off-code')!;
      expect(code.getAttribute('inputmode')).toBe('numeric');
      expect(code.getAttribute('autocomplete')).toBe('one-time-code');
      expect(code.getAttribute('maxlength')).toBe('6');
    });

    it('nothing is sent without both, and each field says what it needs', () => {
      open('off');
      click('[data-two-step-off-confirm]');
      expect(auth.disableMfa).not.toHaveBeenCalled();
      expect(text()).toContain('Enter your password.');
      expect(text()).toContain('Enter the 6-digit code.');
    });

    it('a malformed code is refused before sending', () => {
      open('off');
      fill('pw', '48291');
      click('[data-two-step-off-confirm]');
      expect(auth.disableMfa).not.toHaveBeenCalled();
      expect(text()).toContain('Enter the 6-digit code.');
    });

    it('a wrong password: said under Password, which is cleared; the code is kept', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'INVALID_CREDENTIALS' }));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(text()).toContain("That password isn't right.");
      expect(q<HTMLInputElement>('#two-step-off-password')!.value).toBe('');
      expect(q<HTMLInputElement>('#two-step-off-code')!.value).toBe('482913');
      expect(host.visible()).toBeTrue();
    });

    it('a wrong code: said under Code, cleared, with "2 attempts left." on its own line', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'MFA_INVALID', attemptsRemaining: 2 }));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(text()).toContain("That code didn't work. Enter the code showing in your app now.");
      expect(q('[data-two-step-attempts]')?.textContent?.trim()).toBe('2 attempts left.');
      expect(q<HTMLInputElement>('#two-step-off-code')!.value).toBe('');
      expect(q<HTMLInputElement>('#two-step-off-password')!.value).toBe('typed-in-test');
    });

    it('no count line for 3 or more, as Sign in', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'MFA_INVALID', attemptsRemaining: 7 }));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q('[data-two-step-attempts]')).toBeNull();
    });

    it('in Arabic, the count uses the dual', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'MFA_INVALID', attemptsRemaining: 2 }));
      open('off', 'ar');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q('[data-two-step-attempts]')?.textContent?.trim()).toBe('محاولتان متبقيتان.');
    });

    it('locked: a red message above the buttons, saying when', () => {
      auth.disableMfa.and.returnValue(
        refused(400, { code: 'ACCOUNT_LOCKED', lockedUntil: new Date(Date.now() + 14 * 60_000).toISOString() }),
      );
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      const message = q('[data-two-step-off-message]')!;
      expect(message.textContent).toContain('Too many unsuccessful attempts. You can try again');
      expect(message.querySelector('[role="alert"]')).not.toBeNull();
    });

    it('locked with no time: the no-time sentence', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'ACCOUNT_LOCKED' }));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q('[data-two-step-off-message]')!.textContent).toContain('Try again later.');
    });

    it('already off: a blue message, only Close, and closing asks the panel to read again', () => {
      auth.disableMfa.and.returnValue(refused(400, { code: 'MFA_NOT_ENABLED' }));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q('[data-two-step-off-message] [role="status"]')?.textContent).toContain('Two-step sign-in is already off.');
      expect(q('[data-two-step-off-confirm]')).toBeNull();
      expect(q('[data-two-step-off-cancel]')).toBeNull();
      click('[data-two-step-off-close]');
      expect(host.visible()).toBeFalse();
      expect(host.stale).toBeTrue();
    });

    it('unreachable: a red message, and Turn off stays to try again', () => {
      auth.disableMfa.and.returnValue(throwError(() => new HttpErrorResponse({ status: 0 })));
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q('[data-two-step-off-message]')!.textContent).toContain("We couldn't reach AccreditMe.");
      expect(q('[data-two-step-off-confirm]')).not.toBeNull();
    });

    it('while sending: fields read-only, Cancel disabled, Escape ignored', () => {
      const pending = new Subject<void>();
      auth.disableMfa.and.returnValue(pending);
      open('off');
      fill();
      click('[data-two-step-off-confirm]');
      expect(q<HTMLInputElement>('#two-step-off-code')!.disabled).toBeTrue();
      expect(q<HTMLButtonElement>('[data-two-step-off-cancel] button')!.disabled).toBeTrue();
      escape();
      expect(host.visible()).toBeTrue();
      pending.next();
      pending.complete();
      fixture.detectChanges();
      expect(host.visible()).toBeFalse();
    });
  });

  describe('Reset', () => {
    it('names the person in the title as a left-to-right isolate', () => {
      open('reset');
      const title = document.querySelector('.p-dialog-title, .p-dialog-header')?.textContent ?? '';
      expect(title).toContain('Reset two-step sign-in for ⁨Lina Haddad⁩?');
    });

    it('in Arabic, names «الحساب» and keeps the name isolated', () => {
      open('reset', 'ar');
      const title = document.querySelector('.p-dialog-title, .p-dialog-header')?.textContent ?? '';
      expect(title).toContain('إعادة ضبط التحقق بخطوتين للحساب ⁨Lina Haddad⁩؟');
    });

    it('Reset resets, then closes', () => {
      open('reset');
      expect(text()).toContain('signs them out everywhere');
      click('[data-two-step-reset-confirm]');
      expect(users.resetMfa).toHaveBeenCalledOnceWith('u-lina');
      expect(host.done).toBeTrue();
      expect(host.visible()).toBeFalse();
    });

    it('the account owner: the message replaces the paragraph, and only Close', () => {
      users.resetMfa.and.returnValue(refused(409, { code: 'ACCOUNT_OWNER_PROTECTED' }));
      open('reset');
      click('[data-two-step-reset-confirm]');
      expect(text()).toContain("The account owner's two-step sign-in can't be reset here.");
      expect(text()).not.toContain('signs them out everywhere');
      expect(q('[data-two-step-reset-confirm]')).toBeNull();
      expect(q('[data-two-step-reset-close]')).not.toBeNull();
    });

    it('already off: blue, only Close, and closing re-reads the record', () => {
      users.resetMfa.and.returnValue(refused(409, { code: 'MFA_NOT_ENABLED' }));
      open('reset');
      click('[data-two-step-reset-confirm]');
      expect(q('[data-two-step-reset-message] [role="status"]')?.textContent).toContain(
        'Two-step sign-in is already off for this person.',
      );
      click('[data-two-step-reset-close]');
      expect(host.stale).toBeTrue();
      expect(host.visible()).toBeFalse();
    });

    it('signed in as someone else: the fallback refusal', () => {
      users.resetMfa.and.returnValue(refused(409, { code: 'MFA_RESET_IMPERSONATING' }));
      open('reset');
      click('[data-two-step-reset-confirm]');
      expect(text()).toContain("This can't be done while signed in as someone else.");
    });

    it('unreachable: Reset stays, and pressing it again retries', () => {
      users.resetMfa.and.returnValues(throwError(() => new HttpErrorResponse({ status: 0 })), of(undefined));
      open('reset');
      click('[data-two-step-reset-confirm]');
      expect(text()).toContain("We couldn't reach AccreditMe.");
      click('[data-two-step-reset-confirm]');
      expect(users.resetMfa).toHaveBeenCalledTimes(2);
      expect(host.done).toBeTrue();
    });

    it('while sending: Cancel disabled and Escape ignored', () => {
      const pending = new Subject<void>();
      users.resetMfa.and.returnValue(pending);
      open('reset');
      click('[data-two-step-reset-confirm]');
      expect(q<HTMLButtonElement>('[data-two-step-reset-cancel] button')!.disabled).toBeTrue();
      escape();
      expect(host.visible()).toBeTrue();
    });
  });
});
