import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { SidebarComponent } from './sidebar.component';
import { AuthService } from '../../core/services/auth.service';
import { NavigationAccessService } from '../../core/services/navigation-access.service';

// ACC-79 — the rail's own behaviour. WHICH items appear is nav-items.spec.ts's
// job; this covers what the rail derives and how it presents groups.
describe('SidebarComponent (ACC-79)', () => {
  let fixture: ComponentFixture<SidebarComponent>;

  function render(opts: {
    permissions?: string[];
    platformAdmin?: boolean;
    name?: string;
    tenantName?: string;
    collapsed?: boolean;
  }): HTMLElement {
    const access: Partial<NavigationAccessService> = {
      hasPermission: (p: string) => (opts.permissions ?? []).includes(p),
      isModuleEnabled: () => false,
      isPlatformAdmin: () => opts.platformAdmin ?? false,
      tenantName: signal(
        opts.tenantName ?? 'Al Nakheel Specialist Hospital',
      ).asReadonly(),
    };
    const auth: Partial<AuthService> = {
      currentUser: signal({
        id: 'u1',
        email: 'x@y.test',
        name: opts.name ?? 'Dr. Yasser Al-Amri',
      }).asReadonly(),
    } as Partial<AuthService>;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([]),
        provideTranslateService(),
        { provide: NavigationAccessService, useValue: access },
        { provide: AuthService, useValue: auth },
      ],
    });
    fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('collapsed', opts.collapsed ?? false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  describe('product kicker — derived from what the rail shows, never a role name', () => {
    it('says Quality when there is no Administration group', () => {
      render({ permissions: ['committees:view'] });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.quality',
      );
    });

    // A custom role with a single admin permission gets the admin face. That is
    // the consequence of deriving rather than naming, and it is the right one:
    // they are administering part of this tenant.
    it('says Tenant admin as soon as any Administration item is visible', () => {
      render({ permissions: ['lookups:view'] });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.admin',
      );
    });

    it('says Platform for a platform admin', () => {
      render({ platformAdmin: true });
      expect(fixture.componentInstance.productLabelKey()).toBe(
        'shell.product.platform',
      );
    });
  });

  describe('initials', () => {
    it('skips an honorific, so Dr. Yasser Al-Amri reads YA rather than DY', () => {
      render({ name: 'Dr. Yasser Al-Amri' });
      expect(fixture.componentInstance.initials()).toBe('YA');
    });

    it('uses the first two words for an ordinary name', () => {
      render({ name: 'Hessa Al-Dosari' });
      expect(fixture.componentInstance.initials()).toBe('HA');
    });
  });

  describe('group presentation', () => {
    it('shows a heading per group when open', () => {
      const el = render({ permissions: ['committees:view', 'users:view'] });
      const text = el.textContent ?? '';
      // Translation is not loaded in this test, so the keys render as-is —
      // which is exactly what makes them assertable here.
      expect(text).toContain('nav.groups.work');
      expect(text).toContain('nav.groups.quality');
      expect(text).toContain('nav.groups.admin');
    });

    // Collapsed, headings have no room. Groups must still be told apart, by a
    // rule — so there is one fewer rule than there are groups.
    it('replaces headings with rules between groups when collapsed', () => {
      const el = render({
        permissions: ['committees:view', 'users:view'],
        collapsed: true,
      });
      expect(el.textContent ?? '').not.toContain('nav.groups.work');
      expect(el.querySelectorAll('nav .border-t').length).toBe(2);
    });

    // An icon-only link is announced as nothing without a label.
    it('labels every link for assistive technology when collapsed', () => {
      const el = render({ permissions: ['users:view'], collapsed: true });
      const links = Array.from(el.querySelectorAll('nav a'));
      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        expect(link.getAttribute('aria-label'))
          .withContext(link.outerHTML)
          .toBeTruthy();
      }
    });
  });

  it('shows the tenant under the user, not a role name', () => {
    const el = render({ tenantName: 'Al Nakheel Specialist Hospital' });
    expect(el.textContent ?? '').toContain('Al Nakheel Specialist Hospital');
  });
});
