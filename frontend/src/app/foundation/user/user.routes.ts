import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';
import { ownProfileGuard } from '../../core/guards/own-profile.guard';

// ACC-79 — the guard moved from the parent `users` route onto each child. On
// the parent it gated `users/:id` on users:view as well, which bounced a user
// from their own profile. Each child now carries its own guard, and must: a
// child without canActivate never runs one (see admin-settings.routes.ts).
export const USER_ROUTES: Routes = [
  {
    path: '',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/user-list/user-list.component').then((m) => m.UserListComponent),
  },
  {
    path: ':id',
    canActivate: [ownProfileGuard],
    loadComponent: () =>
      // ACC-120 slice 5 — the user record page, which replaced the profile
      // form. One page for your own record and someone else's.
      import('./components/user-record/user-record.component').then(
        (m) => m.UserRecordComponent,
      ),
  },
];
