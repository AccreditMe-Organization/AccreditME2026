import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { UserListComponent } from './user-list.component';
import { IUserDto, UserService } from '../../services/user.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

// ACC-79 — the row's More menu. Tested on rowActionsFor(), the one method both
// the menu and the "…" button read, so a row can never show a button that
// opens an empty menu, or an action the backend will refuse.
describe('UserListComponent row actions (ACC-79)', () => {
  function create(permissions: string[]): UserListComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        ConfirmationService,
        { provide: UserService, useValue: {} },
        { provide: OrgPositionService, useValue: {} },
        { provide: OrgUnitService, useValue: {} },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
      ],
    });
    // No detectChanges: ngOnInit would call the stubbed services, and the
    // rules under test do not need a render.
    return TestBed.createComponent(UserListComponent).componentInstance;
  }

  const user = (overrides: Partial<IUserDto>): IUserDto =>
    ({
      id: 'cmtra1opx00nzocp15rd2xmhd',
      name: 'Dr. Yasser Al-Amri',
      email: 'yasser.alamri@alnakheel-hospital.test',
      status: 'ACTIVE',
      primaryOrgUnitId: 'cmtr9y0z3006socp1bdkkzon4',
      ...overrides,
    }) as IUserDto;

  // ACC-83 — a tenant administrator holds all four. The status slot is tested
  // against this set so each case is distinguished by the row's STATUS rather
  // than by what the viewer happens to be missing.
  const ADMIN = [
    'users:view',
    'users:transfer',
    'users:deactivate',
    'users:reactivate',
    'users:invite',
  ];

  it('offers Transfer and Deactivate for an active user with a unit', () => {
    expect(create(ADMIN).rowActionsFor(user({}))).toEqual(['transfer', 'deactivate']);
  });

  // ── ACC-83: ONE status slot, filled by the row's own status ────────────────
  //
  // This replaces two tests that pinned the old behaviour, and both were right
  // about the code at the time:
  //   - an INACTIVE row offered NOTHING, so the "…" button did not render and a
  //     deactivated person could never be brought back from the list at all;
  //   - an INVITED row offered DEACTIVATE, which ran the whole departure flow
  //     on someone who never arrived.

  it('offers Reactivate for an inactive user — deactivation is no longer a one-way door', () => {
    expect(create(ADMIN).rowActionsFor(user({ status: 'INACTIVE' }))).toEqual(['reactivate']);
  });

  it('offers Revoke invitation for an invited user, NOT Deactivate', () => {
    const actions = create(ADMIN).rowActionsFor(user({ status: 'INVITED' }));
    expect(actions).toEqual(['revokeInvitation']);
    // Named explicitly: offering Deactivate here is the defect, not a near miss.
    expect(actions).not.toContain('deactivate');
  });

  it('never offers two status actions at once, whatever the status', () => {
    const list = create(ADMIN);
    const statusActions = ['deactivate', 'reactivate', 'revokeInvitation'];
    for (const status of ['ACTIVE', 'INACTIVE', 'INVITED', 'SUSPENDED'] as const) {
      const offered = list
        .rowActionsFor(user({ status }))
        .filter((a) => statusActions.includes(a));
      expect(offered.length)
        .withContext(`status ${status} offered ${offered.join(', ')}`)
        .toBeLessThanOrEqual(1);
    }
  });

  // SUSPENDED is set by nothing in the product (SYSTEM-REFERENCE 12.2), and the
  // slot stays empty rather than guessing which action applies to it.
  it('offers no status action for SUSPENDED, which no feature produces', () => {
    const actions = create(ADMIN).rowActionsFor(user({ status: 'SUSPENDED' }));
    expect(actions).not.toContain('deactivate');
    expect(actions).not.toContain('reactivate');
    expect(actions).not.toContain('revokeInvitation');
  });

  it('does not offer Reactivate without users:reactivate — the backend would 403', () => {
    const list = create(['users:view', 'users:deactivate', 'users:invite']);
    expect(list.rowActionsFor(user({ status: 'INACTIVE' }))).toEqual([]);
  });

  it('does not offer Revoke invitation without users:invite', () => {
    const list = create(['users:view', 'users:deactivate', 'users:reactivate']);
    expect(list.rowActionsFor(user({ status: 'INVITED' }))).toEqual([]);
  });

  it('does not offer Deactivate without users:deactivate — the backend would 403', () => {
    const list = create(['users:view', 'users:transfer']);
    expect(list.rowActionsFor(user({}))).toEqual(['transfer']);
  });

  it('does not offer Transfer without users:transfer', () => {
    const list = create(['users:view', 'users:deactivate']);
    expect(list.rowActionsFor(user({}))).toEqual(['deactivate']);
  });

  // transferUser() requires ACTIVE and a current org unit to move from.
  it('does not offer Transfer to a user the backend would refuse to transfer', () => {
    const list = create(ADMIN);
    // Not ACTIVE: the status slot is Revoke invitation here, and Transfer is
    // absent — which is the assertion.
    expect(list.rowActionsFor(user({ status: 'INVITED' }))).toEqual(['revokeInvitation']);
    // ACTIVE but no unit to move from.
    expect(list.rowActionsFor(user({ primaryOrgUnitId: null }))).toEqual(['deactivate']);
  });

  it('offers nothing to a user who can only view the list', () => {
    expect(create(['users:view']).rowActionsFor(user({}))).toEqual([]);
  });

  it('builds the menu from the same actions, in the same order', () => {
    const list = create(ADMIN);
    list.menuUser.set(user({}));
    expect(list.rowMenuItems().map((i) => i.icon)).toEqual([
      'pi pi-arrow-right-arrow-left',
      'pi pi-user-minus',
    ]);
  });
});

