import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'organization',
    loadChildren: () =>
      import('./foundation/organization/organization.routes').then(
        (m) => m.ORGANIZATION_ROUTES,
      ),
  },
];
