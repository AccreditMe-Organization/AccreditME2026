import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

// ACC-79 — the Admin Settings hub is gone; each of these four screens is its
// own rail entry. The URLs are unchanged.
//
// EVERY CHILD CARRIES ITS OWN canActivate, and must. The parent path
// 'admin-settings' no longer has a nav item, so it has no ROUTE_PERMISSIONS
// entry, and an unmapped route is allowed. A child without canActivate never
// runs the guard at all — so without these, all four screens would be open to
// anyone. Each child's guard resolves 'admin-settings/<child>' exactly, which is
// also what lets Organization profile require tenant:view while the other three
// require tenant:manage_config.
export const ADMIN_SETTINGS_ROUTES: Routes = [
  // The bare URL was the hub. Redirect rather than leave it unmatched, which
  // would fail the navigation outright. The guard on the target still decides.
  { path: '', pathMatch: 'full', redirectTo: 'organization-profile' },
  {
    path: 'organization-profile',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/organization-profile/organization-profile.component').then(
        (m) => m.OrganizationProfileComponent,
      ),
  },
  {
    path: 'email-provider',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/email-provider-settings/email-provider-settings.component').then(
        (m) => m.EmailProviderSettingsComponent,
      ),
  },
  {
    path: 'ai-settings',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/ai-settings/ai-settings.component').then(
        (m) => m.AiSettingsComponent,
      ),
  },
  {
    path: 'task-sla',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/task-sla-settings/task-sla-settings.component').then(
        (m) => m.TaskSlaSettingsComponent,
      ),
  },
];
