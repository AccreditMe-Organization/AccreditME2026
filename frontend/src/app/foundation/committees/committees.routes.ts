import { Routes } from '@angular/router';

export const COMMITTEE_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/committee-list/committee-list.component').then(
        (m) => m.CommitteeListComponent,
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
