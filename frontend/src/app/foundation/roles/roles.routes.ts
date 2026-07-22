import { Routes } from '@angular/router';

export const ROLES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/role-list/role-list.component').then(
        (m) => m.RoleListComponent,
      ),
  },
  {
    path: ':id/permissions',
    loadComponent: () =>
      import('./components/role-permission-matrix/role-permission-matrix.component').then(
        (m) => m.RolePermissionMatrixComponent,
      ),
  },
];
