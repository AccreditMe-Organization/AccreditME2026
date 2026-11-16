import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { IdleService } from '../../core/services/idle.service';
import { AmConfirmService, CONFIRM_ACCEPT_CLASS } from '../../shared/components/confirm/am-confirm.service';
import { ConfirmHostGate } from '../../shared/components/confirm/confirm-host-gate';
import { LayerStackService } from '../../shared/overlay/layer-stack.service';
import { SessionLimitState } from '../../core/services/session-limit-state';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { TopbarComponent } from '../topbar/topbar.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { LanguageToggleComponent } from '../language-toggle/language-toggle.component';
import { ImpersonationBannerComponent } from '../impersonation-banner/impersonation-banner.component';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';
import { AppShellComponent } from './app-shell.component';

// ACC-90 — the shell's pop-ups load after start-up (@defer) and are there the
// moment they are needed:
//   - the confirm host loads on idle, or at once when a confirm is asked for
//     first (`when confirmGate.needed()`); that confirm is held and shown, with
//     its focus on the action, not lost;
//   - the idle warning loads on idle, or at once when it is due.
//
// IDLE IS HELD BACK. The browser's requestIdleCallback is replaced before the
// shell is built (Angular's IdleScheduler binds it then), and nothing calls it
// unless a test says so. So a block that appears did so through its `when`,
// and removing that `when` turns the early-confirm test red: the confirm would
// wait for an idle that never comes.

@Component({ selector: 'app-breadcrumb', standalone: true, template: '' })
class BreadcrumbStub {}
@Component({ selector: 'app-notification-bell', standalone: true, template: '' })
class BellStub {}
@Component({ selector: 'app-language-toggle', standalone: true, template: '' })
class LanguageToggleStub {}
@Component({ selector: 'app-impersonation-banner', standalone: true, template: '' })
class BannerStub {}
@Component({ standalone: true, template: '<p>page</p>' })
class PageStub {}

