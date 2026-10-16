import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NavigationEnd, Router, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../core/formatting/testing';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { IdleService } from '../../core/services/idle.service';
import { LayerStackService } from '../../shared/overlay/layer-stack.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { TopbarComponent } from '../topbar/topbar.component';
import { BreadcrumbComponent } from '../breadcrumb/breadcrumb.component';
import { LanguageToggleComponent } from '../language-toggle/language-toggle.component';
import { ImpersonationBannerComponent } from '../impersonation-banner/impersonation-banner.component';
import { NotificationBellComponent } from '../../foundation/notification/components/notification-bell/notification-bell.component';
import { IdleWarningComponent } from '../../core/components/idle-warning/idle-warning.component';
import { AppShellComponent, SHELL_PHONE_BELOW_PX } from './app-shell.component';

// ACC-232 — the phone shell. Below SHELL_PHONE_BELOW_PX the rail never sits
// beside <main>: it starts closed and opens over the page with a scrim, the
// page is inert while it is open, and Escape, the scrim, a link and the toggle
// close it, returning focus to the toggle. Above the line nothing changes.
//
// The shell, its top bar and the real rail are rendered; the breadcrumb, bell
// and language toggle are stand-ins, because none of them takes part.

@Component({ selector: 'app-breadcrumb', standalone: true, template: '' })
class BreadcrumbStub {}
@Component({ selector: 'app-notification-bell', standalone: true, template: '' })
class BellStub {}
@Component({ selector: 'app-language-toggle', standalone: true, template: '' })
class LanguageToggleStub {}
@Component({ selector: 'app-impersonation-banner', standalone: true, template: '' })
class BannerStub {}
@Component({ selector: 'app-idle-warning', standalone: true, template: '' })
class IdleWarningStub {}
@Component({ standalone: true, template: '<p>page</p>' })
class PageStub {}

/** A MediaQueryList the spec can flip, for the 768px line. */
class FakeMedia {
  matches: boolean;
  private listeners: ((e: MediaQueryListEvent) => void)[] = [];
  constructor(matches: boolean) {
    this.matches = matches;
  }
  addEventListener(_: string, cb: (e: MediaQueryListEvent) => void): void {
    this.listeners.push(cb);
  }
  removeEventListener(_: string, cb: (e: MediaQueryListEvent) => void): void {
    this.listeners = this.listeners.filter((l) => l !== cb);
  }
  set(matches: boolean): void {
    this.matches = matches;
    for (const l of this.listeners) l({ matches } as MediaQueryListEvent);
  }
}

