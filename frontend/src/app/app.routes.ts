import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: '',
    loadChildren: () =>
      import('./foundation/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'organization',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/organization/organization.routes').then(
        (m) => m.ORGANIZATION_ROUTES,
      ),
  },
  {
    path: 'working-calendar',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/working-calendar/working-calendar.routes').then(
        (m) => m.WORKING_CALENDAR_ROUTES,
      ),
  },
  {
    path: 'lookups',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/lookup/lookup.routes').then(
        (m) => m.LOOKUP_ROUTES,
      ),
  },
  {
    path: 'roles',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/roles/roles.routes').then(
        (m) => m.ROLES_ROUTES,
      ),
  },
  {
    path: 'workflows',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/workflow/workflow.routes').then(
        (m) => m.WORKFLOW_ROUTES,
      ),
  },
  {
    path: 'org-positions',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/org-position/org-position.routes').then(
        (m) => m.ORG_POSITION_ROUTES,
      ),
  },
  {
    path: 'tasks',
    canActivate: [authGuard],
    loadChildren: () =>
      import('./foundation/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
  },
];
