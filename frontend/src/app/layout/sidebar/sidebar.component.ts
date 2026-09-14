import { Component, computed, inject, input } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MenuModule } from 'primeng/menu';
import { TooltipModule } from 'primeng/tooltip';
import { MenuItem } from 'primeng/api';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import {
  NavGroup,
  NavItem,
  PLATFORM_NAV_GROUPS,
  TENANT_NAV_GROUPS,
  visibleNavGroups,
} from '../../core/navigation/nav-items';

// ACC-79 — the rail, built against
// frontend/design-reference/AccreditMe App Shell.dc.html.
//
// Full window height: brand header, grouped navigation, and the signed-in user
// at the foot. The same chrome for every role — only the groups inside change,
// so muscle memory transfers and there is one layout to maintain.
//
// This component makes NO visibility decisions. Permissions, entitlements and
// the platform/tenant split all live in core/navigation/nav-items.ts, which
// permissionGuard also reads, so a link and its route cannot disagree.
@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
    MenuModule,
    TooltipModule,
  ],
  template: `
    <aside
      class="h-full flex-none flex flex-col bg-[var(--am-rail-bg)] transition-[width] duration-200"
      [class.w-[260px]]="!collapsed()"
      [class.w-[72px]]="collapsed()"
      [class.am-rail--platform]="isPlatformShell()"
    >
      <!-- Brand. The kicker names which face of the product this is. -->
      <div
        class="h-12 flex-none flex items-center gap-[9px] px-[14px] border-b border-[var(--am-rail-rule)]"
      >
        <span
          class="w-6 h-6 flex-none rounded-md flex items-center justify-center text-xs font-bold text-white bg-[var(--am-rail-mark)]"
          aria-hidden="true"
          >A</span
        >
        @if (!collapsed()) {
          <span class="min-w-0">
            <span
              class="block text-[13.5px] font-semibold whitespace-nowrap text-[var(--am-rail-brand)]"
              >AccreditMe</span
            >
            <span
              class="block text-[10.5px] tracking-[0.05em] uppercase whitespace-nowrap text-[var(--am-rail-kicker)]"
              >{{ productLabelKey() | translate }}</span
            >
          </span>
        }
      </div>

      <nav
        class="flex-1 overflow-y-auto px-2 pt-2 pb-[14px]"
        [attr.aria-label]="'shell.navigation' | translate"
      >
        @for (group of groups(); track group.key; let first = $first) {
          <div class="mb-3">
            @if (!collapsed()) {
              <div
                class="px-[10px] pt-[6px] pb-1 text-[10px] font-bold tracking-[0.09em] uppercase text-[var(--am-rail-kicker)]"
              >
                {{ group.labelKey | translate }}
              </div>
            } @else if (!first) {
              <!-- Collapsed, the headings have no room, so groups are told apart
                   by a rule instead — never by nothing. -->
              <div
                class="mx-[10px] mt-[6px] mb-2 border-t border-[var(--am-rail-rule)]"
              ></div>
            }

            @for (item of group.items; track item.key) {
              <a
                [routerLink]="item.route"
                routerLinkActive
                #rla="routerLinkActive"
                [routerLinkActiveOptions]="{ exact: needsExactMatch(item) }"
                class="am-rail-item w-full flex items-center gap-[10px] px-[10px] py-[7px] mb-px rounded-md text-[13px] no-underline"
                [class.justify-center]="collapsed()"
                [class.am-rail-item--active]="rla.isActive"
                [attr.aria-current]="rla.isActive ? 'page' : null"
                [attr.aria-label]="
                  collapsed() ? (item.labelKey | translate) : null
                "
                [pTooltip]="collapsed() ? (item.labelKey | translate) : ''"
                tooltipPosition="right"
              >
                <i
                  [class]="
                    item.icon +
                    ' am-rail-glyph w-[18px] flex-none text-center text-[13px]'
                  "
                ></i>
                @if (!collapsed()) {
                  <span
                    class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-start"
                  >
                    {{ item.labelKey | translate }}
                  </span>
                }
              </a>
            }
          </div>
        }
      </nav>

      <!-- The signed-in user, and the menu that used to live in the top bar. -->
      @if (authService.currentUser(); as user) {
        <div class="flex-none p-2 border-t border-[var(--am-rail-rule)]">
          <button
            type="button"
            class="am-rail-item w-full flex items-center gap-[9px] px-2 py-[6px] rounded-[7px] text-start"
            [class.justify-center]="collapsed()"
            [attr.aria-label]="
              'shell.userMenu' | translate: { name: user.name }
            "
            aria-haspopup="menu"
            (click)="userMenu.toggle($event)"
          >
            <span
              class="w-[26px] h-[26px] flex-none rounded-full flex items-center justify-center text-[10.5px] font-semibold text-[var(--am-rail-brand)] bg-[var(--am-rail-avatar)]"
              aria-hidden="true"
              >{{ initials() }}</span
            >
            @if (!collapsed()) {
              <span class="min-w-0">
                <span
                  class="block text-[12.5px] font-medium whitespace-nowrap overflow-hidden text-ellipsis text-[var(--am-rail-brand)]"
                  >{{ user.name }}</span
                >
                <!-- The reference shows a job title and unit here. /auth/me
                     carries neither, so this shows the tenant — accurate, and
                     not a second request on every page for a subtitle. -->
                @if (navigationAccessService.tenantName(); as tenant) {
                  <span
                    class="block text-[11px] whitespace-nowrap overflow-hidden text-ellipsis text-[var(--am-rail-kicker)]"
                    >{{ tenant }}</span
                  >
                }
              </span>
            }
          </button>
          <p-menu #userMenu [model]="userMenuItems()" [popup]="true" />
        </div>
      }
    </aside>
  `,
  styles: [
    `
      .am-rail-item {
        color: var(--am-rail-ink);
        background: transparent;
        cursor: pointer;
      }
      .am-rail-item:hover {
        background: var(--am-rail-hover);
      }
      .am-rail-item:focus-visible {
        outline: 2px solid var(--am-rail-mark);
        outline-offset: 1px;
      }
      .am-rail-glyph {
        color: var(--am-rail-glyph);
      }
      /* The active item is carried by background and weight, per the
         reference — replacing the 3px green edge stripe CLAUDE.md describes.
         That documented rule is superseded by this ticket and is updated in
         its docs commit rather than left to contradict the code. */
      .am-rail-item--active,
      .am-rail-item--active:hover {
        background: var(--am-rail-active);
        color: var(--am-rail-brand);
        font-weight: 600;
      }
      .am-rail-item--active .am-rail-glyph {
        color: var(--am-rail-glyph-active);
      }
    `,
  ],
})
export class SidebarComponent {
  readonly navigationAccessService = inject(NavigationAccessService);
  readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly collapsed = input(false);

