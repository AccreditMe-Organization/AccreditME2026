import { Component, Injector, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { TopbarComponent } from '../topbar/topbar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';
import { ImpersonationBannerComponent } from '../impersonation-banner/impersonation-banner.component';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { DocumentTitleService } from '../../core/services/document-title.service';

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
import { IdleWarningComponent } from '../../core/components/idle-warning/idle-warning.component';
import { IdleService } from '../../core/services/idle.service';
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    ConfirmDialogModule,
    TopbarComponent,
    SidebarComponent,
    ImpersonationBannerComponent,
    IdleWarningComponent,
  ],
  template: `
    <!-- ACC-79 — the App Shell reference's layout. The rail runs the full
         window height beside a content column whose own top bar carries the
         rail toggle, breadcrumb and bell. The impersonation banner sits above
         BOTH, full width: it is the one indicator that every action is being
         taken as someone else, so it never shrinks into a column. -->
    <!-- ACC-122 — inside the shell, so it exists only for a signed-in user
         and never over the login page. -->
    <app-idle-warning />

    <div class="h-screen flex flex-col">
      <app-impersonation-banner />
      <div class="flex flex-1 min-h-0">
        <app-sidebar [collapsed]="sidebarCollapsed()" />
        <div class="flex-1 min-w-0 flex flex-col">
          <app-topbar
            [collapsed]="sidebarCollapsed()"
            (toggleSidebar)="sidebarCollapsed.set(!sidebarCollapsed())"
          />
          <main
            class="flex-1 min-h-0 overflow-auto p-4"
            (wheel)="onWheel($event)"
          >
            <router-outlet />
          </main>
        </div>
      </div>
    </div>

    <p-confirmDialog />
  `,
  // ACC-38 — the same scroll-chaining bug ACC-36 fixed for
  // EditDialogComponent's own scroll area is not dialog-specific: this
  // <main> is a scrollable ancestor of every routed page in the app, and
  // PrimeNG's ConnectedOverlayScrollHandler (confirmed via source:
  // DomHandler.getScrollableParents()) binds close-on-scroll to ANY
  // scrollable ancestor of a p-select/p-multiselect's trigger, not just a
  // dialog's. Same fix, same selectors, applied to a second scroll
  // container — see EditDialogComponent for the full rationale (both
  // components' styles/onWheel must be kept in sync if this mechanism
  // ever changes). A dialog opened on top of a page gets BOTH layers
  // (its own EditDialogComponent guard, plus this one) — harmless: both
  // onWheel handlers inspect the same bubbling event and the same
  // boundary condition, and preventDefault() is idempotent.
  styles: [
    `
      :host ::ng-deep .p-select-list-container,
      :host ::ng-deep .p-multiselect-list-container {
        overscroll-behavior: contain;
      }
    `,
  ],
})
export class AppShellComponent implements OnInit {
  private readonly idleService = inject(IdleService);
  private readonly navigationAccessService = inject(NavigationAccessService);

  readonly sidebarCollapsed = signal(false);

  constructor() {
    // ACC-79 — tab titles follow the page while the shell is alive, and reset
    // when it is destroyed (logout), so the sign-in tab names no tenant.
    inject(DocumentTitleService).attach(inject(Injector));
  }

  ngOnInit(): void {
    this.navigationAccessService.loadAccess().subscribe();
    // ACC-122 — the idle clock runs for the life of the signed-in shell.
    // start() is idempotent, and IdleService stops itself on destroy.
    this.idleService.start();
  }

  // Mirrors EditDialogComponent.onWheel() exactly — only ever calls
  // preventDefault() once a listbox has genuinely exhausted its own
  // scroll room in the gesture's direction; every other tick is left
  // completely untouched.
  onWheel(event: WheelEvent): void {
    const target = event.target as HTMLElement | null;
    const listContainer = target?.closest(
      '.p-select-list-container, .p-multiselect-list-container',
    ) as HTMLElement | null;
    if (!listContainer) return;

    const atTop = listContainer.scrollTop <= 0;
    const atBottom =
      listContainer.scrollTop + listContainer.clientHeight >=
      listContainer.scrollHeight;

    if ((event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom)) {
      event.preventDefault();
    }
  }
}
