import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { platformAdminGuard } from './core/guards/platform-admin.guard';
import { AppShellComponent } from './layout/app-shell/app-shell.component';

// Every route below the shell inherits its parent's canActivate — a child
// route is never evaluated until the parent guard has already passed, so
// none of these repeat `canActivate: [authGuard]` individually anymore
// (ACC-13 — previously each did, before the shell existed to hold it once).
export const routes: Routes = [
  {
    path: '',
    component: AppShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'organization', pathMatch: 'full' },
      {
        path: 'organization',
        data: { breadcrumb: 'nav.organization' },
        loadChildren: () =>
          import('./foundation/organization/organization.routes').then(
            (m) => m.ORGANIZATION_ROUTES,
          ),
      },
      {
        path: 'working-calendar',
        data: { breadcrumb: 'nav.workingCalendar' },
        loadChildren: () =>
          import('./foundation/working-calendar/working-calendar.routes').then(
            (m) => m.WORKING_CALENDAR_ROUTES,
          ),
      },
      {
        path: 'lookups',
        data: { breadcrumb: 'nav.lookups' },
        loadChildren: () =>
          import('./foundation/lookup/lookup.routes').then(
            (m) => m.LOOKUP_ROUTES,
          ),
      },
      {
        path: 'roles',
        data: { breadcrumb: 'nav.roles' },
        loadChildren: () =>
          import('./foundation/roles/roles.routes').then(
            (m) => m.ROLES_ROUTES,
          ),
      },
      {
        path: 'workflows',
        data: { breadcrumb: 'nav.workflows' },
        loadChildren: () =>
          import('./foundation/workflow/workflow.routes').then(
            (m) => m.WORKFLOW_ROUTES,
          ),
      },
      {
        path: 'org-positions',
        data: { breadcrumb: 'nav.orgPositions' },
        loadChildren: () =>
          import('./foundation/org-position/org-position.routes').then(
            (m) => m.ORG_POSITION_ROUTES,
          ),
      },
      {
        path: 'tasks',
        data: { breadcrumb: 'nav.tasks' },
        loadChildren: () =>
          import('./foundation/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
      },
      {
        path: 'users',
        data: { breadcrumb: 'nav.users' },
        loadChildren: () =>
          import('./foundation/user/user.routes').then((m) => m.USER_ROUTES),
      },
      {
        path: 'platform',
        data: { breadcrumb: 'nav.platform' },
        canActivate: [platformAdminGuard],
        loadChildren: () =>
          import('./platform/platform.routes').then((m) => m.PLATFORM_ROUTES),
      },
    ],
  },
  {
    path: '',
    loadChildren: () =>
      import('./foundation/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
];
