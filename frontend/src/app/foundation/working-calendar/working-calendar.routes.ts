import { Routes } from '@angular/router';

export const WORKING_CALENDAR_ROUTES: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./components/calendar-config/calendar-config.component').then(
        (m) => m.CalendarConfigComponent,
      ),
  },
  {
    path: 'holidays',
    loadComponent: () =>
      import('./components/public-holiday-list/public-holiday-list.component').then(
        (m) => m.PublicHolidayListComponent,
      ),
  },
];
