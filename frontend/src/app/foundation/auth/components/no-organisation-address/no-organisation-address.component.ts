import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthLayoutComponent } from '../auth-layout/auth-layout.component';

/**
 * ACC-139 — what Sign in and Forgot password show at an address that names no
 * organisation (bare localhost, the apex, www, …): the sign-in frame with a
 * note saying where to go, and no form. There is nothing a form could do —
 * the organisation is the address, and nobody types it any more.
 */
@Component({
  selector: 'app-no-organisation-address',
  standalone: true,
  imports: [AuthLayoutComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-auth-layout>
      <h1 class="text-heading font-semibold">{{ titleKey() | translate }}</h1>
      <p class="text-body" data-test="no-organisation-note">
        {{ 'auth.openOrganisationAddress' | translate }}
      </p>
    </app-auth-layout>
  `,
})
export class NoOrganisationAddressComponent {
  /** The screen's own title, as a translation key. */
  readonly titleKey = input.required<string>();
}
