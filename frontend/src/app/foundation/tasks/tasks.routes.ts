import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

// ACC-70 — 'unassigned' carries its own guard because the shared mapping
// declares a STRICTER permission for it (tasks:manage) than for its parent
// (tasks:view). The parent's guard runs first and still applies, so
// tasks:view is effectively a prerequisite for reaching this child — that
// follows from the route nesting, whereas the sidebar lists the two as
// siblings. No seeded role holds tasks:manage without tasks:view, so nothing
// is excluded today; a tenant-created custom role could be, which is why the
// nesting is recorded here rather than left to be rediscovered.
export const TASKS_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/my-tasks/my-tasks.component').then((m) => m.MyTasksComponent),
  },
  {
    path: 'all',
    loadComponent: () =>
      import('./components/task-list/task-list.component').then((m) => m.TaskListComponent),
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
