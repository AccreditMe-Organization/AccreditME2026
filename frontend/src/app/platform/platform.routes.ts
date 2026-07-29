import { Routes } from '@angular/router';

export const PLATFORM_ROUTES: Routes = [
  {
    path: '',
    redirectTo: 'tenants',
    pathMatch: 'full',
  },
  {
    path: 'tenants',
    loadComponent: () =>
      import('./components/tenant-list/tenant-list.component').then((m) => m.TenantListComponent),
  },
  {
    path: 'tenants/create',
    loadComponent: () =>
      import('./components/create-tenant/create-tenant.component').then((m) => m.CreateTenantComponent),
  },
  {
    path: 'tenants/:id',
    loadComponent: () =>
      import('./components/tenant-detail/tenant-detail.component').then((m) => m.TenantDetailComponent),
  },
  {
    path: 'plans',
    loadComponent: () =>
      import('./components/plan-list/plan-list.component').then((m) => m.PlanListComponent),
  },
  {
    path: 'plans/create',
    loadComponent: () =>
      import('./components/plan-form/plan-form.component').then((m) => m.PlanFormComponent),
  },
  {
    path: 'plans/:id',
    loadComponent: () =>
      import('./components/plan-form/plan-form.component').then((m) => m.PlanFormComponent),
  },
  {
    path: 'ai-credit-packs',
    loadComponent: () =>
      import('./components/ai-credit-pack-list/ai-credit-pack-list.component').then(
        (m) => m.AiCreditPackListComponent,
      ),
  },
  {
    path: 'ai-feature-costs',
    loadComponent: () =>
      import('./components/ai-feature-cost-list/ai-feature-cost-list.component').then(
        (m) => m.AiFeatureCostListComponent,
      ),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./components/platform-settings/platform-settings.component').then(
        (m) => m.PlatformSettingsComponent,
      ),
  },
];
