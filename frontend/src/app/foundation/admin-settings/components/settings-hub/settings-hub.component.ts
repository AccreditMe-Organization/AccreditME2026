import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

interface SettingsCard {
  labelKey: string;
  icon: string;
  route: string;
  requiredPermission: string;
}

// Mostly a linking exercise (ACC-13) — the bulk of Tenant Admin Settings
// already has working UI, built in earlier foundation steps as its own
// standalone routed page. This hub is the first place that ties them all
// together in one screen, plus the three genuinely new pages listed after
// the divider (organization profile, email provider, AI settings).
//
// requiredPermission mirrors sidebar.component.ts's FOUNDATION_NAV_ITEMS —
// reaching this hub only requires tenant:manage_config (the sidebar's own
// Admin Settings link gate), which is not the same permission each card's
// target page actually needs. Without this, any card whose own page
// requires a permission the viewer lacks is a dead click once they arrive
// (see ACC-16 — this is exactly what happened to Org Positions before its
// permission-seed gap was fixed).
const EXISTING_SETTINGS_CARDS: SettingsCard[] = [
  { labelKey: 'nav.workingCalendar', icon: 'pi pi-calendar', route: '/working-calendar', requiredPermission: 'org:view' },
  { labelKey: 'nav.lookups', icon: 'pi pi-list', route: '/lookups', requiredPermission: 'lookups:view' },
  { labelKey: 'nav.roles', icon: 'pi pi-shield', route: '/roles', requiredPermission: 'roles:view' },
  { labelKey: 'nav.organization', icon: 'pi pi-building', route: '/organization', requiredPermission: 'org:view' },
  { labelKey: 'nav.orgPositions', icon: 'pi pi-briefcase', route: '/org-positions', requiredPermission: 'positions:view' },
  { labelKey: 'nav.workflows', icon: 'pi pi-sitemap', route: '/workflows', requiredPermission: 'workflows:view' },
  { labelKey: 'nav.users', icon: 'pi pi-users', route: '/users', requiredPermission: 'users:view' },
];

// Backend permission per page, confirmed against tenant.controller.ts:
// organization-profile reads GET /tenant (TENANT_PERMISSIONS.VIEW);
// email-provider, ai-settings, and task-sla all read/write
// MANAGE_CONFIG-gated endpoints (GET/PATCH /tenant/email-config,
// PATCH /tenant/ai-settings, GET/PATCH /tenant/task-sla).
const NEW_SETTINGS_CARDS: SettingsCard[] = [
  { labelKey: 'adminSettings.organizationProfile', icon: 'pi pi-id-card', route: '/admin-settings/organization-profile', requiredPermission: 'tenant:view' },
  { labelKey: 'adminSettings.emailProvider', icon: 'pi pi-envelope', route: '/admin-settings/email-provider', requiredPermission: 'tenant:manage_config' },
  { labelKey: 'adminSettings.aiSettings', icon: 'pi pi-microchip-ai', route: '/admin-settings/ai-settings', requiredPermission: 'tenant:manage_config' },
  { labelKey: 'adminSettings.taskSla', icon: 'pi pi-clock', route: '/admin-settings/task-sla', requiredPermission: 'tenant:manage_config' },
];

@Component({
  selector: 'app-settings-hub',
  standalone: true,
  imports: [RouterLink, TranslatePipe, CardComponent],
  template: `
    <div class="flex flex-col gap-6">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.title' | translate }}</h2>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (card of newCards; track card.route) {
          <a [routerLink]="card.route" class="block">
            <app-card [linkable]="true">
              <div class="flex items-center gap-3">
                <i [class]="card.icon" class="text-xl text-[var(--am-blue-primary)]"></i>
                <span class="text-sm font-medium">{{ card.labelKey | translate }}</span>
              </div>
            </app-card>
          </a>
        }
      </div>

      <hr />

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        @for (card of existingCards; track card.route) {
          <a [routerLink]="card.route" class="block">
            <app-card [linkable]="true">
              <div class="flex items-center gap-3">
                <i [class]="card.icon" class="text-xl text-[var(--am-text-secondary)]"></i>
                <span class="text-sm font-medium">{{ card.labelKey | translate }}</span>
              </div>
            </app-card>
          </a>
        }
      </div>
    </div>
  `,
})
export class SettingsHubComponent {
  private readonly navigationAccessService = inject(NavigationAccessService);

  get newCards(): SettingsCard[] {
    return NEW_SETTINGS_CARDS.filter((card) =>
      this.navigationAccessService.hasPermission(card.requiredPermission),
    );
  }

  get existingCards(): SettingsCard[] {
    return EXISTING_SETTINGS_CARDS.filter((card) =>
      this.navigationAccessService.hasPermission(card.requiredPermission),
    );
  }
}
