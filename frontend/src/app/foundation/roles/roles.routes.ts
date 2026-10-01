import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

export const ROLES_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/role-list/role-list.component').then(
        (m) => m.RoleListComponent,
      ),
  },
  // ACC-123 — THE CHILD CARRIES ITS OWN canActivate, and must. Same shape as
  // ADMIN_SETTINGS_ROUTES (ACC-79) and tasks/all: a child route with no
  // canActivate never runs the guard at all, so before this the permission
  // MATRIX — the screen that grants permissions — was reachable by URL to
  // anyone signed in, while the list it is opened from was gated.
  //
  // Found by standing on it as READ_ONLY_ADMIN, not by the scan: 148 toggles,
  // none disabled, and a live Save.
  //
  // No ROUTE_PERMISSIONS entry of its own is needed. The guard walks up —
  // 'roles/:id/permissions', then 'roles/:id', then 'roles' — and 'roles' is in
  // the map as [admin:access, roles:view]. That is the right requirement: an
  // inspector may READ which permissions a role holds, and the matrix itself
  // decides whether they may change them.
  {
    path: ':id/permissions',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/role-permission-matrix/role-permission-matrix.component').then(
        (m) => m.RolePermissionMatrixComponent,
      ),
  },
];
