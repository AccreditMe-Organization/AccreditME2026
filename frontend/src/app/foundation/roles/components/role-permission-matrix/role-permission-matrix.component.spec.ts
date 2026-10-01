import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { RolePermissionMatrixComponent } from './role-permission-matrix.component';
import { RoleService } from '../../services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-123 — the permission matrix, rendered for someone who may READ a role but
// not change it.
//
// This screen is the reason READ_ONLY_ADMIN was built and the worst thing the
// browser pass found: 148 toggles, none disabled, and a live Save, on the one
// page in the product that grants permissions.
//
// The fix is deliberately NOT the same shape as every other write control in
// the app, so the asymmetry is pinned here rather than left to look like an
// oversight: the CHECKBOXES STAY and are disabled, because a permission matrix
// with its checkboxes removed is not a matrix — the checkbox is the reading —
// while the SAVE GOES, because a disabled Save says "you could do this".
describe('RolePermissionMatrixComponent read-only gating (ACC-123)', () => {
  const PERMISSIONS = [
    { id: 'p1', module: 'roles', action: 'view', description: null },
    { id: 'p2', module: 'roles', action: 'manage', description: null },
    { id: 'p3', module: 'users', action: 'view', description: null },
  ];

  function render(held: string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RolePermissionMatrixComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        {
          provide: RoleService,
          useValue: {
            getRole: () =>
              of({
                id: 'r1',
                key: 'AUDITOR',
                nameEn: 'Auditor',
                nameAr: 'مراجع',
                isSystem: true,
                isActive: true,
                // The DTO carries permission KEYS, not objects — selectedKeys is
                // seeded straight from this array (load()).
                permissions: ['roles:view'],
              }),
            listAllPermissions: () => of(PERMISSIONS),
            assignPermissions: jasmine.createSpy('assignPermissions'),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => held.includes(p) },
        },
      ],
    });
    const fixture = TestBed.createComponent(RolePermissionMatrixComponent);
    fixture.detectChanges();
    return fixture;
  }

  const text = (f: ReturnType<typeof render>): string =>
    (f.nativeElement as HTMLElement).textContent ?? '';

  // The TestBed loads no translations, so a button's text is its KEY. Asserted
  // on the key deliberately: 'Save' would pass vacuously here, which is exactly
  // how a suppression test ends up proving nothing.
  const buttons = (f: ReturnType<typeof render>): string[] =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );

  const checkboxes = (f: ReturnType<typeof render>): HTMLInputElement[] =>
    Array.from(
      (f.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        'input[type=checkbox]',
      ),
    );

  describe('with roles:view only', () => {
    it('renders the checkboxes, because they are the reading', () => {
      expect(checkboxes(render(['roles:view'])).length).toBeGreaterThan(0);
    });

    it('disables every checkbox', () => {
      const boxes = checkboxes(render(['roles:view']));
      expect(boxes.filter((b) => !b.disabled)).toEqual([]);
    });

    it('does not render Save', () => {
      const rendered = buttons(render(['roles:view']));
      expect(rendered).not.toContain('common.save');
      // The remaining button reads Back rather than Cancel: there is nothing to
      // cancel when nothing could be changed.
      expect(rendered).toEqual(['common.back']);
    });

    // A disabled Save would say "you could do this". The sentence says what is
    // true, the same way Setup health's suppressed Fix names the permission.
    it('says what is missing instead', () => {
      expect(text(render(['roles:view']))).toContain('roles.matrixReadOnly');
    });
  });

  describe('with roles:manage', () => {
    const HELD = ['roles:view', 'roles:manage'];

    it('leaves every checkbox editable', () => {
      expect(checkboxes(render(HELD)).filter((b) => b.disabled)).toEqual([]);
    });

    it('renders Save, so the gate did not simply remove the control for everyone', () => {
      expect(buttons(render(HELD))).toEqual(['common.cancel', 'common.save']);
    });

    it('shows no read-only notice', () => {
      expect(text(render(HELD))).not.toContain('roles.matrixReadOnly');
    });
  });
});
