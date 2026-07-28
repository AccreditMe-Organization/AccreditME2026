import { Routes } from '@angular/router';

export const ORG_POSITION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/position-list/position-list.component').then(
        (m) => m.PositionListComponent,
      ),
  },
];
