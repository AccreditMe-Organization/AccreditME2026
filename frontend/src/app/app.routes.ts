import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';
import { platformAdminGuard } from './core/guards/platform-admin.guard';
import { permissionGuard } from './core/guards/permission.guard';
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
      // Static TENANT_ADMIN-oriented fallback, deliberately not role-aware —
      // only reached when an already-authenticated user hits the bare root
      // directly (e.g. a bookmark, or clicking a logo/home link), which
      // LoginComponent's own post-login redirect never goes through. Making
      // this properly role-aware would need an async guard (NavigationAccessService's
      // permissions/tenant data isn't available synchronously at route-recognition
      // time, before AppShellComponent has mounted) — not worth it for an edge
      // case this rare. A platform admin hitting this path lands on
      // /organization and can navigate to Platform from the sidebar.
      { path: '', redirectTo: 'home', pathMatch: 'full' },
      {
        // ACC-70 — deliberately NO permissionGuard and no ROUTE_PERMISSIONS
        // entry. This is where every user is sent after login, including one
        // holding no permissions at all, so guarding it would make it the
        // thing it exists to prevent.
        path: 'home',
        data: { breadcrumb: 'nav.home' },
        loadComponent: () =>
          import('./foundation/home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'organization',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.organization' },
        loadChildren: () =>
          import('./foundation/organization/organization.routes').then(
            (m) => m.ORGANIZATION_ROUTES,
          ),
      },
      {
        path: 'working-calendar',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.workingCalendar' },
        loadChildren: () =>
          import('./foundation/working-calendar/working-calendar.routes').then(
            (m) => m.WORKING_CALENDAR_ROUTES,
          ),
      },
      {
        path: 'lookups',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.lookups' },
        loadChildren: () =>
          import('./foundation/lookup/lookup.routes').then(
            (m) => m.LOOKUP_ROUTES,
          ),
      },
      {
        path: 'roles',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.roles' },
        loadChildren: () =>
          import('./foundation/roles/roles.routes').then(
            (m) => m.ROLES_ROUTES,
          ),
      },
      {
        path: 'workflows',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.workflows' },
        loadChildren: () =>
          import('./foundation/workflow/workflow.routes').then(
            (m) => m.WORKFLOW_ROUTES,
          ),
      },
      {
        path: 'org-positions',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.orgPositions' },
        loadChildren: () =>
          import('./foundation/org-position/org-position.routes').then(
            (m) => m.ORG_POSITION_ROUTES,
          ),
      },
      {
        path: 'committees',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.committees' },
        loadChildren: () =>
          import('./foundation/committees/committees.routes').then(
            (m) => m.COMMITTEE_ROUTES,
          ),
      },
      {
        path: 'tasks',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.tasks' },
        loadChildren: () =>
          import('./foundation/tasks/tasks.routes').then((m) => m.TASKS_ROUTES),
      },
      {
        path: 'users',
        canActivate: [permissionGuard],
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
      {
        path: 'admin-settings',
        canActivate: [permissionGuard],
        data: { breadcrumb: 'nav.adminSettings' },
        loadChildren: () =>
          import('./foundation/admin-settings/admin-settings.routes').then(
            (m) => m.ADMIN_SETTINGS_ROUTES,
          ),
      },
    ],
  },
  {
    path: '',
    loadChildren: () =>
      import('./foundation/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
];
