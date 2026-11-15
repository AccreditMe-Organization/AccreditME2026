import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';
import { refusalCode } from '../../../../core/http/refusal';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import {
  REQUEST_TIMEOUT_MS,
  SKELETON_DELAY_MS,
} from '../../../../core/request-outcome/request-outcome';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { focusFirstInvalid } from '../../../../shared/components/field/reveal-errors';
import { PasswordInputComponent } from '../../../../shared/components/password-input/password-input.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';
import { NoOrganisationAddressComponent } from '../no-organisation-address/no-organisation-address.component';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../accept-invitation/accept-invitation.component';

/** What Sign in reads from the navigation state, once (ACC-188). */
export const PASSWORD_RESET_NOTICE = 'passwordReset';

/** The page's state: the link being checked, the form, or why the link is dead. */
export type ResetView =
  | 'checking'
  | 'checkFailed'
  | 'open'
  | 'expired'
  | 'used'
  | 'replaced'
  | 'invalid';

const DEAD_LINK: Readonly<Record<string, ResetView>> = {
  RESET_LINK_EXPIRED: 'expired',
  RESET_LINK_USED: 'used',
  RESET_LINK_REPLACED: 'replaced',
  RESET_LINK_INVALID: 'invalid',
};

/**
 * Reset password — ACC-188 ("AccreditMe Sign-in Pages", section 4). Opened
 * from the reset email.
 *
 * THE TOKEN IS READ ONCE AND LEAVES THE ADDRESS BAR, as on Accept invitation:
 * kept in memory for the two requests, so it is not left in history or on a
 * screen someone else can see. A refresh therefore shows the invalid-link
 * state; that is accepted.
 *
 * NO FORM UNTIL THE LINK HAS BEEN CHECKED, so nobody types a password into a
 * dead link. A dead link has no form: each says what happened and offers the
 * one useful next step. Retry exists only while the link is being checked; on
 * the form, pressing the button again is the retry (decided, 14 Nov).
 *
 * Success never signs anyone in: it goes to Sign in, which shows the notice
 * once. The person signs in with the new password, then MFA if they have it.
 */
