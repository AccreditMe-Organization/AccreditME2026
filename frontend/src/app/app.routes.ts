import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: 'dev/login',
    loadComponent: () =>
      import('./dev/demo-login/demo-login.component').then(
        (m) => m.DemoLoginComponent,
      ),
  },
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
  {
    path: 'workflows',
    loadChildren: () =>
      import('./foundation/workflow/workflow.routes').then(
        (m) => m.WORKFLOW_ROUTES,
      ),
  },
  {
    path: 'org-positions',
    loadChildren: () =>
      import('./foundation/org-position/org-position.routes').then(
        (m) => m.ORG_POSITION_ROUTES,
      ),
  },
  {
    path: 'tasks',
    loadChildren: () =>
      import('./foundation/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
  },
];
