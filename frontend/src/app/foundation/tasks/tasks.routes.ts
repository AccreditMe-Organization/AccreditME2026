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
//   - 'all'        -> tasks:view   (can return any task in the tenant)
//   - 'unassigned' -> tasks:manage (administrative triage view)
//
// This also retires a quirk ACC-70 recorded here: while the parent required
// tasks:view, that was an implicit prerequisite for 'unassigned' too, which
// could have excluded a custom role holding tasks:manage alone. It no longer
// is — each child now requires exactly its own permission.
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
];
