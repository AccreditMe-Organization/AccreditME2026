import { Routes } from '@angular/router';
import { leaveGuard } from '../roles/permission-matrix/leave-guard';

export const COMMITTEE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/committee-list/committee-list.component').then(
        (m) => m.CommitteeListComponent,
      ),
  },
  // ACC-240 — literal paths before parameters (ACC-79). Each inherits the
  // committees route's committees:view; who may DO anything is the server's
  // canRaise and actions.
  {
    path: ':id/change-requests/new',
    canDeactivate: [leaveGuard],
    loadComponent: () =>
      import('./change-requests/committee-change-request-form.component').then(
        (m) => m.CommitteeChangeRequestFormComponent,
      ),
  },
  {
    path: ':id/change-requests/:requestId/edit',
    canDeactivate: [leaveGuard],
    loadComponent: () =>
      import('./change-requests/committee-change-request-form.component').then(
        (m) => m.CommitteeChangeRequestFormComponent,
      ),
  },
  {
    path: ':id/change-requests/:requestId',
    loadComponent: () =>
      import('./change-requests/committee-change-request-page.component').then(
        (m) => m.CommitteeChangeRequestPageComponent,
      ),
  },
  {
    path: ':id',
    loadComponent: () =>
      import('./components/committee-detail/committee-detail.component').then(
        (m) => m.CommitteeDetailComponent,
      ),
  },
];
