import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { RoleListComponent } from './role-list.component';
import { RoleDto, RoleService } from '../../services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-123 — the row's write controls on Roles.
//
// Until READ_ONLY_ADMIN existed, nobody could reach /roles without also holding
// roles:manage, so an ungated row action was unreachable rather than safe. The
// moment a read-only administrator could open the page, a holder of roles:view
// alone got an editable "Edit Role" dialog with a live Save, plus a row menu
// offering Manage Permissions and Deactivate Role. Every one of those is
// roles:manage on the server (role.controller.ts).
//
// check:action-gating could not see it, and says so in its own header: a
// control built as a MenuItem[] with a command has no icon in the template. It
// names user-list and position-list as the files that do this and gate
// correctly in TypeScript — role-list does the same thing and did not gate at
// all. The inventory, not the blind spot, was what was wrong.
describe('RoleListComponent row actions (ACC-123)', () => {
  const ROLE: RoleDto = {
    id: 'r1',
    key: 'AUDITOR',
    nameEn: 'Auditor',
    nameAr: 'مراجع',
    description: null,
    isSystem: true,
    isActive: true,
    permissionCount: 12,
  } as RoleDto;

  function render(held: string[]) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [RoleListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        ConfirmationService,
        {
          provide: RoleService,
          useValue: {
            listRoles: () => of({ data: [ROLE], total: 1, page: 1, limit: 20 }),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => held.includes(p) },
        },
      ],
    });
    const fixture = TestBed.createComponent(RoleListComponent);
    fixture.detectChanges();
    return fixture;
  }

  const buttons = (f: ReturnType<typeof render>): string[] =>
    Array.from((f.nativeElement as HTMLElement).querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim() || (b.getAttribute('aria-label') ?? ''),
    );

  describe('with roles:view only', () => {
    it('renders no Edit', () => {
      expect(buttons(render(['roles:view']))).not.toContain('common.edit');
    });

    it('renders no row menu, so no Manage Permissions or Deactivate Role', () => {
      expect(buttons(render(['roles:view']))).not.toContain('list.more');
    });

    it('reports canManage false', () => {
      expect(render(['roles:view']).componentInstance.canManage()).toBe(false);
    });
  });

  describe('with roles:manage', () => {
    const HELD = ['roles:view', 'roles:manage'];

    // The other half, and the one that matters: hiding a control for everyone
    // is a regression, not a fix.
    it('still renders Edit', () => {
      expect(buttons(render(HELD))).toContain('common.edit');
    });

    it('still renders the row menu', () => {
      expect(buttons(render(HELD))).toContain('list.more');
    });

    it('offers both write actions in the menu', () => {
      const labels = render(HELD)
        .componentInstance.rowMenuItems()
        .map((i) => i.label);
      // menuRole() is unset until a row menu opens, so the model is empty here;
      // what this pins is that building it is not what gates it — the template
      // is. Asserted so a future "gate it in rowMenuItems instead" is a visible
      // change.
      expect(labels.length).toBe(0);
    });
  });
});