describe('AppShellComponent — the phone shell (ACC-232)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<AppShellComponent>;
  let media: FakeMedia;
  let queries: string[];

  async function render(opts: { phone: boolean; language?: 'en' | 'ar' }): Promise<HTMLElement> {
    media = new FakeMedia(opts.phone);
    queries = [];
    spyOn(window, 'matchMedia').and.callFake((q: string) => {
      queries.push(q);
      return media as unknown as MediaQueryList;
    });

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
        { provide: IdleService, useValue: { start: () => undefined, stop: () => undefined } },
      ],
    });
    TestBed.overrideComponent(TopbarComponent, {
      remove: { imports: [BreadcrumbComponent, NotificationBellComponent, LanguageToggleComponent] },
      add: { imports: [BreadcrumbStub, BellStub, LanguageToggleStub] },
    });
    TestBed.overrideComponent(AppShellComponent, {
      remove: { imports: [ImpersonationBannerComponent, IdleWarningComponent] },
      add: { imports: [BannerStub, IdleWarningStub] },
    });
    loadTranslationsForTest({ en, ar });
    const language = opts.language ?? 'en';
    TestBed.inject(TranslateService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';

    fixture = TestBed.createComponent(AppShellComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
    await settle();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }

  afterEach(() => fixture?.nativeElement.remove());

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const toggle = (): HTMLButtonElement => el().querySelector<HTMLButtonElement>('[data-rail-toggle] button')!;
  const main = (): HTMLElement => el().querySelector('main')!;
  const drawer = (): HTMLElement | null => el().querySelector('[data-rail-drawer]');
  const scrim = (): HTMLElement | null => el().querySelector('[data-rail-scrim]');
  const asides = (): HTMLElement[] => Array.from(el().querySelectorAll('aside'));

  async function open(): Promise<void> {
    toggle().click();
    await settle();
  }

  it('asks for exactly the 768px line', async () => {
    await render({ phone: true });
    // The number itself, not the constant: a test reading the constant passes
    // whatever the constant says.
    expect(SHELL_PHONE_BELOW_PX).toBe(768);
    expect(queries).toContain('(max-width: 767.98px)');
  });

  describe('on a phone', () => {
    it('starts closed: no rail beside <main>, nothing inert, the toggle says it is closed', async () => {
      await render({ phone: true });
      expect(asides().length).withContext('a rail beside the page').toBe(0);
      expect(drawer()).toBeNull();
      expect(main().hasAttribute('inert')).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(toggle().getAttribute('aria-label')).toBe('Open navigation');
    });

    it('opens over the page at 260px with a scrim; the page is inert and focus moves into the rail', async () => {
      await render({ phone: true });
      await open();

      expect(drawer()).not.toBeNull();
      expect(scrim()).not.toBeNull();
      expect(asides().length).withContext('one rail, in the drawer').toBe(1);
      expect(drawer()!.contains(asides()[0])).toBe(true);
      expect(Math.round(drawer()!.getBoundingClientRect().width)).toBe(260);
      expect(main().hasAttribute('inert')).toBe(true);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
      expect(toggle().getAttribute('aria-label')).toBe('Close navigation');
      expect(drawer()!.contains(document.activeElement)).withContext('focus is in the rail').toBe(true);
    });

    it('Escape closes it and focus returns to the toggle', async () => {
      await render({ phone: true });
      await open();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(drawer()).toBeNull();
      expect(main().hasAttribute('inert')).toBe(false);
      expect(document.activeElement).toBe(toggle());
    });

    it('Escape belongs to a layer above it: with one on top, the rail stays open', async () => {
      await render({ phone: true });
      await open();
      const layers = TestBed.inject(LayerStackService);
      const above = layers.push();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settle();
      expect(drawer()).not.toBeNull();
      layers.remove(above);
    });

    it('the scrim closes it, and focus returns to the toggle', async () => {
      await render({ phone: true });
      await open();
      scrim()!.click();
      await settle();
      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(toggle());
    });

    it('choosing a link closes it', async () => {
      await render({ phone: true });
      await open();
      const link = drawer()!.querySelector<HTMLAnchorElement>('a[href]');
      expect(link).withContext('the rail has a link to choose').not.toBeNull();
      link!.click();
      await settle();
      expect(drawer()).toBeNull();
      expect(main().hasAttribute('inert')).toBe(false);
    });

    it('choosing the page already open closes it, though nothing navigates', async () => {
      await render({ phone: true });
      await open();
      const link = drawer()!.querySelector<HTMLAnchorElement>('a[href]')!;
      await TestBed.inject(Router).navigateByUrl(link.getAttribute('href')!);
      await settle();
      // The navigation closed it; open it again on the page that link names.
      if (!drawer()) await open();
      const navigations: unknown[] = [];
      const sub = TestBed.inject(Router).events.subscribe((e) => {
        if (e instanceof NavigationEnd) navigations.push(e);
      });
      drawer()!.querySelector<HTMLAnchorElement>(`a[href="${link.getAttribute('href')}"]`)!.click();
      await settle();
      sub.unsubscribe();
      expect(navigations.length).withContext('the same page: no navigation to close it').toBe(0);
      expect(drawer()).toBeNull();
      expect(document.activeElement).toBe(toggle());
    });

    it('the toggle closes it again', async () => {
      await render({ phone: true });
      await open();
      toggle().click();
      await settle();
      expect(drawer()).toBeNull();
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(toggle());
    });

    it('in Arabic it opens from the right, with an Arabic label', async () => {
      await render({ phone: true, language: 'ar' });
      expect(toggle().getAttribute('aria-label')).toBe('فتح التنقل');
      await open();
      const container = drawer()!.parentElement!.getBoundingClientRect();
      const box = drawer()!.getBoundingClientRect();
      // Non-vacuity: laid out, and narrower than its container.
      expect(container.width).toBeGreaterThan(box.width);
      expect(Math.round(box.right)).withContext('against the right edge').toBe(Math.round(container.right));
      expect(Math.round(box.left)).not.toBe(Math.round(container.left));
      expect(toggle().getAttribute('aria-label')).toBe('إغلاق التنقل');
    });
  });

  describe('crossing the 768px line', () => {
    it('phone → desktop while open: nothing stays inert, the rail is beside the page again', async () => {
      await render({ phone: true });
      await open();
      expect(main().hasAttribute('inert')).toBe(true);

      media.set(false);
      await settle();
      expect(main().hasAttribute('inert')).toBe(false);
      expect(drawer()).toBeNull();
      expect(scrim()).toBeNull();
      expect(asides().length).toBe(1);
      expect(toggle().hasAttribute('aria-expanded')).withContext('desktop toggle unchanged').toBe(false);
    });

    it('desktop → phone: the rail starts closed, and Escape is not left listening for an open rail', async () => {
      await render({ phone: false });
      media.set(true);
      await settle();
      expect(asides().length).toBe(0);
      expect(drawer()).toBeNull();
      expect(main().hasAttribute('inert')).toBe(false);
      expect(TestBed.inject(LayerStackService).depth()).toBe(0);
    });

    it('a phone that crosses back keeps no layer on the stack', async () => {
      await render({ phone: true });
      await open();
      expect(TestBed.inject(LayerStackService).depth()).toBe(1);
      media.set(false);
      await settle();
      expect(TestBed.inject(LayerStackService).depth()).toBe(0);
    });
  });

  describe('on a desktop, unchanged', () => {
    it('the rail is beside the page at 260, collapses to 72 with the toggle, and nothing is inert', async () => {
      await render({ phone: false });
      expect(asides().length).toBe(1);
      expect(Math.round(asides()[0].getBoundingClientRect().width)).toBe(260);
      expect(toggle().getAttribute('aria-label')).toBe('Collapse navigation');
      expect(toggle().hasAttribute('aria-expanded')).toBe(false);

      toggle().click();
      await settle();
      // The width animates; the class is the state.
      expect(asides()[0].classList).toContain('w-[72px]');
      expect(toggle().getAttribute('aria-label')).toBe('Expand navigation');
      expect(drawer()).toBeNull();
      expect(main().hasAttribute('inert')).toBe(false);
    });
  });
});
