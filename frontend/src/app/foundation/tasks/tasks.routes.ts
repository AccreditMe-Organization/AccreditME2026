import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

// ACC-79 — the parent path ('', My tasks) requires NO permission, matching
// GET /tasks/my-tasks, which ACC-70 ungated because it is self-scoped. The
// parent route keeps its canActivate, so re-adding a mapping for 'tasks' would
// take effect without touching this file.
//
// Every child that is NOT self-scoped therefore needs its OWN guard. A child
// without canActivate never runs the guard at all, and inheriting from the
// parent no longer protects anything:
//   - 'all'        -> committees:view_all_tasks (View all tasks, ACC-244)
//   - 'unassigned' -> committees:manage_tasks   (Manage tasks, ACC-244)
// Each from its nav item. Committees are the only record type with task keys;
// lane A's slice 3 replaces both with saved views of one /tasks list.
export const TASKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/my-tasks/my-tasks.component').then(
        (m) => m.MyTasksComponent,
      ),
  },
  {
    path: 'all',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/task-list/task-list.component').then(
        (m) => m.TaskListComponent,
      ),
  },
  {
    path: 'unassigned',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/unassigned-tasks/unassigned-tasks.component').then(
        (m) => m.UnassignedTasksComponent,
      ),
  },
  // ACC-228 — a task's own page. LAST, after every literal path, so 'all' and
  // 'unassigned' are never read as task ids. Its own canActivate (ACC-79's
  // rule for a child route); no ROUTE_PERMISSIONS entry, deliberately: who may
  // open a task is the server's task visibility rule (ACC-244), and an assignee
  // with no task key must reach their own. Everyone else gets the page's
  // not-found state.
  {
    path: ':id',
    canActivate: [permissionGuard],
    loadComponent: () =>
      import('./components/task-page/task-page.component').then((m) => m.TaskPageComponent),
  },
];
