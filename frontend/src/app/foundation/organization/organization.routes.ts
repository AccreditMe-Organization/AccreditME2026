import { Routes } from '@angular/router';

export const ORGANIZATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/org-unit-tree/org-unit-tree.component').then(
        (m) => m.OrgUnitTreeComponent,
      ),
  },
  {
    path: 'new',
    loadComponent: () =>
      import('./components/org-unit-form/org-unit-form.component').then(
        (m) => m.OrgUnitFormComponent,
      ),
  },
  {
    path: ':id/edit',
    loadComponent: () =>
      import('./components/org-unit-form/org-unit-form.component').then(
        (m) => m.OrgUnitFormComponent,
      ),
  },
];
