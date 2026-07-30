import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TopbarComponent } from '../topbar/topbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

// The app shell every guarded route renders inside (ACC-13) — replaces the
// route-per-page, layout-less arrangement every prior foundation step's own
// plan deferred (see app.routes.ts's history). Notification bell + confirm
// dialog move here from app.component.html, which now only holds
// <router-outlet> for the pre-auth routes (login, accept-invitation, etc.)
// that render outside this shell entirely.
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    ConfirmDialogModule,
    TopbarComponent,
    SidebarComponent,
    BreadcrumbComponent,
    NotificationBellComponent,
  ],
  template: `
    <div class="h-screen flex flex-col">
      <app-topbar (toggleSidebar)="sidebarCollapsed.set(!sidebarCollapsed())" />
      <div class="flex flex-1 overflow-hidden">
        <app-sidebar [collapsed]="sidebarCollapsed()" />
        <div class="flex-1 flex flex-col overflow-hidden">
          <app-breadcrumb />
          <main class="flex-1 overflow-auto p-4">
            <router-outlet />
          </main>
        </div>
      </div>
    </div>

    <div class="fixed top-4 end-4 z-50">
      <app-notification-bell />
    </div>
    <p-confirmDialog />
  `,
})
export class AppShellComponent implements OnInit {
  private readonly navigationAccessService = inject(NavigationAccessService);

  readonly sidebarCollapsed = signal(false);

  ngOnInit(): void {
    this.navigationAccessService.loadAccess().subscribe();
  }
}
