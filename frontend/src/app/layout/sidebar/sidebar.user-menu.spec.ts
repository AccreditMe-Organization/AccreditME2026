import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import en from '../../../assets/i18n/en.json';
import ar from '../../../assets/i18n/ar.json';
import { loadTranslationsForTest } from '../../core/formatting/testing';
import { AuthService } from '../../core/services/auth.service';
import { LanguageService } from '../../core/services/language.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';
import { SetupHealthService } from '../../foundation/setup-health/services/setup-health.service';
import { LayerStackService } from '../../shared/overlay/layer-stack.service';
import { preserveDocumentLanguage } from '../../../testing/document-language';
import { SidebarComponent } from './sidebar.component';

// ACC-235 — the rail's user menu is a CDK menu attached to the page body, as
// am-row-menu is: ABOVE its button, aligned to its start, in either language.
// The p-menu popup it replaced rendered inside the rail, and on a 390px phone
// covered its own button (English) or ran 78px off the screen (Arabic).
describe('SidebarComponent — the user menu (ACC-235)', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let logout: jasmine.Spy;

  preserveDocumentLanguage();

  function render(lang: 'en' | 'ar'): HTMLElement {
    logout = jasmine.createSpy('logout').and.returnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: () => false,
            isModuleEnabled: () => false,
            isPlatformAdmin: () => false,
            tenantName: signal('Al Nakheel Specialist Hospital').asReadonly(),
          },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'x@y.test', name: 'Dr. Yasser Al-Amri' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
            logout,
          },
        },
        { provide: SetupHealthService, useValue: { clear: () => undefined, summary: signal(null).asReadonly(), getSummary: () => of(null) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    TestBed.inject(LanguageService).use(lang);
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', false);
    // The app's page never scrolls (only <main> does), so neither does this
    // one: a test page's scrollbar shifts CDK's right-to-left placement by its
    // width (measured: 15px), which the app never has.
    document.documentElement.style.overflow = 'hidden';
    // Laid out at the bottom of a real-sized box, as the rail is.
    const host = fixture.nativeElement as HTMLElement;
    // The rail fills the window's height, so its button sits at the window's
    // bottom, as it does in the app (a box taller than the window put the
    // button off screen, and CDK squeezed the menu back above it regardless).
    host.style.cssText = 'position: fixed; inset-block: 0; inset-inline-start: 0; inline-size: 260px; display: block';
    document.body.appendChild(host);
    fixture.detectChanges();
    return host;
  }

  afterEach(() => {
    document.documentElement.style.overflow = '';
    fixture?.nativeElement.remove();
    document.querySelectorAll('.cdk-overlay-container').forEach((n) => n.remove());
  });

  const trigger = () => document.querySelector<HTMLButtonElement>('[data-testid="user-menu-trigger"]')!;
  const menu = () => document.querySelector<HTMLElement>('[data-testid="user-menu"]');

  async function open(): Promise<void> {
    trigger().click();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  for (const lang of ['en', 'ar'] as const) {
    it(`opens above its button, aligned to its start, outside the rail (${lang})`, async () => {
      const rail = render(lang);
      await open();
      const m = menu();
      expect(m).withContext('the menu opened').not.toBeNull();
      const b = trigger().getBoundingClientRect();
      const r = m!.getBoundingClientRect();
      expect(b.width).withContext('the button is laid out').toBeGreaterThan(0);
      expect(r.width).withContext('the menu is laid out').toBeGreaterThan(0);
      expect(r.bottom).withContext(`above the button (menu ${r.top}-${r.bottom}, button ${b.top}-${b.bottom}, vh ${innerHeight})`).toBeLessThanOrEqual(b.top + 1);
      expect(b.top - r.bottom).withContext('touching the button').toBeLessThanOrEqual(8);
      expect(b.bottom).withContext('the button is inside the window').toBeLessThanOrEqual(innerHeight + 1);
      const startGap = lang === 'ar' ? Math.abs(r.right - b.right) : Math.abs(r.left - b.left);
      expect(startGap).withContext(`aligned to the button’s start (menu ${r.left}-${r.right}, button ${b.left}-${b.right}, vw ${innerWidth}, client ${document.documentElement.clientWidth}, dir ${document.documentElement.dir})`).toBeLessThanOrEqual(2);
      expect(rail.contains(m)).withContext('not inside the rail').toBeFalse();
    });
  }

  it('My Profile opens the signed-in user’s record, and Sign out signs out', async () => {
    render('en');
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    await open();
    expect(Array.from(menu()!.querySelectorAll('button')).map((b) => b.textContent!.trim())).toEqual(['My Profile', 'Sign out']);
    menu()!.querySelector<HTMLButtonElement>('[data-action="profile"]')!.click();
    expect(navigate).toHaveBeenCalledWith(['/users', 'u1']);
    await open();
    menu()!.querySelector<HTMLButtonElement>('[data-action="logout"]')!.click();
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('is a layer while open, and Escape closes it with focus back on its button', async () => {
    render('en');
    const layers = TestBed.inject(LayerStackService);
    await open();
    expect(layers.depth()).toBe(1);
    // keyCode too: the CDK menu reads keyCode, not key.
    menu()!.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(layers.depth()).toBe(0);
  });
});
