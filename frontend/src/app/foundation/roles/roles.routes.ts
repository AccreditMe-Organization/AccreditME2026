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
  // CORRECTED — this guard is DEFENCE IN DEPTH, not a fix. The comment here
  // previously claimed the matrix "was reachable by URL to anyone signed in"
  // before it was added. That was false, and the correction is kept rather than
  // deleted because the reasoning that produced it is easy to repeat.
  //
  // Angular runs every ancestor's canActivate before activating a child, and
  // the `roles` route in app.routes.ts carries permissionGuard — so this screen
  // was always protected. app.routes.ts's own header says so. The claim came
  // from seeing no canActivate in THIS file and generalising ACC-79's note,
  // which is true of its own case: there the PARENT had no guard either, so the
  // children inherited nothing. Proved by removing this line and signing in as
  // a BASE_USER — the matrix URL redirected to /home.
  //
  // The line stays. It costs one redundant guard run and states the
  // requirement where a reader of this file will look for it. It is not what
  // protects the screen.
  //
  // No ROUTE_PERMISSIONS entry of its own is needed either way: the guard walks
  // up — 'roles/:id/permissions', then 'roles/:id', then 'roles' — and 'roles'
  // is mapped to [admin:access, roles:view]. That is the right requirement. An
  // inspector may READ which permissions a role holds; the matrix itself
  // decides whether they may change them, which is the part that WAS broken.
  {
    path: ':id/permissions',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/role-permission-matrix/role-permission-matrix.component').then(
        (m) => m.RolePermissionMatrixComponent,
      ),
  },
];
