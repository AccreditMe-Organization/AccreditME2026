import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { CardComponent } from '../../../../shared/components/card/card.component';

interface SettingsCard {
  labelKey: string;
  icon: string;
  route: string;
}

// Mostly a linking exercise (ACC-13) — the bulk of Tenant Admin Settings
// already has working UI, built in earlier foundation steps as its own
// standalone routed page. This hub is the first place that ties them all
// together in one screen, plus the three genuinely new pages listed after
// the divider (organization profile, email provider, AI settings).
const EXISTING_SETTINGS_CARDS: SettingsCard[] = [
  { labelKey: 'nav.workingCalendar', icon: 'pi pi-calendar', route: '/working-calendar' },
  { labelKey: 'nav.lookups', icon: 'pi pi-list', route: '/lookups' },
  { labelKey: 'nav.roles', icon: 'pi pi-shield', route: '/roles' },
  { labelKey: 'nav.organization', icon: 'pi pi-building', route: '/organization' },
  { labelKey: 'nav.orgPositions', icon: 'pi pi-briefcase', route: '/org-positions' },
  { labelKey: 'nav.workflows', icon: 'pi pi-sitemap', route: '/workflows' },
  { labelKey: 'nav.users', icon: 'pi pi-users', route: '/users' },
];

const NEW_SETTINGS_CARDS: SettingsCard[] = [
  { labelKey: 'adminSettings.organizationProfile', icon: 'pi pi-id-card', route: '/admin-settings/organization-profile' },
  { labelKey: 'adminSettings.emailProvider', icon: 'pi pi-envelope', route: '/admin-settings/email-provider' },
  { labelKey: 'adminSettings.aiSettings', icon: 'pi pi-microchip-ai', route: '/admin-settings/ai-settings' },
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
  readonly newCards = NEW_SETTINGS_CARDS;
  readonly existingCards = EXISTING_SETTINGS_CARDS;
}