  // A computed over the service's signals, so the rail updates when access
  // loads — including the same-tab logout→login case, where loadAccess() is
  // re-run from AppShellComponent without a page reload.
  readonly groups = computed<NavGroup[]>(() =>
    visibleNavGroups(this.navigationAccessService),
  );

  // ACC-79 — the platform palette (tokens.scss, .am-rail--platform). Derived
  // from the groups being shown rather than asking isPlatformAdmin() again, so
  // the hue, the kicker and the items cannot disagree about which shell this
  // is. A platform admin IMPERSONATING a tenant gets the tenant shell: that
  // session belongs to the tenant user, and the full-width banner is what
  // marks it as impersonation.
  readonly isPlatformShell = computed(() =>
    this.groups().some((g) => g.key === 'platform'),
  );

  // Which face of the product this is. The reference switches the kicker on a
  // role NAME ("Tenant admin" when role === "admin"). This product never gates
  // or labels on a role name, so it is derived from what the rail actually
  // shows: an Administration group means administering this tenant.
  readonly productLabelKey = computed(() => {
    const keys = this.groups().map((g) => g.key);
    if (this.isPlatformShell()) return 'shell.product.platform';
    if (keys.includes('admin')) return 'shell.product.admin';
    return 'shell.product.quality';
  });

  readonly initials = computed(() => {
    const name = this.authService.currentUser()?.name ?? '';
    // Skips honorifics so "Dr. Yasser Al-Amri" reads YA, not DY.
    const parts = name
      .split(/\s+/)
      .filter((p) => p.length > 0 && !/^(dr|prof|mr|mrs|ms|eng)\.?$/i.test(p));
    return (
      parts
        .slice(0, 2)
        .map((p) => p[0]!.toUpperCase())
        .join('') || '?'
    ).slice(0, 2);
  });

  // Rebuilds on language change — TranslateService.currentLang is read as a
  // signal, and MenuItem labels are plain strings rather than template-bound,
  // so they need translate.instant() instead of the pipe (ACC-55).
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

  onLogout(): void {
    this.authService.logout().subscribe({
      next: () => void this.router.navigate(['/login']),
      error: () => void this.router.navigate(['/login']),
    });
  }
}
