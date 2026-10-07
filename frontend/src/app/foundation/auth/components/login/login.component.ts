import { Component, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { PasswordModule } from 'primeng/password';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { AuthService } from '../../../../core/services/auth.service';
import { LANDING_ROUTE } from '../../../../core/navigation/landing-route';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { INVITATION_ACCEPTED_NOTICE } from '../accept-invitation/accept-invitation.component';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { NoOrganisationAddressComponent } from '../no-organisation-address/no-organisation-address.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    TranslatePipe,
    InputTextModule,
    PasswordModule,
    ButtonModule,
    MessageModule,
    NoOrganisationAddressComponent,
  ],
  template: `
    <!-- ACC-139 — the organisation is the address. One that names none gets a
         note saying where to go, and no form. -->
    @if (!organizationSlug) {
      <app-no-organisation-address titleKey="auth.login" />
    } @else {
    <div class="flex items-center justify-center min-h-screen p-6">
      <div class="flex flex-col gap-6 w-full max-w-sm">
        <h1 class="text-xl font-semibold text-center">{{ 'auth.login' | translate }}</h1>

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

        @if (error()) {
          <p-message severity="error" [text]="error()! | translate" />
        }

        @if (!mfaRequired()) {
          <form [formGroup]="loginForm" (ngSubmit)="onSubmitLogin()" class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <label for="email" class="text-sm font-medium">{{ 'auth.email' | translate }}</label>
              <input pInputText id="email" type="email" formControlName="email" />
            </div>

            <div class="flex flex-col gap-1">
              <label for="password" class="text-sm font-medium">{{ 'auth.password' | translate }}</label>
              <p-password
                inputId="password"
                formControlName="password"
                [feedback]="false"
                [toggleMask]="true"
                styleClass="w-full"
              />
            </div>

            <p-button
              [label]="'auth.login' | translate"
              type="submit"
              [loading]="submitting()"
              styleClass="w-full"
            />

            <a routerLink="/forgot-password" class="text-sm text-center underline">
              {{ 'auth.forgotPassword' | translate }}
            </a>
          </form>
        } @else {
          <form [formGroup]="mfaForm" (ngSubmit)="onSubmitMfa()" class="flex flex-col gap-4">
            <div class="flex flex-col gap-1">
              <label for="code" class="text-sm font-medium">{{ 'auth.mfaCode' | translate }}</label>
              <input pInputText id="code" formControlName="code" maxlength="6" />
            </div>

            <p-button
              [label]="'auth.login' | translate"
              type="submit"
              [loading]="submitting()"
              styleClass="w-full"
            />
          </form>
        }
      </div>
    </div>
    }
  `,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly navigationAccessService = inject(NavigationAccessService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

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
  readonly error = signal<string | null>(null);
  readonly mfaRequired = signal(false);

  readonly loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly mfaForm = this.fb.group({
    code: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(6)]],
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
      this.loginForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

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
      error: () => {
        this.submitting.set(false);
        this.error.set('auth.errorInvalidCredentials');
      },
    });
  }

  onSubmitMfa(): void {
    if (this.mfaForm.invalid) {
      this.mfaForm.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set(null);

    const { code } = this.mfaForm.getRawValue();
    this.authService.verifyMfa(code!).subscribe({
      next: () => {
        this.submitting.set(false);
        this.redirectAfterLogin();
      },
      error: () => {
        this.submitting.set(false);
        this.error.set('auth.errorMfaRequired');
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
