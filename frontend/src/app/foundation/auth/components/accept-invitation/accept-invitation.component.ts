import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Location } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { Subscription } from 'rxjs';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService, InvitationOrganization } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import {
  REQUEST_TIMEOUT_MS,
  SKELETON_DELAY_MS,
} from '../../../../core/request-outcome/request-outcome';
import { FieldComponent } from '../../../../shared/components/field/field.component';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

/** Better Auth's limits on a sign-up password (create-context.mjs, 8 and 128). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** What the login page reads from the navigation state, once. */
export const INVITATION_ACCEPTED_NOTICE = 'invitationAccepted';

type Lookup =
  | { readonly status: 'pending' }
  | { readonly status: 'ready'; readonly organization: InvitationOrganization }
  | { readonly status: 'invalid' }
  | { readonly status: 'failed' };

/** First Strong Isolate … Pop Directional Isolate: `<bdi>` for text inside a translated sentence. */
const isolate = (text: string): string => `\u2068${text}\u2069`;

/**
 * Accept invitation — ACC-120 slice 9e, Template 7 without the logo, the
 * inviter's details, the name fields, the consent box and the resend timer.
 *
 * THE TOKEN IS READ ONCE AND THEN LEAVES THE ADDRESS BAR. It is kept in memory
 * for the two requests and replaced out of the URL, so it is not left in the
 * browser's history or on a screen someone else can see. A refresh therefore
 * shows the invalid state; that is accepted.
 *
 * NO FORM UNTIL THE LOOKUP HAS SAID THE INVITATION IS OPEN, so nobody types a
 * password into a dead link. Every INVITATION_INVALID — from the lookup or
 * from accept — is the same state, with no form and no reason: the backend
 * refuses them all identically (slice 9c), and the screen does not invent a
 * distinction it was not given.
 */
