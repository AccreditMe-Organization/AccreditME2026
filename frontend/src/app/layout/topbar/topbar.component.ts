import { Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { AuthService } from '../../core/services/auth.service';
import { PlatformTenantService } from '../../platform/services/platform-tenant.service';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  template: `
    @if (authService.impersonatedBy(); as impersonator) {
      <div class="h-9 flex items-center justify-center gap-3 px-4 bg-[var(--am-banner-info)] text-white text-sm">
        <span>{{ 'platform.impersonatingBanner' | translate: { admin: impersonator.name } }}</span>
        <button
          type="button"
          class="underline font-medium"
          (click)="onEndImpersonation()"
        >
          {{ 'platform.endImpersonation' | translate }}
        </button>
      </div>
    }

    <header
      class="h-16 flex items-center justify-between px-4 bg-[var(--am-card)] border-b border-[var(--am-border)]"
    >
      <div class="flex items-center gap-3">
        <p-button icon="pi pi-bars" [text]="true" (onClick)="toggleSidebar.emit()" />
        <span class="font-semibold text-lg text-[var(--am-blue-primary)]">AccreditMe</span>
      </div>

      <div class="flex items-center gap-4">
        @if (authService.currentUser(); as user) {
          <span class="text-sm text-[var(--am-text-secondary)]">{{ user.name }}</span>
        }
        <p-button
          [label]="'auth.logout' | translate"
          icon="pi pi-sign-out"
          severity="secondary"
          [text]="true"
          (onClick)="onLogout()"
        />
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly toggleSidebar = output<void>();

  readonly authService = inject(AuthService);
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly router = inject(Router);

  onLogout(): void {
    this.authService.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }

  onEndImpersonation(): void {
    // Full reload, not router.navigate() — same reasoning as
    // TenantDetailComponent.onImpersonate(): the cookie changes server-side,
    // so every in-memory signal needs a fresh APP_INITIALIZER boot.
    this.platformTenantService.endImpersonation().subscribe({
      next: () => { window.location.href = '/platform/tenants'; },
      error: () => { window.location.href = '/organization'; },
    });
  }
}
