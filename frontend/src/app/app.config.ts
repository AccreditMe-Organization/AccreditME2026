import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom, of, switchMap } from 'rxjs';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { NavigationAccessService } from './core/services/navigation-access.service';
import { AccreditMePreset } from './core/theme/accreditme-preset';
import { routes } from './app.routes';

// Exported (not inlined into provideAppInitializer below) so it can be unit
// tested directly via TestBed.runInInjectionContext — proving the ORDERING
// guarantee (loadAccess() is not even attempted until restoreSession() has
// resolved, and the returned promise does not settle until both requests
// complete) is the whole point of ACC-21; a steady-state test of the guard
// alone can't exercise that (see navigation-access.service.ts's own comment
// for why loadAccess() has two call sites, not one).
export function initializeSession(): Promise<void> {
  const authService = inject(AuthService);
  const navigationAccessService = inject(NavigationAccessService);

  return firstValueFrom(
    authService.restoreSession().pipe(
      switchMap(() =>
        authService.isAuthenticated() ? navigationAccessService.loadAccess() : of(undefined),
      ),
    ),
  );
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTranslateService({ lang: 'en' }),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    // PrimeNG's provider-based theming (v18+) — component styling does not
    // exist at all without this (was missing since scaffold, see
    // fix/primeng-theme-provider). darkModeSelector: false pins every
    // PrimeNG component to the light color scheme: tokens.scss's brand
    // tokens are only defined for a light surface, and the dark sidebar is
    // a fixed design element rendered by our own SidebarComponent (reads
    // --am-sidebar-bg directly, not a themed PrimeNG surface), so it stays
    // dark regardless of this setting — there's no real dark-mode feature
    // to switch to yet.
    provideAnimationsAsync(),
    providePrimeNG({
      theme: {
        preset: AccreditMePreset,
        options: { darkModeSelector: false },
      },
    }),
    // App-wide, registered once — every component pays down its
    // window.confirm() TODO by injecting this directly rather than each
    // providing its own instance (Step 9, Section 12 Discussion 5).
    ConfirmationService,
    // Restores currentUser AND loads platform-admin/tenant permission data
    // before the router's initial navigation runs (provideRouter defaults to
    // initialNavigation: 'enabledBlocking', which waits on app initializers)
    // — otherwise authGuard would always see a null signal on refresh/direct
    // navigation (ACC-12), and platformAdminGuard could race
    // NavigationAccessService's async permission load on a hard reload of a
    // deep /platform/* URL, incorrectly bouncing a real platform admin to
    // /organization (ACC-21). See initializeSession() above and
    // navigation-access.service.ts's header comment for why loadAccess()
    // still ALSO has a second call site in AppShellComponent.ngOnInit().
    provideAppInitializer(initializeSession),
  ]
};
