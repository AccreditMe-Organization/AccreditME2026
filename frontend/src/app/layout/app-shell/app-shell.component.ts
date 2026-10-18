import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  OnInit,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { LayerStackService } from '../../shared/overlay/layer-stack.service';
import { ConfirmHostComponent } from '../../shared/components/confirm/confirm-host.component';
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

/**
 * ACC-232 — below this viewport width the shell is the PHONE shell. The rail
 * never sits beside <main>: at 390px it left the page about 100px wide. It
 * starts closed and opens over the page at its full 260px, with a scrim. No
 * design file draws a phone layout, so this reuses the rail as it is and adds
 * nothing to draw: the same component, placed over the page.
 */
export const SHELL_PHONE_BELOW_PX = 768;

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    ConfirmHostComponent,
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
        @if (!phone()) {
          <app-sidebar [collapsed]="sidebarCollapsed()" />
        }
        <div class="flex-1 min-w-0 flex flex-col">
          <app-topbar
            [collapsed]="sidebarCollapsed()"
            [phone]="phone()"
            [railOpen]="railOpen()"
            (toggleSidebar)="onToggle()"
          />
          <!-- ACC-232 — on a phone the rail opens OVER the page, below the top
               bar, so the toggle stays where it was and closes it again. While
               it is open the page behind is inert, and the scrim closes it. -->
          <div class="relative flex-1 min-h-0 flex flex-col">
            <main
              class="flex-1 min-h-0 overflow-auto p-4"
              [attr.inert]="pageInert() ? '' : null"
              (wheel)="onWheel($event)"
            >
              <router-outlet />
            </main>
            @if (pageInert()) {
              <div
                class="absolute inset-0 bg-[var(--am-overlay-scrim)]"
                aria-hidden="true"
                data-rail-scrim
                (click)="closeRail()"
              ></div>
              <div
                #railDrawer
                class="absolute inset-y-0 start-0 w-[260px] max-w-full shadow-[var(--am-shadow-overlay)]"
                data-rail-drawer
                (click)="onDrawerClick($event)"
              >
                <app-sidebar [collapsed]="false" />
              </div>
            }
          </div>
        </div>
      </div>
    </div>

    <!-- ACC-120 slice 10 — the app's one confirmation dialog. Every confirm
         goes through AmConfirmService.ask(), which sets its tone, verb, layer
         and focus; the host owns the 420 width and the button styles, and
         still carries amCloseLabel for the × (ACC-83). -->
    <am-confirm-host />
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
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly layers = inject(LayerStackService);

  /** The desktop rail: 260 open, 72 collapsed. A phone never reads it. */
  readonly sidebarCollapsed = signal(false);

  /** ACC-232 — the viewport is narrower than SHELL_PHONE_BELOW_PX. */
  readonly phone = signal(false);
  /** ACC-232 — the phone rail is open over the page. */
  readonly railOpen = signal(false);
  /** The page is inert exactly while the phone rail is open, so never on a desktop. */
  readonly pageInert = computed(() => this.phone() && this.railOpen());

  private readonly railDrawer = viewChild<ElementRef<HTMLElement>>('railDrawer');
  private readonly topbarHost = viewChild(TopbarComponent, { read: ElementRef });
  private layerId: number | null = null;

  constructor() {
    // ACC-79 — tab titles follow the page while the shell is alive, and reset
    // when it is destroyed (logout), so the sign-in tab names no tenant.
    inject(DocumentTitleService).attach(inject(Injector));

    const destroyRef = inject(DestroyRef);
    const query = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (query) {
      this.phone.set(query.matches);
      // Crossing the line either way leaves the rail CLOSED: nothing stays
      // inert on a desktop, and a phone never inherits an open rail.
      const onChange = (e: MediaQueryListEvent): void => {
        this.phone.set(e.matches);
        this.setRailOpen(false);
      };
      query.addEventListener('change', onChange);
      destroyRef.onDestroy(() => query.removeEventListener('change', onChange));
    }

    // Escape closes the rail when it is the top layer, so a dialog or menu
    // above it answers its own Escape first. Bubble phase, like the drawer.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.pageInert()) return;
      if (this.layerId === null || !this.layers.isTop(this.layerId)) return;
      event.stopPropagation();
      this.closeRail();
    };
    this.document.addEventListener('keydown', onKeydown);
    destroyRef.onDestroy(() => {
      this.document.removeEventListener('keydown', onKeydown);
      this.setRailOpen(false);
    });

    // Any navigation closes it, including one from the user menu, whose panel
    // sits outside the drawer.
    inject(Router)
      .events.pipe(
        filter((e): e is NavigationEnd => e instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => {
        if (this.pageInert()) this.closeRail();
      });
  }

  /** The top bar's toggle: collapses the desktop rail, opens and closes the phone one. */
  onToggle(): void {
    if (!this.phone()) {
      this.sidebarCollapsed.set(!this.sidebarCollapsed());
      return;
    }
    if (this.railOpen()) {
      this.closeRail();
      return;
    }
    this.setRailOpen(true);
    // Focus moves into the rail once it is drawn.
    afterNextRender(
      () => this.railDrawer()?.nativeElement.querySelector<HTMLElement>('a[href], button')?.focus(),
      { injector: this.injector },
    );
  }

  /** Closes the phone rail and returns focus to the toggle. */
  closeRail(): void {
    if (!this.railOpen()) return;
    this.setRailOpen(false);
    afterNextRender(
      () =>
        (this.topbarHost()?.nativeElement as HTMLElement | undefined)
          ?.querySelector<HTMLElement>('[data-rail-toggle] button')
          ?.focus(),
      { injector: this.injector },
    );
  }

  /** Choosing a link closes it, even the page already open, which navigates nowhere. */
  onDrawerClick(event: MouseEvent): void {
    if ((event.target as Element | null)?.closest('a[href]')) this.closeRail();
  }

  private setRailOpen(open: boolean): void {
    this.railOpen.set(open);
    if (open && this.layerId === null) this.layerId = this.layers.push();
    if (!open && this.layerId !== null) {
      this.layers.remove(this.layerId);
      this.layerId = null;
    }
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
