import { Routes } from '@angular/router';

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
    loadComponent: () =>
      import('./components/unassigned-tasks/unassigned-tasks.component').then(
        (m) => m.UnassignedTasksComponent,
      ),
  },
];