@Component({
  selector: 'app-reset-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    ButtonModule,
    MessageModule,
    FieldComponent,
    PasswordInputComponent,
    AuthLayoutComponent,
    NoOrganisationAddressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!organizationSlug) {
      <app-no-organisation-address titleKey="auth.reset.title" />
    } @else {
      <app-auth-layout>
        @switch (view()) {
          @case ('open') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.title' | translate }}</h1>
            <p class="text-body">{{ 'auth.reset.intro' | translate }}</p>

            <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate class="flex flex-col gap-4">
              <am-field
                [label]="'auth.reset.newPassword' | translate"
                inputId="new-password"
                [control]="form.controls.password"
                [hint]="'auth.invitation.passwordHint' | translate"
                [errorMessages]="passwordErrors"
              >
                <am-password-input
                  inputId="new-password"
                  formControlName="password"
                  autocomplete="new-password"
                />
              </am-field>

              <am-field
                [label]="'auth.reset.confirm' | translate"
                inputId="confirm-password"
                [control]="form.controls.confirm"
                [errorMessages]="confirmErrors"
              >
                <am-password-input
                  inputId="confirm-password"
                  formControlName="confirm"
                  autocomplete="new-password"
                />
              </am-field>

              @if (failure(); as key) {
                <p-message data-testid="reset-failure" severity="error" [text]="key | translate" />
              }

              <p-button
                type="submit"
                [label]="'auth.reset.submit' | translate"
                [loading]="submitting()"
                styleClass="w-full"
              />
            </form>
          }
          @case ('expired') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.expiredTitle' | translate }}</h1>
            <p class="text-body">{{ 'auth.reset.expiredBody' | translate }}</p>
            <p-button
              [label]="'auth.reset.sendNewLink' | translate"
              styleClass="w-full"
              (onClick)="go('/forgot-password')"
            />
            <a routerLink="/login" class="text-sm underline self-center">
              {{ 'auth.signIn.backToSignIn' | translate }}
            </a>
          }
          @case ('used') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.usedTitle' | translate }}</h1>
            <p class="text-body">{{ 'auth.reset.usedBody' | translate }}</p>
            <p-button [label]="'auth.login' | translate" styleClass="w-full" (onClick)="go('/login')" />
            <a routerLink="/forgot-password" class="text-sm underline self-center">
              {{ 'auth.forgotPassword' | translate }}
            </a>
          }
          @case ('replaced') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.replacedTitle' | translate }}</h1>
            <p class="text-body">{{ 'auth.reset.replacedBody' | translate }}</p>
            <p-button
              [label]="'auth.signIn.backToSignIn' | translate"
              styleClass="w-full"
              (onClick)="go('/login')"
            />
          }
          @case ('invalid') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.invalidTitle' | translate }}</h1>
            <p class="text-body">{{ 'auth.reset.invalidBody' | translate }}</p>
            <p-button
              [label]="'auth.reset.sendNewLink' | translate"
              styleClass="w-full"
              (onClick)="go('/forgot-password')"
            />
            <a routerLink="/login" class="text-sm underline self-center">
              {{ 'auth.signIn.backToSignIn' | translate }}
            </a>
          }
          @case ('checkFailed') {
            <h1 class="text-heading font-semibold">{{ 'auth.reset.title' | translate }}</h1>
            <p-message data-testid="check-failed" severity="error" [text]="checkFailure() | translate" />
            <p-button
              [label]="'common.retry' | translate"
              [outlined]="true"
              styleClass="w-full"
              (onClick)="startLookup()"
            />
          }
          @default {
            <!-- Checking the link. Before 200ms the card shell alone; then the
                 form's shape as a skeleton; after 8s a line and Retry. -->
            @if (slow()) {
              <h1 class="text-heading font-semibold">{{ 'auth.reset.title' | translate }}</h1>
              <p class="text-body" role="status">{{ 'auth.invitation.slow' | translate }}</p>
              <p-button
                [label]="'common.retry' | translate"
                [outlined]="true"
                styleClass="w-full"
                (onClick)="startLookup()"
              />
            } @else if (showSkeleton()) {
              <div class="flex flex-col gap-3" aria-busy="true" data-testid="reset-skeleton">
                <span class="am-skeleton-bar w-3/5"></span>
                <span class="am-skeleton-bar w-full"></span>
                <span class="am-skeleton-bar w-4/5"></span>
                <span class="am-skeleton-bar w-full h-[38px]"></span>
                <span class="am-skeleton-bar w-full h-[38px]"></span>
                <span class="am-skeleton-bar w-full h-[38px]"></span>
              </div>
            }
          }
        }
      </app-auth-layout>
    }
  `,
})
export class ResetPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** ACC-139 — the organisation this address names, or null for none. */
  protected readonly organizationSlug = inject(TenantHostService).slug;

  /** In memory only — see the class comment. */
  private readonly token: string | null;

  readonly view = signal<ResetView>('checking');
  readonly showSkeleton = signal(false);
  readonly slow = signal(false);
  readonly submitting = signal(false);
  /** Why checking the link failed: the server out of reach, or too many attempts. */
  readonly checkFailure = signal('auth.recovery.unreachable');
  /** A translation key for a failure about no field, above the button. */
  readonly failure = signal<string | null>(null);

  readonly form = this.fb.group({
    password: [
      '',
      [Validators.required, Validators.minLength(PASSWORD_MIN_LENGTH), Validators.maxLength(PASSWORD_MAX_LENGTH)],
    ],
    confirm: ['', [Validators.required]],
  });

  /** Accept invitation's lines, word for word (the product's strings win). */
  protected readonly passwordErrors = {
    required: 'auth.invitation.passwordRequired',
    minlength: 'auth.invitation.passwordTooShort',
    maxlength: 'auth.invitation.passwordTooLong',
    compromised: 'auth.invitation.passwordCompromised',
  };
  protected readonly confirmErrors = {
    required: 'auth.reset.confirmRequired',
    mismatch: 'auth.reset.mismatch',
  };

  private lookupSubscription: Subscription | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    this.token = inject(ActivatedRoute).snapshot.queryParamMap.get('token');
    inject(DestroyRef).onDestroy(() => this.stopLookup());
    if (!this.organizationSlug) return;
    if (!this.token) {
      this.view.set('invalid');
      return;
    }
    this.location.replaceState(this.location.path().split('?')[0] ?? '/reset-password');
    this.startLookup();
  }

  go(path: '/login' | '/forgot-password'): void {
    void this.router.navigate([path]);
  }

  startLookup(): void {
    this.stopLookup();
    this.view.set('checking');
    this.showSkeleton.set(false);
    this.slow.set(false);
    this.timers = [
      setTimeout(() => this.showSkeleton.set(true), SKELETON_DELAY_MS),
      setTimeout(() => this.slow.set(true), REQUEST_TIMEOUT_MS),
    ];
    this.lookupSubscription = this.authService.lookupResetLink(this.token ?? '').subscribe({
      next: () => {
        this.clearTimers();
        this.view.set('open');
      },
      error: (err: unknown) => {
        this.clearTimers();
        const code = refusalCode(err);
        const dead = code ? DEAD_LINK[code] : undefined;
        if (dead) {
          this.view.set(dead);
          return;
        }
        this.checkFailure.set(code === 'RATE_LIMITED' ? 'auth.recovery.rateLimited' : 'auth.recovery.unreachable');
        this.view.set('checkFailed');
      },
    });
  }

  onSubmit(): void {
    if (this.submitting() || !this.token) return;
    if (this.form.invalid) {
      focusFirstInvalid(this.form, this.host);
      return;
    }
    const { password, confirm } = this.form.getRawValue();
    // Checked on submit only (decided, 14 Nov), like every other error here.
    if (password !== confirm) {
      this.refuse('confirm', { mismatch: true });
      return;
    }
    this.submitting.set(true);
    this.failure.set(null);
    this.form.disable();

    this.authService.resetPassword(this.token, password ?? '').subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigate(['/login'], { state: { notice: PASSWORD_RESET_NOTICE } });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.form.enable();
        this.showResetFailure(err);
      },
    });
  }

  /** Each refusal to where it belongs: the whole page, a field, or one message. */
  private showResetFailure(err: unknown): void {
    const code = refusalCode(err);
    const dead = code ? DEAD_LINK[code] : undefined;
    if (dead) {
      this.view.set(dead);
      return;
    }
    switch (code) {
      case 'PASSWORD_COMPROMISED':
        this.refuse('password', { compromised: true });
        return;
      case 'PASSWORD_TOO_SHORT':
        this.refuse('password', { minlength: true });
        return;
      case 'PASSWORD_TOO_LONG':
        this.refuse('password', { maxlength: true });
        return;
      case 'PASSWORD_CHECK_UNAVAILABLE':
        this.failure.set('auth.reset.checkUnavailable');
        return;
      case 'RATE_LIMITED':
        this.failure.set('auth.recovery.rateLimited');
        return;
    }
    this.failure.set('auth.recovery.unreachable');
  }

  private refuse(field: 'password' | 'confirm', errors: Record<string, true>): void {
    const control = this.form.controls[field];
    control.setErrors(errors);
    control.markAsTouched();
    focusFirstInvalid(this.form, this.host);
  }

  private stopLookup(): void {
    this.clearTimers();
    this.lookupSubscription?.unsubscribe();
    this.lookupSubscription = null;
  }

  private clearTimers(): void {
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.slow.set(false);
    this.showSkeleton.set(false);
  }
}
