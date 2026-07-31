import { Component, inject, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

interface NavItem {
  labelKey: string;
  icon: string;
  route: string;
  requiredPermission: string;
}

// Only routes that actually exist today (ACC-5–ACC-12) — committees/
// meetings/documents/etc. are ACC-14+ and will add their own entries once
// those modules ship, not stubbed here as dead links.
const FOUNDATION_NAV_ITEMS: NavItem[] = [
  { labelKey: 'nav.organization', icon: 'pi pi-building', route: '/organization', requiredPermission: 'org:view' },
  { labelKey: 'nav.workingCalendar', icon: 'pi pi-calendar', route: '/working-calendar', requiredPermission: 'org:view' },
  { labelKey: 'nav.lookups', icon: 'pi pi-list', route: '/lookups', requiredPermission: 'lookups:view' },
  { labelKey: 'nav.roles', icon: 'pi pi-shield', route: '/roles', requiredPermission: 'roles:view' },
  { labelKey: 'nav.workflows', icon: 'pi pi-sitemap', route: '/workflows', requiredPermission: 'workflows:view' },
  { labelKey: 'nav.orgPositions', icon: 'pi pi-briefcase', route: '/org-positions', requiredPermission: 'positions:view' },
  { labelKey: 'nav.tasks', icon: 'pi pi-check-square', route: '/tasks', requiredPermission: 'tasks:view' },
  { labelKey: 'nav.users', icon: 'pi pi-users', route: '/users', requiredPermission: 'users:view' },
];

// Functional modules (ACC-17+) will be appended here as they ship, each
// filtered through navigationAccessService.isModuleEnabled(moduleKey) —
// none exist yet, so this list is intentionally empty for now.
const FUNCTIONAL_NAV_ITEMS: (NavItem & { moduleKey: string })[] = [];

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
        <!-- Platform admins get the Super Admin Portal only — showing the
             tenant-scoped nav below alongside it would mix "administer other
             tenants" with "manage the platform org's own HR/roles/workflows",
             which isn't a real workflow this product supports (see
             step-12-admin-portal.md's own framing of the platform org as an
             implementation detail of PlatformGuard, not a tenant AccreditMe
             itself operates day-to-day). Regular tenant admins are unaffected
             — this branch never applies to them. -->
        @if (navigationAccessService.isPlatformAdmin()) {
          <a
            routerLink="/platform"
            routerLinkActive="sidebar-active-stripe bg-[var(--am-sidebar-active)]"
            class="flex items-center gap-3 px-4 py-3 mx-2 rounded-md text-sm hover:bg-[var(--am-sidebar-hover)] transition-colors"
          >
            <i class="pi pi-shield"></i>
            @if (!collapsed()) {
              <span>{{ 'nav.platform' | translate }}</span>
            }
          </a>
        } @else {
          @for (item of visibleFoundationItems(); track item.route) {
            <a
              [routerLink]="item.route"
              routerLinkActive="sidebar-active-stripe bg-[var(--am-sidebar-active)]"
              [routerLinkActiveOptions]="{ exact: false }"
              class="flex items-center gap-3 px-4 py-3 mx-2 rounded-md text-sm hover:bg-[var(--am-sidebar-hover)] transition-colors"
            >
              <i [class]="item.icon"></i>
              @if (!collapsed()) {
                <span>{{ item.labelKey | translate }}</span>
              }
            </a>
          }

          @if (visibleAdminSettingsLink()) {
            <div class="my-2 border-t border-white/10"></div>
            <a
              routerLink="/admin-settings"
              routerLinkActive="sidebar-active-stripe bg-[var(--am-sidebar-active)]"
              class="flex items-center gap-3 px-4 py-3 mx-2 rounded-md text-sm hover:bg-[var(--am-sidebar-hover)] transition-colors"
            >
              <i class="pi pi-cog"></i>
              @if (!collapsed()) {
                <span>{{ 'nav.adminSettings' | translate }}</span>
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

  visibleFoundationItems(): NavItem[] {
    return FOUNDATION_NAV_ITEMS.filter((item) =>
      this.navigationAccessService.hasPermission(item.requiredPermission),
    );
  }

  visibleFunctionalItems(): NavItem[] {
    return FUNCTIONAL_NAV_ITEMS.filter(
      (item) =>
        this.navigationAccessService.isModuleEnabled(item.moduleKey) &&
        this.navigationAccessService.hasPermission(item.requiredPermission),
    );
  }

  visibleAdminSettingsLink(): boolean {
    return this.navigationAccessService.hasPermission('tenant:manage_config');
  }
}
