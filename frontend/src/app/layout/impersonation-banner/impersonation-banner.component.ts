import { Component, inject } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { AuthService } from '../../core/services/auth.service';
import { LANDING_ROUTE } from '../../core/navigation/landing-route';
import { PlatformTenantService } from '../../platform/services/platform-tenant.service';

// ACC-79 — extracted from TopbarComponent when the top bar moved INTO the
// content column to match the App Shell reference.
//
// The banner must NOT move with it. It is the only thing on screen saying that
// every action is being taken as someone else, so it stays full-width above
// both the rail and the content — never inside a column that could be narrow,
// scrolled, or visually subordinate to the page. The reference does not show
// impersonation at all; this placement is a decision, not a copy.
@Component({
  selector: 'app-impersonation-banner',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (authService.impersonatedBy(); as impersonator) {
      <div
        class="h-9 flex-none flex items-center justify-center gap-3 px-4 bg-[var(--am-banner-info)] text-white text-sm"
        role="status"
      >
        <span>{{
          'platform.impersonatingBanner'
            | translate: { admin: impersonator.name }
        }}</span>
        <button
          type="button"
          class="underline font-medium"
          (click)="onEndImpersonation()"
        >
          {{ 'platform.endImpersonation' | translate }}
        </button>
      </div>
    }
  `,
})
export class ImpersonationBannerComponent {
  readonly authService = inject(AuthService);
  private readonly platformTenantService = inject(PlatformTenantService);

  onEndImpersonation(): void {
    // Full reload, not router.navigate() — same reasoning as
    // TenantDetailComponent.onImpersonate(): the cookie changes server-side,
    // so every in-memory signal needs a fresh APP_INITIALIZER boot.
    this.platformTenantService.endImpersonation().subscribe({
      next: () => {
        window.location.href = '/platform/tenants';
      },
      // ACC-70 — LANDING_ROUTE rather than '/organization', which the user
      // being returned to may hold no permission for.
      error: () => {
        window.location.href = LANDING_ROUTE;
      },
    });
  }
}