@Component({
  selector: 'app-accept-invitation',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    PasswordModule,
    ButtonModule,
    MessageModule,
    FieldComponent,
    AuthLayoutComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout>
      @switch (lookup().status) {
        @case ('ready') {
          <h1 class="text-heading font-semibold">
            {{ 'auth.invitation.join' | translate: { organization: organizationName() } }}
          </h1>
          <p class="text-body">{{ 'auth.invitation.intro' | translate }}</p>

          <form
            [formGroup]="form"
            (ngSubmit)="onSubmit()"
            novalidate
            class="flex flex-col gap-4"
          >
            <am-field
              [label]="'auth.invitation.passwordLabel' | translate"
              inputId="password"
              [control]="form.controls.password"
              [hint]="'auth.invitation.passwordHint' | translate"
              [errorMessages]="passwordErrors"
            >
              <p-password
                inputId="password"
                formControlName="password"
                autocomplete="new-password"
                [feedback]="false"
                [toggleMask]="true"
                styleClass="w-full"
                inputStyleClass="w-full"
              />
            </am-field>

            @if (submitError(); as message) {
              <p-message severity="error" [text]="message | translate" />
            }

            <p-button
              type="submit"
              [label]="'auth.invitation.submit' | translate"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        }
        @case ('invalid') {
          <h1 class="text-heading font-semibold">
            {{ 'auth.invitation.invalidTitle' | translate }}
          </h1>
          <p class="text-body">{{ 'auth.invitation.invalidBody' | translate }}</p>
        }
        @case ('failed') {
          <h1 class="text-heading font-semibold">{{ 'auth.invitation.title' | translate }}</h1>
          <p-message severity="error" [text]="'auth.invitation.lookupFailed' | translate" />
          <p-button
            [label]="'common.retry' | translate"
            [outlined]="true"
            styleClass="w-full"
            (onClick)="retryLookup()"
          />
        }
        @default {
          <!-- Before 200ms: the card shell alone, because a skeleton that
               flashes for a fast answer is noise. After 8s: say so, and offer
               a retry rather than an indefinite shimmer. -->
          @if (slow()) {
            <h1 class="text-heading font-semibold">{{ 'auth.invitation.title' | translate }}</h1>
            <p class="text-body" role="status">{{ 'auth.invitation.slow' | translate }}</p>
            <p-button
              [label]="'common.retry' | translate"
              [outlined]="true"
              styleClass="w-full"
              (onClick)="retryLookup()"
            />
          } @else if (showSkeleton()) {
            <div class="flex flex-col gap-3" aria-busy="true" data-testid="lookup-skeleton">
              <span class="am-skeleton-bar w-3/4"></span>
              <span class="am-skeleton-bar w-full"></span>
              <span class="am-skeleton-bar w-1/2"></span>
            </div>
          }
        }
      }
    </app-auth-layout>
  `,
})
export class AcceptInvitationComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly languageService = inject(LanguageService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);

  /** In memory only — see the class comment. */
  private readonly token: string | null;

  readonly lookup = signal<Lookup>({ status: 'pending' });
  readonly showSkeleton = signal(false);
  readonly slow = signal(false);
  readonly submitting = signal(false);
  /** A translation key for a failure that is not about the password's content. */
  readonly submitError = signal<string | null>(null);

  readonly form = this.fb.group({
    password: [
      '',
      [
        Validators.required,
        Validators.minLength(PASSWORD_MIN_LENGTH),
        Validators.maxLength(PASSWORD_MAX_LENGTH),
      ],
    ],
  });

  protected readonly passwordErrors = {
    required: 'auth.invitation.passwordRequired',
    minlength: 'auth.invitation.passwordTooShort',
    maxlength: 'auth.invitation.passwordTooLong',
    compromised: 'auth.invitation.passwordCompromised',
  };

  /** ACC-160 — Arabic when there is one, English otherwise; isolated inside the sentence. */
  protected readonly organizationName = computed(() => {
    const state = this.lookup();
    if (state.status !== 'ready') return '';
    const { name, nameAr } = state.organization;
    return isolate(this.languageService.bilingual(name, nameAr));
  });

  private lookupSubscription: Subscription | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    const route = inject(ActivatedRoute);
    this.token = route.snapshot.queryParamMap.get('token');
    this.destroyRef.onDestroy(() => this.stopLookup());

    if (!this.token) {
      this.lookup.set({ status: 'invalid' });
      return;
    }
    this.location.replaceState(this.location.path().split('?')[0]);
    this.startLookup();
  }

  retryLookup(): void {
    this.startLookup();
  }

  onSubmit(): void {
    const control = this.form.controls.password;
    if (this.form.invalid || !this.token || this.submitting()) return;
    this.submitting.set(true);
    this.submitError.set(null);

    this.authService.acceptInvitation(this.token, control.value ?? '').subscribe({
      next: () => {
        this.submitting.set(false);
        void this.router.navigate(['/login'], {
          state: { notice: INVITATION_ACCEPTED_NOTICE },
        });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.showAcceptFailure(err);
      },
    });
  }

  private startLookup(): void {
    this.stopLookup();
    this.lookup.set({ status: 'pending' });
    this.showSkeleton.set(false);
    this.slow.set(false);
    this.timers = [
      setTimeout(() => this.showSkeleton.set(true), SKELETON_DELAY_MS),
      setTimeout(() => this.slow.set(true), REQUEST_TIMEOUT_MS),
    ];
    this.lookupSubscription = this.authService.lookupInvitation(this.token!).subscribe({
      next: (organization) => {
        this.clearTimers();
        this.lookup.set({ status: 'ready', organization });
      },
      error: (err: unknown) => {
        this.clearTimers();
        this.lookup.set({ status: refusalCode(err) === 'INVITATION_INVALID' ? 'invalid' : 'failed' });
      },
    });
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

  /** Each accept refusal to where it belongs: the whole screen, the field, or one message. */
  private showAcceptFailure(err: unknown): void {
    const control = this.form.controls.password;
    switch (refusalCode(err)) {
      case 'INVITATION_INVALID':
        this.lookup.set({ status: 'invalid' });
        return;
      case 'PASSWORD_COMPROMISED':
        control.setErrors({ compromised: true });
        control.markAsTouched();
        return;
      case 'PASSWORD_TOO_SHORT':
        control.setErrors({ minlength: true });
        control.markAsTouched();
        return;
      case 'PASSWORD_TOO_LONG':
        control.setErrors({ maxlength: true });
        control.markAsTouched();
        return;
      case 'PASSWORD_CHECK_UNAVAILABLE':
        this.submitError.set('auth.invitation.errorCheckUnavailable');
        return;
    }
    if (err instanceof HttpErrorResponse && err.status === 409) {
      this.submitError.set('auth.invitation.errorConflict');
      return;
    }
    this.submitError.set('auth.invitation.errorGeneric');
  }
}

/** The stable `code` an AccreditMe refusal carries in its body, if any. */
function refusalCode(err: unknown): string | null {
  if (!(err instanceof HttpErrorResponse)) return null;
  const body: unknown = err.error;
  if (body && typeof body === 'object' && 'code' in body && typeof body.code === 'string') {
    return body.code;
  }
  return null;
}
