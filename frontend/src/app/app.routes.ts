import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'organization',
    loadChildren: () =>
      import('./foundation/organization/organization.routes').then(
        (m) => m.ORGANIZATION_ROUTES,
      ),
  },
  {
    path: 'working-calendar',
    loadChildren: () =>
      import('./foundation/working-calendar/working-calendar.routes').then(
        (m) => m.WORKING_CALENDAR_ROUTES,
      ),
  },
  {
    path: 'lookups',
    loadChildren: () =>
      import('./foundation/lookup/lookup.routes').then(
        (m) => m.LOOKUP_ROUTES,
      ),
  },
  {
    path: 'roles',
    loadChildren: () =>
      import('./foundation/roles/roles.routes').then(
        (m) => m.ROLES_ROUTES,
      ),
  },
];
