import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { AccreditMePreset } from './core/theme/accreditme-preset';
import { routes } from './app.routes';

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
    // Restores currentUser from the access_token cookie before the router's
    // initial navigation runs (provideRouter defaults to initialNavigation:
    // 'enabledBlocking', which waits on app initializers) — otherwise
    // authGuard would always see a null signal on refresh/direct navigation.
    provideAppInitializer(() => firstValueFrom(inject(AuthService).restoreSession())),
  ]
};