describe('AppShellComponent — pop-ups loaded after start-up (ACC-90)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<AppShellComponent>;
  let idleCallbacks: (() => void)[];
  const warningVisible = signal(false);

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
    }
  }

  // ACC-248 — bounded by TURNS, not the wall clock: PrimeNG's motion and the
  // focus that follows it run on CSS time.
  async function until(condition: () => boolean, what: string, turns = 100): Promise<void> {
    for (let turn = 0; !condition(); turn++) {
      if (turn >= turns) throw new Error(`timed out waiting for ${what}`);
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  /** Lets the browser be idle, once: whatever waited on idle runs. */
  async function goIdle(): Promise<void> {
    const waiting = idleCallbacks;
    idleCallbacks = [];
    for (const cb of waiting) cb();
    await settle();
  }

  async function render(opts: { limitEndsInMs?: number } = {}): Promise<void> {
    idleCallbacks = [];
    warningVisible.set(false);
    spyOn(window, 'requestIdleCallback').and.callFake((cb: IdleRequestCallback) => {
      idleCallbacks.push(() => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline));
      return idleCallbacks.length;
    });
    spyOn(window, 'cancelIdleCallback').and.callFake(() => undefined);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [
        provideRouter([{ path: '**', component: PageStub }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        ConfirmationService,
        {
          provide: NavigationAccessService,
          useValue: {
            loadAccess: () => of(undefined),
            hasPermission: () => false,
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
            tenantName: signal('Al Nakheel').asReadonly(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'x@y.test', name: 'Huda Al-Harbi' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
          },
        },
        {
          provide: IdleService,
          useValue: {
            start: () => undefined,
            stop: () => undefined,
            warningVisible: warningVisible.asReadonly(),
            secondsRemaining: signal(120).asReadonly(),
            announceSeconds: signal<number | null>(120).asReadonly(),
            extend: () => undefined,
            signOut: () => undefined,
          },
        },
      ],
    });
    TestBed.overrideComponent(TopbarComponent, {
      remove: { imports: [BreadcrumbComponent, NotificationBellComponent, LanguageToggleComponent] },
      add: { imports: [BreadcrumbStub, BellStub, LanguageToggleStub] },
    });
    TestBed.overrideComponent(AppShellComponent, {
      remove: { imports: [ImpersonationBannerComponent] },
      add: { imports: [BannerStub] },
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    if (opts.limitEndsInMs !== undefined) {
      TestBed.inject(SessionLimitState).setEndsAt(new Date(Date.now() + opts.limitEndsInMs).toISOString());
    }

    fixture = TestBed.createComponent(AppShellComponent);
    document.body.appendChild(fixture.nativeElement);
    await settle();
  }

  afterEach(() => {
    fixture?.destroy();
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((el) => el.remove());
  });

  const host = () => document.querySelector('am-confirm-host');
  const confirm = () => document.querySelector<HTMLElement>('.p-confirmdialog');
  const ask = (accept: () => void = () => undefined) =>
    TestBed.inject(AmConfirmService).ask({
      header: 'Remove the seat?',
      message: 'Huda leaves the committee.',
      acceptLabel: 'Remove',
      tone: 'neutral',
      accept,
    });

  it('neither pop-up is there at start-up', async () => {
    await render();
    expect(host()).withContext('the confirm host is not loaded at start-up').toBeNull();
    expect(document.querySelector('app-idle-warning')).withContext('the idle warning is not loaded at start-up').toBeNull();
    expect(document.querySelector('app-session-limit-warning'))
      .withContext('the 12-hour limit warning is not loaded at start-up')
      .toBeNull();
    expect(idleCallbacks.length).withContext('both wait on idle').toBeGreaterThan(0);
  });

  it('a confirm asked for before idle loads the host and is shown, focused on its action', async () => {
    await render();
    expect(host()).withContext('non-vacuity: no host before the confirm').toBeNull();
    let accepted = false;
    ask(() => {
      accepted = true;
    });
    await settle();

    expect(host()).withContext('the confirm loaded the host without waiting for idle').not.toBeNull();
    expect(confirm()).withContext('the confirm asked for while loading is shown').not.toBeNull();
    expect(confirm()!.textContent).toContain('Remove the seat?');
    await until(() => confirm()!.contains(document.activeElement), 'the confirm to take focus');
    const action = confirm()!.querySelector<HTMLElement>(`button.${CONFIRM_ACCEPT_CLASS}`)!;
    expect(document.activeElement).withContext('focus lands on the action').toBe(action);

    action.click();
    await settle();
    expect(accepted).withContext('its answer still reaches the caller').toBeTrue();
  });

  it('on idle the host loads, and a later confirm shows at once', async () => {
    await render();
    await goIdle();
    expect(host()).withContext('idle loaded the host').not.toBeNull();
    ask();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(confirm()).withContext('shown with no load to wait for').not.toBeNull();
  });

  /** Sign-out, then sign-in: this shell goes, and a new one is built in the same app. */
  async function signOutAndIn(): Promise<void> {
    fixture.destroy();
    fixture.nativeElement.remove();
    fixture = TestBed.createComponent(AppShellComponent);
    document.body.appendChild(fixture.nativeElement);
    await settle();
  }

  it('a confirm still waiting at sign-out is dropped: the next shell never shows it', async () => {
    await render();
    const layers = TestBed.inject(LayerStackService);
    expect(layers.depth()).withContext('no layer before the confirm').toBe(0);
    const accept = jasmine.createSpy('accept');
    const reject = jasmine.createSpy('reject');
    TestBed.inject(AmConfirmService).ask({
      header: 'Remove the seat?',
      message: 'Huda leaves the committee.',
      acceptLabel: 'Remove',
      tone: 'neutral',
      accept,
      reject,
    });
    // Non-vacuity: it is waiting for a host that has not loaded, with its layer.
    expect(TestBed.inject(ConfirmHostGate).needed()).withContext('the confirm is waiting').toBeTrue();
    expect(layers.depth()).withContext('its layer is pushed').toBe(1);
    expect(host()).toBeNull();

    // Signed out before the host loaded, then signed in again: the new shell's host loads.
    await signOutAndIn();
    await goIdle();
    expect(host()).withContext("the new shell's host loaded").not.toBeNull();
    await until(() => true, 'a turn');
    await settle();

    expect(confirm()).withContext('the old confirm is never shown').toBeNull();
    expect(accept).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
    expect(layers.depth()).withContext('its layer was released').toBe(0);
  });

  it("after sign-in, a confirm asked for once the new shell's host is ready shows as normal", async () => {
    await render();
    await signOutAndIn();
    await goIdle();
    expect(host()).withContext("the new shell's host loaded").not.toBeNull();
    ask();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(confirm()).withContext('shown at once').not.toBeNull();
    expect(confirm()!.textContent).toContain('Remove the seat?');
  });

  it('the idle warning loads the moment it is due, before idle', async () => {
    await render();
    expect(document.querySelector('app-idle-warning')).withContext('non-vacuity: not loaded yet').toBeNull();
    warningVisible.set(true);
    await settle();
    expect(document.querySelector('app-idle-warning')).withContext('loaded when due').not.toBeNull();
    const dialog = document.querySelector<HTMLElement>('.p-dialog[role="alertdialog"]');
    expect(dialog).withContext('the warning is on screen').not.toBeNull();
    expect(dialog!.textContent).toContain(en.session.idle.staySignedIn);
  });

  // ACC-126 — the 12-hour limit warning, deferred like the idle warning: it
  // loads the moment it is due, without waiting for idle.
  it("the session limit warning loads the moment it is due, before idle", async () => {
    await render({ limitEndsInMs: 5 * 60 * 1000 });
    expect(document.querySelector("app-session-limit-warning")).withContext("loaded when due").not.toBeNull();
    const dialog = document.querySelector<HTMLElement>(".p-dialog[role=\"alertdialog\"]");
    expect(dialog).withContext("the warning is on screen").not.toBeNull();
    expect(dialog!.textContent).toContain(en.session.limit.title);
  });

  it("the session limit warning stays unloaded while the limit is more than 10 minutes away", async () => {
    await render({ limitEndsInMs: 3 * 60 * 60 * 1000 });
    expect(document.querySelector("app-session-limit-warning")).toBeNull();
  });
});
