import { Component, ElementRef, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';
import { LANDING_ROUTE } from '../../../../core/navigation/landing-route';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { FormatService } from '../../../../core/formatting/format.service';
import { INVITATION_ACCEPTED_NOTICE } from '../accept-invitation/accept-invitation.component';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { NoOrganisationAddressComponent } from '../no-organisation-address/no-organisation-address.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { focusFirstInvalid } from '../../../../shared/components/field/reveal-errors';
import { PasswordInputComponent } from '../../../../shared/components/password-input/password-input.component';
import { SIGN_IN_REFUSAL_KEYS, SignInRefusal, describeSignInRefusal } from './sign-in-refusal';

/**
 * Sign in — ACC-120 slice 9d, Template 7 · third screen, on the auth layout
 * Accept invitation uses (slice 9e).
 *
 * The organisation is the address (ACC-139): there is no organisation field,
 * and an address that names none shows the note instead of a form.
 *
 * EACH REFUSAL HAS ITS OWN SENTENCE (sign-in-refusal.ts), in the one message
 * slot above Sign in, replacing the last. A wrong MFA code is the exception:
 * it sits on the code field, which stays filled.
 *
 * THE MFA STEP IS RESTYLED, NOT CHANGED: the same form, the same request, and
 * no "Start again" (CC-62, answer 3).
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    NoOrganisationAddressComponent,
    AuthLayoutComponent,
    FieldComponent,
    PasswordInputComponent,
  ],
  template: `
    <!-- ACC-139 — the organisation is the address. One that names none gets a
         note saying where to go, and no form. -->
    @if (!organizationSlug) {
      <app-no-organisation-address titleKey="auth.login" />
    } @else {
      <app-auth-layout>
        <h1 class="text-heading font-semibold">{{ 'auth.login' | translate }}</h1>

        <!-- ACC-122 — why they are looking at this page. Without it, an idle
             sign-out is indistinguishable from the session simply breaking,
             which is what the 15-minute bug felt like. -->
        @if (signedOutForIdle) {
          <p-message severity="info" [text]="'session.signedOutIdle' | translate" />
        }

        <!-- ACC-120 slice 9e — arriving from Accept invitation. -->
        @if (invitationAccepted) {
          <!-- p-message hard-codes role="alert" with aria-live="polite", which
               conflict: alert is assertive. This is a status, so the binding
               replaces the role (bindings apply after host attributes) and
               the polite live region stays. -->
          <p-message
            severity="success"
            [attr.role]="'status'"
            [text]="'auth.invitation.acceptedNotice' | translate"
          />
        }

        @if (!mfaRequired()) {
          <form
            [formGroup]="loginForm"
            (ngSubmit)="onSubmitLogin()"
            novalidate
            class="flex flex-col gap-4"
          >
            <am-field
              [label]="'auth.email' | translate"
              inputId="email"
              [control]="loginForm.controls.email"
              [errorMessages]="emailErrors"
            >
              <input
                pInputText
                id="email"
                type="email"
                formControlName="email"
                autocomplete="username"
                class="w-full"
              />
            </am-field>

            <am-field
              [label]="'auth.password' | translate"
              inputId="password"
              [control]="loginForm.controls.password"
              [errorMessages]="passwordErrors"
            >
              <am-password-input
                inputId="password"
                formControlName="password"
                autocomplete="current-password"
              />
            </am-field>

            <a routerLink="/forgot-password" class="text-sm underline self-start">
              {{ 'auth.forgotPassword' | translate }}
            </a>

            @if (slotMessage(); as message) {
              <p-message
                data-testid="sign-in-message"
                [severity]="message.look"
                [text]="message.text"
              />
            }

            <p-button
              type="submit"
              [label]="'auth.login' | translate"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        } @else {
          <form
            [formGroup]="mfaForm"
            (ngSubmit)="onSubmitMfa()"
            novalidate
            class="flex flex-col gap-4"
          >
            <am-field
              [label]="'auth.mfaCode' | translate"
              inputId="code"
              [control]="mfaForm.controls.code"
              [hint]="'auth.signIn.mfaHint' | translate"
              [errorMessages]="codeErrors"
            >
              <input
                pInputText
                id="code"
                formControlName="code"
                maxlength="6"
                inputmode="numeric"
                autocomplete="one-time-code"
                class="w-full"
              />
            </am-field>

            @if (slotMessage(); as message) {
              <p-message
                data-testid="sign-in-message"
                [severity]="message.look"
                [text]="message.text"
              />
            }

            <p-button
              type="submit"
              [label]="'auth.login' | translate"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        }
      </app-auth-layout>
    }
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly navigationAccessService = inject(NavigationAccessService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** ACC-139 — the organisation this address names, or null for none. */
  protected readonly organizationSlug = inject(TenantHostService).slug;

  /** Set when the idle rule ended the last session (IdleService). */
  protected readonly signedOutForIdle =
    this.route.snapshot.queryParamMap.get('reason') === 'idle';

  /**
   * ACC-120 slice 9e — set by the navigation that brought them here from
   * Accept invitation. Navigation STATE rather than a query parameter, so
   * nothing is left in the address bar to bookmark.
   *
   * SHOWN ONCE, WHICH STATE ALONE DOES NOT GIVE: the browser keeps
   * history.state across a reload, and Angular hands it back to the reloaded
   * page's navigation as `extras.state`, so the notice reappeared on every
   * refresh of /login. Once read, it is removed from the current history entry
   * (see clearNotice()).
   */
  protected readonly invitationAccepted =
    this.router.currentNavigation()?.extras.state?.['notice'] === INVITATION_ACCEPTED_NOTICE;

  private readonly location = inject(Location);

  readonly submitting = signal(false);
  readonly mfaRequired = signal(false);
  /** The last refusal, or null. A new submit clears it. */
  readonly refusal = signal<SignInRefusal | null>(null);

  readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly mfaForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
  });

  protected readonly emailErrors = {
    required: 'auth.signIn.emailRequired',
    email: 'auth.signIn.emailInvalid',
  };
  protected readonly passwordErrors = { required: 'auth.signIn.passwordRequired' };
  protected readonly codeErrors = {
    required: 'auth.signIn.codeRequired',
    minlength: 'auth.signIn.codeRequired',
    maxlength: 'auth.signIn.codeRequired',
    mfaInvalid: SIGN_IN_REFUSAL_KEYS.mfaInvalid,
  };

  /**
   * What the message slot says. A computed over the refusal, the language and
   * the formatting layer, so "in 14 minutes" follows a language switch. A wrong
   * MFA code puts its sentence on the field instead, and the slot carries only
   * the attempts left, at 1 or 2.
   */
  protected readonly slotMessage = computed(() => {
    const refusal = this.refusal();
    if (!refusal) return null;
    if (refusal.onCodeField) {
      if (refusal.attemptsLeft === null) return null;
      return { look: 'warn' as const, text: this.format.count('auth.mfaAttemptsLeft', refusal.attemptsLeft) };
    }
    const when = refusal.until ? this.format.relative(refusal.until, refusal.at) : '';
    return { look: refusal.look, text: this.translate.instant(refusal.key, { when }) as string };
  });

  constructor() {
    if (this.invitationAccepted) this.clearNotice();
  }

  /**
   * Drops the notice from the current history entry, keeping everything else
   * in it — the router's own navigationId and page id live there too.
   *
   * Safe in the constructor: the router writes this entry (URL and state) at
   * BeforeActivateRoutes, before any routed component is created
   * (HistoryStateManager in @angular/router 21), so this replaces /login's own
   * entry rather than the one before it.
   */
  private clearNotice(): void {
    const state = this.location.getState();
    if (!state || typeof state !== 'object' || !('notice' in state)) return;
    const { notice: _, ...rest } = state as Record<string, unknown>;
    this.location.replaceState(this.location.path(true), '', rest);
  }

  onSubmitLogin(): void {
    if (this.loginForm.invalid) {
      // am-field reveals the errors on submit; focus goes to the first one.
      focusFirstInvalid(this.loginForm, this.host);
      return;
    }
    this.submitting.set(true);
    this.refusal.set(null);

    const { email, password } = this.loginForm.getRawValue();
    this.authService.login(email!, password!).subscribe({
      next: (result) => {
        this.submitting.set(false);
        if (result.mfaRequired) {
          this.mfaRequired.set(true);
          return;
        }
        this.redirectAfterLogin();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.refusal.set(describeSignInRefusal(err, 'password'));
      },
    });
  }

  onSubmitMfa(): void {
    if (this.mfaForm.invalid) {
      focusFirstInvalid(this.mfaForm, this.host);
      return;
    }
    this.submitting.set(true);
    this.refusal.set(null);

    const { code } = this.mfaForm.getRawValue();
    this.authService.verifyMfa(code!).subscribe({
      next: () => {
        this.submitting.set(false);
        this.redirectAfterLogin();
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        const refusal = describeSignInRefusal(err, 'mfa');
        this.refusal.set(refusal);
        if (refusal.onCodeField) {
          // On the field, which stays filled: retyping replaces the code.
          const control = this.mfaForm.controls.code;
          control.setErrors({ mfaInvalid: true });
          control.markAsTouched();
          focusFirstInvalid(this.mfaForm, this.host);
        }
      },
    });
  }

  // Same isPlatformAdmin() check platformAdminGuard uses server-adjacent —
  // loaded here (rather than trusting a stale/default signal) since this is
  // the very first point in the session where it's known which org the user
  // just authenticated into. AppShellComponent's own ngOnInit calls
  // loadAccess() again on mount; a second cheap GET is an acceptable
  // trade-off against duplicating the role-check logic in a second place.
  private redirectAfterLogin(): void {
    this.navigationAccessService.loadAccess().subscribe(() => {
      // ACC-70 — LANDING_ROUTE, not '/organization'. Sending every user to an
      // admin screen meant a user without org:view landed on a page they could
      // not use; the landing page is reachable regardless of permissions.
      // ACC-122 — back to where they were, when we know where that was.
      //
      // Only ever an in-app path: returnUrl arrives in the query string, so
      // it is attacker-supplied, and navigating to whatever it says would be
      // an open redirect. A value that does not start with a single '/' is
      // discarded, which rules out '//evil.test' and 'https://evil.test'
      // alike. The login page itself is discarded too, or signing in would
      // land the user straight back on it.
      const requested = this.route.snapshot.queryParamMap.get('returnUrl');
      const safeReturn =
        requested && /^\/(?!\/)/.test(requested) && !requested.startsWith('/login')
          ? requested
          : null;

      if (safeReturn) {
        void this.router.navigateByUrl(safeReturn);
        return;
      }

      const destination = this.navigationAccessService.isPlatformAdmin() ? '/platform' : LANDING_ROUTE;
      void this.router.navigate([destination]);
    });
  }
}
