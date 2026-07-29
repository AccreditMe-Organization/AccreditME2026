import { ApplicationConfig, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';
import { ConfirmationService } from 'primeng/api';
import { firstValueFrom } from 'rxjs';

import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideTranslateService({ lang: 'en' }),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
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
