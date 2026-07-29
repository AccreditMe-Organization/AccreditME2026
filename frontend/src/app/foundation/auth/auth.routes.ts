import { Routes } from '@angular/router';

// Deliberately no authGuard on any of these — they exist precisely for
// unauthenticated users (or users mid-authentication, in the MFA case).
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    loadComponent: () =>
      import('./components/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'accept-invitation',
    loadComponent: () =>
      import('./components/accept-invitation/accept-invitation.component').then(
        (m) => m.AcceptInvitationComponent,
      ),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./components/forgot-password/forgot-password.component').then(
        (m) => m.ForgotPasswordComponent,
      ),
  },
];
