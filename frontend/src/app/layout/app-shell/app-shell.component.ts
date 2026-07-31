import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TopbarComponent } from '../topbar/topbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

// The app shell every guarded route renders inside (ACC-13) — replaces the
// route-per-page, layout-less arrangement every prior foundation step's own
// plan deferred (see app.routes.ts's history). The notification bell moved
// from a standalone `fixed top-4 end-4` overlay here into TopbarComponent's
// own flex layout (ACC-18) — that wrapper was inert until ACC-15 made
// Tailwind actually compile, at which point it started colliding with the
// topbar's own right-aligned username/logout button (both independently
// pinned to the same viewport corner). The bell's own p-popover panel
// positions itself relative to its trigger element regardless of where
// that element sits in normal document flow, so moving it out of a fixed
// wrapper doesn't affect how its dropdown behaves.
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    ConfirmDialogModule,
    TopbarComponent,
    SidebarComponent,
    BreadcrumbComponent,
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
