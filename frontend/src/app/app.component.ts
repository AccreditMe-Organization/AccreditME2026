import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

// Notification bell + confirm dialog moved into AppShellComponent (ACC-13) —
// this root component now only ever renders <router-outlet> for whichever
// top-level route is active (the app shell for authenticated routes, or the
// bare pre-auth auth routes for login/accept-invitation/forgot-password).
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {}
