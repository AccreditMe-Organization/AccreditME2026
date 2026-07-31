import { Routes } from '@angular/router';

export const ORGANIZATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/org-unit-tree/org-unit-tree.component').then(
        (m) => m.OrgUnitTreeComponent,
      ),
  },
];
