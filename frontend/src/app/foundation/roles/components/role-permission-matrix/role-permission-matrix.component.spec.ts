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

  function render(held: string[], roleKey = 'AUDITOR') {
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
                key: roleKey,
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

  // ACC-120 — THE ROOT ROLE IS FROZEN FOR EVERYONE, including a holder of
  // roles:manage. A different reason from the read-only case above, so a
  // different sentence, and the tests are written against the pair rather than
  // against either alone: the two must not collapse into one condition.
  describe('the root role, held by someone with roles:manage', () => {
    const HELD = ['roles:view', 'roles:manage'];

    it('disables every checkbox even though the viewer may manage roles', () => {
      const boxes = checkboxes(render(HELD, 'TENANT_ADMIN'));
      expect(boxes.length).toBeGreaterThan(0);
      expect(boxes.filter((b) => !b.disabled)).toEqual([]);
    });

    // The refusal is visible BEFORE the click. A grid that 409s on Save is the
    // dead Next button rebuilt somewhere more expensive.
    it('does not render Save', () => {
      expect(buttons(render(HELD, 'TENANT_ADMIN'))).toEqual(['common.back']);
    });

    it('explains that the set is fixed, NOT that permission is missing', () => {
      const rendered = text(render(HELD, 'TENANT_ADMIN'));
      expect(rendered).toContain('roles.matrixFrozenRootRole');
      // The wrong sentence here would tell an administrator to go and get a
      // permission they already hold.
      expect(rendered).not.toContain('roles.matrixReadOnly');
    });

    // ACC-120 — THE CONTRADICTION THIS CLOSES. The amber banner read "Removing
    // permissions from this role affects every user currently assigned to it"
    // on a screen where no permission can be removed, at the top and coloured,
    // while the truth sat 700px below at the foot of the page.
    it('does not show the amber editing warning on the frozen role', () => {
      const rendered = text(render(HELD, 'TENANT_ADMIN'));
      expect(rendered).not.toContain('roles.adminRoleWarning');
      expect(rendered).toContain('roles.matrixFrozenRootRole');
    });

    // The amber branch is KEPT rather than deleted, because it is correct for
    // an editable high-impact role. But it is currently UNREACHABLE, and that
    // is pinned here rather than left to be rediscovered:
    // HIGH_IMPACT_ROLE_KEYS has exactly two members, and this screen can show
    // neither warning — TENANT_ADMIN is now frozen (the notice replaces the
    // warning) and PLATFORM_ADMIN never renders at all, because load()
    // redirects it to /roles. So nothing in the product reaches
    // 'roles.adminRoleWarning' today.
    it('never renders PLATFORM_ADMIN at all, so the amber branch has no reachable case', () => {
      const rendered = text(render(HELD, 'PLATFORM_ADMIN'));
      expect(rendered).not.toContain('roles.adminRoleWarning');
      expect(rendered).not.toContain('roles.matrixFrozenRootRole');
      // Redirected before anything is shown — not merely warned about.
      expect(rendered).not.toContain('roles.permissionMatrix');
    });

    it('shows no notice at all on an ordinary editable role', () => {
      const rendered = text(render(HELD, 'AUDITOR'));
      expect(rendered).not.toContain('roles.matrixFrozenRootRole');
      expect(rendered).not.toContain('roles.matrixReadOnly');
      expect(rendered).not.toContain('roles.adminRoleWarning');
    });

    // Both reasons can be true at once, and the frozen sentence ends "You can
    // rename it" — false for someone who cannot manage roles. They are told the
    // constraint that actually binds them.
    it('tells a reader without roles:manage about the permission, not the freeze', () => {
      const rendered = text(render(['roles:view'], 'TENANT_ADMIN'));
      expect(rendered).toContain('roles.matrixReadOnly');
      expect(rendered).not.toContain('roles.matrixFrozenRootRole');
    });

    it('leaves any other role editable for the same viewer', () => {
      expect(checkboxes(render(HELD, 'AUDITOR')).filter((b) => b.disabled)).toEqual([]);
      expect(buttons(render(HELD, 'AUDITOR'))).toEqual(['common.cancel', 'common.save']);
    });
  });
});
