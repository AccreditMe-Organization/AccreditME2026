import { Routes, Router } from '@angular/router';
import { inject } from '@angular/core';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * ACC-120 slice 3 — the old pages are saved views of the one /tasks list now.
 * A redirect, never a second copy: the view is added and every other query
 * parameter kept, so /tasks/unassigned?reassign=<id> (an older Setup health
 * Fix) still opens Reassign for that task.
 */
const toView = (view: 'all' | 'unassigned') => ({ queryParams }: { queryParams: Record<string, unknown> }) =>
  inject(Router).createUrlTree(['/tasks'], { queryParams: { ...queryParams, view } });

// ACC-79 — the parent path ('', the /tasks shell) requires NO permission: My
// tasks reads GET /tasks/my-tasks, which ACC-70 ungated because it is
// self-scoped, and which other views a viewer has is GET /tasks/views' answer,
// shown in the shell rather than guarded by a route (ACC-120 slice 3). A view
// the viewer lacks is refused by its own list, with the server's sentence.
export const TASKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/tasks-shell/tasks-shell.component').then((m) => m.TasksShellComponent),
  },
  { path: 'all', pathMatch: 'full', redirectTo: toView('all') },
  { path: 'unassigned', pathMatch: 'full', redirectTo: toView('unassigned') },
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