// ACC-120 slice 5 — the Manage roles entry point.
//
// Its permission is roles:manage, what POST and DELETE /users/:id/roles both
// carry, and NOT users:manage: a user administrator who cannot grant roles must
// not be offered a dialog whose every action the server would refuse. Proved in
// a browser against READ_ONLY_ADMIN, who holds roles:view and gets no row menu
// at all; this pins the rule so the next change to rowActionsFor cannot drop it
// silently.
describe('UserListComponent — Manage roles row action (ACC-120)', () => {
  function create(permissions: string[]): UserListComponent {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        ConfirmationService,
        { provide: UserService, useValue: {} },
        { provide: OrgPositionService, useValue: {} },
        { provide: OrgUnitService, useValue: {} },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
      ],
    });
    return TestBed.createComponent(UserListComponent).componentInstance;
  }

  const anyUser = {
    id: 'u1',
    name: 'Fatima Al-Anazi',
    email: 'f@x.test',
    status: 'ACTIVE',
    primaryOrgUnitId: 'unit-1',
  } as IUserDto;

  it('offers Manage roles to a holder of roles:manage', () => {
    expect(create(['users:view', 'roles:manage']).rowActionsFor(anyUser)).toContain('manageRoles');
  });

  it('does not offer it to someone with only roles:view — the server would refuse every action', () => {
    expect(create(['users:view', 'roles:view']).rowActionsFor(anyUser)).not.toContain('manageRoles');
  });

  // users:manage is a different permission and does not imply it.
  it('does not offer it for users:manage alone', () => {
    expect(create(['users:view', 'users:manage']).rowActionsFor(anyUser)).not.toContain(
      'manageRoles',
    );
  });

  // Roles are still real for someone who cannot sign in, and decide what they
  // can do if reactivated — so unlike Transfer and Deactivate this one does not
  // depend on status.
  it('offers it for an inactive user too', () => {
    expect(
      create(['users:view', 'roles:manage']).rowActionsFor({
        ...anyUser,
        status: 'INACTIVE',
      } as IUserDto),
    ).toContain('manageRoles');
  });
});
