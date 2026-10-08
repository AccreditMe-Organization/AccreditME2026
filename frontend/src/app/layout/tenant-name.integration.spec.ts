import { Component, Injector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Routes, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Title } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import {
  provideTranslateService,
  provideTranslateLoader,
  TranslateNoOpLoader,
} from '@ngx-translate/core';
import { environment } from '../../environments/environment';
import { BreadcrumbComponent } from './breadcrumb/breadcrumb.component';
import { SidebarComponent } from './sidebar/sidebar.component';
import { NavigationAccessService } from '../core/services/navigation-access.service';
import { LanguageService } from '../core/services/language.service';
import { DocumentTitleService } from '../core/services/document-title.service';
import { AuthService } from '../core/services/auth.service';
import { preserveDocumentLanguage } from '../../testing/document-language';

// ACC-161 — THE TENANT NAME, OVER THE REAL CHAIN.
//
// The breadcrumb, the tab title and the rail's user card each have their own
// spec, and all three MOCK NavigationAccessService with a writable signal. A
// language-switch test there would prove only that the test can write to its
// own mock. So this spec wires the real thing end to end: entitlements over
// HTTP into the REAL NavigationAccessService, the REAL LanguageService, the
// REAL BreadcrumbComponent and SidebarComponent, and the REAL
// DocumentTitleService writing through Angular's Title — then switches the
// language ONCE, with no reload and no navigation, and reads what all three
// actually render.
//
// AuthService is the one mock: the sidebar needs a signed-in user to draw its
// user card at all, and the user is not part of the chain under test.

const EN = 'Al Nakheel Specialist Hospital';
const AR = 'مستشفى النخيل التخصصي';

@Component({
  standalone: true,
  imports: [BreadcrumbComponent, SidebarComponent],
  template: `<app-breadcrumb /><app-sidebar [collapsed]="false" />`,
})
class ShellComponent {}

@Component({ standalone: true, template: '' })
class LeafComponent {}

const routes: Routes = [
  { path: '', component: ShellComponent, children: [{ path: 'home', component: LeafComponent }] },
];

describe('tenant name across the shell, real chain (ACC-161)', () => {
  // ACC-184 — the Arabic session runs the real LanguageService; tear down, then
  // put <html> back as it was.
  preserveDocumentLanguage();

  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'u1', email: 'h@x.test', name: 'Dr. Hessa Al-Dosari' }).asReadonly(),
            displayPreferences: signal(null).asReadonly(),
          },
        },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  async function render(nameAr: string | null) {
    const harness = await RouterTestingHarness.create();
    TestBed.inject(DocumentTitleService).attach(TestBed.inject(Injector));
    TestBed.inject(NavigationAccessService).loadAccess().subscribe();
    http.expectOne(`${environment.apiUrl}/roles/my-permissions`).flush([]);
    http.expectOne(`${environment.apiUrl}/tenant/entitlements`).flush({
      name: EN,
      nameAr,
      slug: 'al-nakheel',
      isPlatformOrg: false,
      modules: {},
    });
    await harness.navigateByUrl('/home');
    const settle = (): void => {
      TestBed.tick();
      harness.detectChanges();
    };
    settle();

    const root = harness.fixture.nativeElement as HTMLElement;
    // Each read is of what the consumer RENDERS, not of a signal.
    const read = () => ({
      // /home is the landing page, so the trail is the tenant root alone.
      breadcrumb: root.querySelector('app-breadcrumb nav')?.textContent?.trim() ?? null,
      railCard: root.querySelector('app-sidebar')?.textContent ?? '',
      tabTitle: TestBed.inject(Title).getTitle(),
    });
    const switchTo = (lang: 'en' | 'ar'): void => {
      TestBed.inject(LanguageService).use(lang).subscribe();
      settle();
    };
    return { read, switchTo };
  }

  // THE RULE: one load, one switch, no reload, no navigation — all three move.
  it('switches the breadcrumb root, the tab title and the rail card together, and back', async () => {
    const { read, switchTo } = await render(AR);

    // Guard first: in English, all three really are drawn and really carry
    // the tenant's name. Without this, "shows the Arabic name" could pass
    // against an element that never rendered at all.
    const en = read();
    expect(en.breadcrumb).withContext('breadcrumb root, English').toBe(EN);
    expect(en.railCard).withContext('rail user card, English').toContain(EN);
    expect(en.tabTitle).withContext('tab title, English').toContain(EN);

    switchTo('ar');
    const ar = read();
    expect(ar.breadcrumb).withContext('breadcrumb root, Arabic').toBe(AR);
    expect(ar.railCard).withContext('rail user card, Arabic').toContain(AR);
    expect(ar.railCard).withContext('rail user card, Arabic').not.toContain(EN);
    expect(ar.tabTitle).withContext('tab title, Arabic').toContain(AR);
    expect(ar.tabTitle).withContext('tab title, Arabic').not.toContain(EN);

    switchTo('en');
    const back = read();
    expect(back.breadcrumb).withContext('breadcrumb root, back to English').toBe(EN);
    expect(back.railCard).withContext('rail user card, back to English').toContain(EN);
    expect(back.tabTitle).withContext('tab title, back to English').toContain(EN);
  });

  it('shows the English name in all three in an Arabic session when the tenant has no Arabic name', async () => {
    const { read, switchTo } = await render(null);
    switchTo('ar');
    const ar = read();
    expect(ar.breadcrumb).withContext('breadcrumb root').toBe(EN);
    expect(ar.railCard).withContext('rail user card').toContain(EN);
    expect(ar.tabTitle).withContext('tab title').toContain(EN);
    switchTo('en');
  });
});
