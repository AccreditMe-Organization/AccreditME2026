import { Routes } from '@angular/router';

export const ADMIN_SETTINGS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/settings-hub/settings-hub.component').then(
        (m) => m.SettingsHubComponent,
      ),
  },
  {
    path: 'organization-profile',
    loadComponent: () =>
      import('./components/organization-profile/organization-profile.component').then(
        (m) => m.OrganizationProfileComponent,
      ),
  },
  {
    path: 'email-provider',
    loadComponent: () =>
      import('./components/email-provider-settings/email-provider-settings.component').then(
        (m) => m.EmailProviderSettingsComponent,
      ),
  },
  {
    path: 'ai-settings',
    loadComponent: () =>
      import('./components/ai-settings/ai-settings.component').then(
        (m) => m.AiSettingsComponent,
      ),
  },
];
