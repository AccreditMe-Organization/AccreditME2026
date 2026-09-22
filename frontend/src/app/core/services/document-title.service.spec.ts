import {
  Component,
  EnvironmentInjector,
  WritableSignal,
  createEnvironmentInjector,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import {
  DocumentTitleService,
  PageNameRegistry,
  formatDocumentTitle,
} from './document-title.service';
import { NavigationAccessService } from './navigation-access.service';

@Component({ template: '', standalone: true })
class StubPageComponent {}

describe('formatDocumentTitle (ACC-79)', () => {
  it('puts the page first, then the tenant, then the product', () => {
    expect(
      formatDocumentTitle({
        page: 'Committees',
        tenant: 'Al Nakheel Specialist Hospital',
        platform: false,
      }),
    ).toBe('Committees · Al Nakheel Specialist Hospital — AccreditMe');
  });

  it('drops whichever half is not known yet, never leaving a stray separator', () => {
    expect(
      formatDocumentTitle({ page: 'Users', tenant: null, platform: false }),
    ).toBe('Users — AccreditMe');
    expect(
      formatDocumentTitle({ page: null, tenant: 'Al Manara', platform: false }),
    ).toBe('Al Manara — AccreditMe');
    expect(
      formatDocumentTitle({ page: null, tenant: null, platform: false }),
    ).toBe('AccreditMe');
  });

  it('names no tenant on the platform shell, which is not inside one', () => {
    expect(
      formatDocumentTitle({
        page: 'Tenants',
        tenant: 'Platform',
        platform: true,
      }),
    ).toBe('Tenants — AccreditMe Platform');
    expect(
      formatDocumentTitle({ page: null, tenant: null, platform: true }),
    ).toBe('AccreditMe Platform');
  });
});

describe('PageNameRegistry (ACC-79)', () => {
  // Page A and page B both titled "Committees": if A's destroy released by
  // text, it would wipe the entry B had just registered.
  it('releases by identity, so an outgoing page cannot clear the incoming one', () => {
    const registry = new PageNameRegistry();
    const outgoing = registry.register('Committees');
    const incoming = registry.register('Committees');

    registry.release(outgoing);
    expect(registry.entry()).toBe(incoming);

    registry.release(incoming);
    expect(registry.entry()).toBeNull();
  });
});

import { ADMIN_ACCESS } from '../navigation/admin-access';

describe('DocumentTitleService (ACC-79)', () => {
  let tenantName: WritableSignal<string>;
  let permissions: WritableSignal<string[]>;
  let platformAdmin: WritableSignal<boolean>;
  let service: DocumentTitleService;
  let router: Router;
  let translate: TranslateService;

  beforeEach(async () => {
    tenantName = signal('Al Nakheel Specialist Hospital');
    permissions = signal([ADMIN_ACCESS, 'users:view', 'committees:view']);
    platformAdmin = signal(false);
    const access: Partial<NavigationAccessService> = {
      tenantName: tenantName.asReadonly(),
      permissions: permissions.asReadonly(),
      hasPermission: (p: string) => permissions().includes(p),
      isModuleEnabled: () => false,
      isPlatformAdmin: () => platformAdmin(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: StubPageComponent }]),
        provideTranslateService({ lang: 'en' }),
        { provide: NavigationAccessService, useValue: access },
      ],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      nav: { users: 'Users', committees: 'Committees' },
      platform: { tenants: 'Tenants' },
    });
    translate.setTranslation('ar', {
      nav: { users: 'المستخدمون', committees: 'اللجان' },
    });
    await firstValueFrom(translate.use('en'));
    service = TestBed.inject(DocumentTitleService);
    router = TestBed.inject(Router);
  });

  it('names a section page from the rail, with its tenant', async () => {
    await router.navigateByUrl('/users');
    expect(service.documentTitle()).toBe(
      'Users · Al Nakheel Specialist Hospital — AccreditMe',
    );
  });

  // The page's own H1 wins — this is how a record page's tab names the record.
  it('prefers the name the page registered over the rail label', async () => {
    const registry = TestBed.inject(PageNameRegistry);
    await router.navigateByUrl('/committees/abc123');
    expect(service.documentTitle()).toBe(
      'Committees · Al Nakheel Specialist Hospital — AccreditMe',
    );

    const entry = registry.register('Quality Management Committee');
    expect(service.documentTitle()).toBe(
      'Quality Management Committee · Al Nakheel Specialist Hospital — AccreditMe',
    );

    registry.release(entry);
    expect(service.documentTitle()).toBe(
      'Committees · Al Nakheel Specialist Hospital — AccreditMe',
    );
  });

  it('adds the tenant when entitlements land after the navigation', async () => {
    tenantName.set('');
    await router.navigateByUrl('/users');
    expect(service.documentTitle()).toBe('Users — AccreditMe');

    tenantName.set('Al Manara Medical Center');
    expect(service.documentTitle()).toBe(
      'Users · Al Manara Medical Center — AccreditMe',
    );
  });

  it('follows a language switch', async () => {
    await router.navigateByUrl('/users');
    await firstValueFrom(translate.use('ar'));
    expect(service.documentTitle()).toBe(
      'المستخدمون · Al Nakheel Specialist Hospital — AccreditMe',
    );
  });

  // No raw keys in a tab. A page outside the rail — a user's own profile
  // without users:view — gets the tenant alone, never "nav.users".
  it('shows no page name rather than a raw key or a section the user cannot see', async () => {
    permissions.set([]);
    await router.navigateByUrl('/users/me-123');
    expect(service.documentTitle()).toBe(
      'Al Nakheel Specialist Hospital — AccreditMe',
    );
  });

  it('uses the platform format for a platform admin', async () => {
    platformAdmin.set(true);
    await router.navigateByUrl('/platform/tenants');
    expect(service.documentTitle()).toBe('Tenants — AccreditMe Platform');
  });

  // The sign-in page after a logout must not keep the last tenant's name.
  it('writes the title while attached and resets it when the shell is destroyed', async () => {
    const title = TestBed.inject(Title);
    const shellInjector = createEnvironmentInjector(
      [],
      TestBed.inject(EnvironmentInjector),
    );
    service.attach(shellInjector);

    await router.navigateByUrl('/users');
    TestBed.tick();
    expect(title.getTitle()).toBe(
      'Users · Al Nakheel Specialist Hospital — AccreditMe',
    );

    shellInjector.destroy();
    expect(title.getTitle()).toBe('AccreditMe');
  });
});
