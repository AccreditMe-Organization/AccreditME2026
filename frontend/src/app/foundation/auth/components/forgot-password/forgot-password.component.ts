import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';
import { refusalCode } from '../../../../core/http/refusal';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { focusFirstInvalid } from '../../../../shared/components/field/reveal-errors';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';
import { NoOrganisationAddressComponent } from '../no-organisation-address/no-organisation-address.component';

/** Marks where the address sits in the translated "sent" sentence. */
const EMAIL_SLOT = '\u0000';

/**
 * Forgot password — ACC-188, the form restored ("AccreditMe Sign-in Pages",
 * section 3). Reached from "Forgot password?" on Sign in and from the new-IP
 * email; the email is never prefilled.
 *
 * THE CONFIRMATION IS THE SAME FOR EVERY ADDRESS. The server answers a real and
 * an unknown address identically, and so does this page: it never says whether
 * an account exists. There is no "Send again": the note says plainly that
 * asking again replaces the earlier link.
 *
 * Pressing the button again is the retry, after a 429 or an unreachable server;
 * there is no separate Retry on this form (decided, 14 Nov). What was typed is
 * always kept.
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    InputTextModule,
    ButtonModule,
    MessageModule,
    FieldComponent,
    AuthLayoutComponent,
    NoOrganisationAddressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ACC-139 — the organisation is the address; see LoginComponent. -->
    @if (!organizationSlug) {
      <app-no-organisation-address titleKey="auth.forgotPasswordTitle" />
    } @else {
      <app-auth-layout>
        @if (sentTo(); as address) {
          <h1 class="text-heading font-semibold">{{ 'auth.forgot.sentTitle' | translate }}</h1>
          <p class="text-body" data-testid="forgot-sent" role="status">
            {{ sentSentence()[0] }}<bdi dir="ltr" class="font-semibold break-all">{{ address }}</bdi>{{ sentSentence()[1] }}
          </p>
          <p class="text-meta text-ink-500">{{ 'auth.forgot.sentNote' | translate }}</p>
          <a routerLink="/login" class="text-sm underline self-center">
            {{ 'auth.signIn.backToSignIn' | translate }}
          </a>
        } @else {
          <h1 class="text-heading font-semibold">{{ 'auth.forgotPasswordTitle' | translate }}</h1>
          <p class="text-body">{{ 'auth.forgot.intro' | translate }}</p>

          <form [formGroup]="form" (ngSubmit)="onSubmit()" novalidate class="flex flex-col gap-4">
            <am-field
              [label]="'auth.email' | translate"
              inputId="email"
              [control]="form.controls.email"
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

            @if (failure(); as key) {
              <p-message data-testid="forgot-failure" severity="error" [text]="key | translate" />
            }

            <p-button
              type="submit"
              [label]="'auth.forgot.submit' | translate"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>

          <a routerLink="/login" class="text-sm underline self-center">
            {{ 'auth.signIn.backToSignIn' | translate }}
          </a>
        }
      </app-auth-layout>
    }
  `,
})
export class ForgotPasswordComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly translate = inject(TranslateService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** ACC-139 — the organisation this address names, or null for none. */
  protected readonly organizationSlug = inject(TenantHostService).slug;

  readonly submitting = signal(false);
  /** The address the confirmation names, as typed; null until sent. */
  readonly sentTo = signal<string | null>(null);
  /** A translation key for a failure about no field, above the button. */
  readonly failure = signal<string | null>(null);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  /** Sign in's own email lines, so a person sees the same words on both pages. */
  protected readonly emailErrors = {
    required: 'auth.signIn.emailRequired',
    email: 'auth.signIn.emailInvalid',
  };

  private readonly language = toSignal(this.translate.onLangChange, { initialValue: null });

  /** The sentence around the address, so the address can be its own isolate. */
  protected readonly sentSentence = computed((): [string, string] => {
    this.language();
    const text = this.translate.instant('auth.forgot.sentBody', { email: EMAIL_SLOT }) as string;
    const [before = '', after = ''] = text.split(EMAIL_SLOT);
    return [before, after];
  });

  onSubmit(): void {
    if (this.submitting()) return;
    if (this.form.invalid) {
      focusFirstInvalid(this.form, this.host);
      return;
    }
    const email = (this.form.controls.email.value ?? '').trim();
    this.submitting.set(true);
    this.failure.set(null);
    this.form.disable();

    this.authService.forgotPassword(email).subscribe({
      next: () => {
        this.submitting.set(false);
        this.form.enable();
        this.sentTo.set(email);
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.form.enable();
        this.failure.set(
          refusalCode(err) === 'RATE_LIMITED' ? 'auth.recovery.rateLimited' : 'auth.recovery.unreachable',
        );
      },
    });
  }
}
