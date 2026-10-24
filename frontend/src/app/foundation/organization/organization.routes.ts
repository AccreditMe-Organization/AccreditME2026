import { Routes } from '@angular/router';

export const ORGANIZATION_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/org-unit-tree/org-unit-tree.component').then(
        (m) => m.OrgUnitTreeComponent,
      ),
  },
  // ACC-120 slice 11, PR D — one unit's record. Guarded by the parent's
  // permissionGuard; its breadcrumb is the unit's ancestry, set by the page
  // (BreadcrumbParentService.setTrail).
  //
  // PR F — these routes are loaded twice: under `/organization` (Administration,
  // admin:access + org:view) and under `/org` (Quality management, org:view,
  // read-only by its route data). Each page reads its mode with injectOrgPages().
  {
    path: 'units/:id',
    loadComponent: () =>
      import('./components/org-unit-record/org-unit-record.component').then((m) => m.OrgUnitRecordComponent),
  },
];
