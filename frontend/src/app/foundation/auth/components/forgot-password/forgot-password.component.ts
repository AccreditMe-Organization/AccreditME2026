import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { MessageModule } from 'primeng/message';
import { TenantHostService } from '../../../../core/tenant/tenant-host';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';
import { NoOrganisationAddressComponent } from '../no-organisation-address/no-organisation-address.component';

/**
 * Forgot password — ACC-120 slice 9d, on the shared auth layout.
 *
 * IT SENDS NOTHING, ON PURPOSE (CC-62, answer 1). Password reset is not served:
 * the reset email Better Auth would queue carries a relative link to a handler
 * this API never mounts, and there is no reset screen. So the page used to tell
 * every visitor "check your inbox" for a link that could not work, and sent real
 * people that email. It now says plainly that reset by email isn't available,
 * and points at the administrator. The backend endpoint is unchanged; the reset
 * flow is its own ticket, after slice 9.
 *
 * The route and the "Forgot password?" link on Sign in stay, so the question
 * still has an answer where people look for it.
 */
@Component({
  selector: 'app-forgot-password',
  standalone: true,
  imports: [RouterLink, TranslatePipe, MessageModule, AuthLayoutComponent, NoOrganisationAddressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- ACC-139 — the organisation is the address; see LoginComponent. -->
    @if (!organizationSlug) {
      <app-no-organisation-address titleKey="auth.forgotPasswordTitle" />
    } @else {
      <app-auth-layout>
        <h1 class="text-heading font-semibold">{{ 'auth.forgotPasswordTitle' | translate }}</h1>
        <p-message
          data-testid="forgot-password-note"
          severity="info"
          [attr.role]="'status'"
          [text]="'auth.forgotPasswordUnavailable' | translate"
        />
        <a routerLink="/login" class="text-sm underline self-start">
          {{ 'auth.signIn.backToSignIn' | translate }}
        </a>
      </app-auth-layout>
    }
  `,
})
export class ForgotPasswordComponent {
  /** ACC-139 — the organisation this address names, or null for none. */
  protected readonly organizationSlug = inject(TenantHostService).slug;
}
