import { Component, computed, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import {
  NavGroup,
  NavItem,
  PLATFORM_NAV_GROUPS,
  TENANT_NAV_GROUPS,
  visibleNavGroups,
} from '../../core/navigation/nav-items';

// ACC-79 — renders whatever visibleNavGroups() returns. The sidebar makes NO
// visibility decisions of its own: permissions, entitlements and the
// platform/tenant split all live in core/navigation/nav-items.ts, which the
// route guard also reads, so a link and its route cannot disagree.
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <nav
      class="h-full flex flex-col bg-[var(--am-sidebar-bg)] text-white transition-all duration-200"
      [class.w-[260px]]="!collapsed()"
      [class.w-[72px]]="collapsed()"
    >
      <div class="flex flex-col gap-1 py-4 overflow-y-auto">
        @for (group of groups(); track group.key; let first = $first) {
          @if (!first) {
            <div class="my-2 border-t border-white/10"></div>
          }
          @for (item of group.items; track item.key) {
            <a
              [routerLink]="item.route"
              routerLinkActive="sidebar-active-stripe bg-[var(--am-sidebar-active)]"
              [routerLinkActiveOptions]="{ exact: needsExactMatch(item) }"
              class="flex items-center gap-3 px-4 py-3 mx-2 rounded-md text-sm hover:bg-[var(--am-sidebar-hover)] transition-colors"
            >
              <i [class]="item.icon"></i>
              @if (!collapsed()) {
                <span>{{ item.labelKey | translate }}</span>
              }
            </a>
          }
        }
      </div>
    </nav>
  `,
})
export class SidebarComponent {
  readonly navigationAccessService = inject(NavigationAccessService);

  readonly collapsed = input(false);

  // A computed over the service's signals, so the rail updates when access
  // loads — including the same-tab logout→login case, where loadAccess() is
  // re-run from AppShellComponent without a page reload.
  readonly groups = computed<NavGroup[]>(() =>
    visibleNavGroups(this.navigationAccessService),
  );

  // Every route any nav item points at, across both shells.
  private readonly allRoutes = [
    ...TENANT_NAV_GROUPS,
    ...PLATFORM_NAV_GROUPS,
  ].flatMap((group) => group.items.map((item) => item.route));

  // Exact matching only where one item's route is a PREFIX of another's.
  // /tasks (My tasks) prefixes /tasks/unassigned, so a prefix match would light
  // up both items on the unassigned screen. Everywhere else prefix matching is
  // what we want — /committees/abc123 should still highlight Committees.
  needsExactMatch(item: NavItem): boolean {
    return this.allRoutes.some(
      (route) => route !== item.route && route.startsWith(item.route + '/'),
    );
  }
}
