import { Component, computed, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MenuModule } from 'primeng/menu';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { PlatformTenantService } from '../../platform/services/platform-tenant.service';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';

@Component({
  selector: 'app-topbar',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, MenuModule, NotificationBellComponent],
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
        <app-notification-bell />
        @if (authService.currentUser(); as user) {
          <button
            type="button"
            class="flex items-center gap-2 text-sm text-[var(--am-text-secondary)] hover:text-[var(--am-text-primary)] transition-colors"
            (click)="userMenu.toggle($event)"
          >
            <span>{{ user.name }}</span>
            <i class="pi pi-angle-down text-xs"></i>
          </button>
          <p-menu #userMenu [model]="userMenuItems()" [popup]="true" />
        }
      </div>
    </header>
  `,
})
export class TopbarComponent {
  readonly toggleSidebar = output<void>();

  readonly authService = inject(AuthService);
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  // Rebuilds on language change — TranslateService.currentLang is read as a
  // signal here (same mechanism notification-bell.component.ts's isArabic()
  // relies on), and MenuItem labels are plain strings (not template-bound),
  // so they need translate.instant() rather than the | translate pipe.
  readonly userMenuItems = computed<MenuItem[]>(() => {
    void this.translate.currentLang();
    const user = this.authService.currentUser();
    return [
      {
        label: this.translate.instant('user.myProfile'),
        icon: 'pi pi-user',
        command: () => user && void this.router.navigate(['/users', user.id]),
      },
      {
        label: this.translate.instant('auth.logout'),
        icon: 'pi pi-sign-out',
        command: () => this.onLogout(),
      },
    ];
  });

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
