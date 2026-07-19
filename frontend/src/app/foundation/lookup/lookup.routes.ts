import { Routes } from '@angular/router';

export const LOOKUP_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/lookup-category-list/lookup-category-list.component').then(
        (m) => m.LookupCategoryListComponent,
      ),
  },
  {
    path: ':key/values',
    loadComponent: () =>
      import('./components/lookup-value-list/lookup-value-list.component').then(
        (m) => m.LookupValueListComponent,
      ),
  },
];
