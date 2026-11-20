import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/guards/permission.guard';

/**
 * ACC-316 PR 6 — the list, then a meeting's own page. The page carries its own
 * canActivate (ACC-79's rule for a child route) and no route permission: who
 * may open a meeting is the server's parent rule (plan §4.1); anyone else gets
 * the page's not-found state.
 */
export const MEETING_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/meeting-list/meeting-list.component').then((m) => m.MeetingListComponent),
  },
  {
    path: ':id',
    canActivate: [permissionGuard],
    // PR 8b — through the host, so a series' previous and next (same route, another id) open a new page.
    loadComponent: () => import('./components/meeting-page/meeting-page-host.component').then((m) => m.MeetingPageHostComponent),
  },
];
