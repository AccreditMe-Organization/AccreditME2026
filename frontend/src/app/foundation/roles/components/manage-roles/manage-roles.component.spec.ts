import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideTranslateService, provideTranslateLoader, TranslateNoOpLoader } from '@ngx-translate/core';
import { of, throwError } from 'rxjs';
import { ManageRolesComponent } from './manage-roles.component';
import { RoleService, RoleDto, UserRoleGrantDto } from '../../services/role.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';

// ACC-120 slice 5 — the Manage roles dialog, panel A.
//
// Panel B (bulk) is not built and has no tests here, deliberately: there is no
// bulk endpoint and no multi-select on the Users list for its entry point to
// come from. See the component's own header.
const role = (id: string, nameEn: string, nameAr = ''): RoleDto =>
  ({
    id,
    organizationId: 'org-1',
    key: null,
    nameEn,
    nameAr: nameAr || nameEn,
    description: null,
    isSystem: false,
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }) as RoleDto;

const ROLES = [role('r1', 'Auditor'), role('r2', 'Viewer'), role('r3', 'Quality Officer')];

const grant = (over: Partial<UserRoleGrantDto> & { role: RoleDto }): UserRoleGrantDto =>
  ({
    id: 'ur-' + over.role.id,
    grantedAt: '2025-03-03T09:30:00.000Z',
    source: 'DIRECT',
    grantedViaHeadPositionId: null,
    grantedViaHeadPositionOrgUnitId: null,
    ...over,
  }) as UserRoleGrantDto;

describe('ManageRolesComponent (ACC-120)', () => {
  let fixture: ComponentFixture<ManageRolesComponent>;
  let component: ManageRolesComponent;
  let assign: jasmine.Spy;
  let remove: jasmine.Spy;

  interface Opts {
    grants?: UserRoleGrantDto[];
    roles?: RoleDto[];
    positionsFail?: boolean;
    unitsFail?: boolean;
    grantsFail?: boolean;
    assignFails?: string[];
  }

  function render(opts: Opts = {}): void {
    const failing = new Set(opts.assignFails ?? []);
    assign = jasmine.createSpy('assign').and.callFake((_u: string, roleId: string) =>
      failing.has(roleId) ? throwError(() => new Error('nope')) : of(undefined),
    );
    remove = jasmine.createSpy('remove').and.callFake((_u: string, roleId: string) =>
      failing.has(roleId) ? throwError(() => new Error('nope')) : of(undefined),
    );

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ManageRolesComponent],
      providers: [
        provideTranslateService({ lang: 'en', loader: provideTranslateLoader(TranslateNoOpLoader) }),
        provideFormatTesting(),
        {
          provide: RoleService,
          useValue: {
            getUserRoles: () =>
              opts.grantsFail ? throwError(() => new Error('boom')) : of(opts.grants ?? []),
            listAllRoles: () => of(opts.roles ?? ROLES),
            assignRoleToUser: assign,
            removeRoleFromUser: remove,
          },
        },
        {
          provide: OrgPositionService,
          useValue: {
            listPositions: () =>
              opts.positionsFail
                ? throwError(() => new Error('403'))
                : of([{ id: 'pos-1', nameEn: 'Unit Head', nameAr: 'رئيس وحدة' }]),
          },
        },
        {
          provide: OrgUnitService,
          useValue: {
            getFlat: () =>
              opts.unitsFail
                ? throwError(() => new Error('403'))
                : of([{ id: 'unit-1', nameEn: 'Neonatal ICU', nameAr: 'العناية المركزة' }]),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: () => true },
        },
      ],
    });
    fixture = TestBed.createComponent(ManageRolesComponent);
    fixture.componentRef.setInput('userId', 'user-1');
    fixture.componentRef.setInput('userName', 'Fatima Al-Anazi');
    fixture.detectChanges();
    component = fixture.componentInstance;
  }

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const checkboxes = (): HTMLInputElement[] =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>(
        '.am-roles-frame input[type=checkbox]',
      ),
    );

  const derivedUnit = grant({
    role: ROLES[2]!,
    source: 'HEAD_POSITION_UNIT',
    grantedViaHeadPositionId: 'pos-1',
    grantedViaHeadPositionOrgUnitId: 'unit-1',
  });

  // ── the direct list ────────────────────────────────────────────────────────

  it('lists every tenant role, ticked when held', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    expect(checkboxes().length).toBe(3);
    // Asserted on the model, not the input's `checked` property: PrimeNG's
    // checkbox renders its state through its own host, and reading the inner
    // input would be testing PrimeNG rather than this component.
    expect(component.rows().filter((r) => r.held).map((r) => r.role.id)).toEqual(['r1']);
  });

  // Asserted on the DATE THE ROW CARRIES, not on rendered text: the TestBed
  // loads no translations, so 'manageRoles.grantedOn' echoes as its key and
  // interpolates nothing. A text assertion here would pass on an empty string.
  it("carries the GRANT's date on a held role, never the role's", () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    const held = component.rows().find((r) => r.held)!;
    expect(held.grantedAt).toBe('2025-03-03T09:30:00.000Z');
    expect(held.grantedAt).not.toBe(held.role.createdAt);
  });

  it('carries no date for a role the user does not hold', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    expect(component.rows().find((r) => !r.held)!.grantedAt).toBeNull();
  });

  it('shows no author anywhere — there is no granted-by field to show', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    expect(text()).not.toMatch(/by |granted by/i);
  });

  // ── the locked, head-position section ──────────────────────────────────────

  it('lists a derived grant above the list, with no checkbox of its own', () => {
    render({ grants: [derivedUnit] });
    // Three roles exist, one is derived, so only two get checkboxes.
    expect(checkboxes().length).toBe(2);
    expect(text()).toContain('manageRoles.fromHeadPosition');
  });

  // The role is shown ONCE. Listing it again with a checkbox would offer a
  // change the server refuses, and would be two answers about one role.
  it('does not also list the derived role as a tickable row', () => {
    render({ grants: [derivedUnit] });
    const rowNames = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.am-roles-frame li'),
    ).map((li) => (li.textContent ?? '').trim());
    expect(rowNames.some((n) => n.includes('Quality Officer'))).toBe(false);
  });

  it('names the scope and the position it comes with', () => {
    render({ grants: [derivedUnit] });
    expect(component.scopeLabel(component.derivedRows()[0]!)).toBe('manageRoles.scopeUnitOnly');
    expect(component.derivedSentence(component.derivedRows()[0]!)).toBe(
      'manageRoles.comesWithPosition',
    );
  });

  it('says organisation-wide for a grant with no unit', () => {
    render({
      grants: [
        grant({
          role: ROLES[2]!,
          source: 'HEAD_POSITION_ORG_WIDE',
          grantedViaHeadPositionId: 'pos-1',
        }),
      ],
    });
    expect(component.scopeLabel(component.derivedRows()[0]!)).toBe('manageRoles.scopeOrgWide');
  });

  // THE REQUIREMENT CARRIED OVER FROM PR 1's REVIEW. A caller may hold
  // roles:manage without org:view or positions:view, so the name lookups 403.
  // A locked row exists to say where to go instead; one rendering a blank says
  // nothing at all.
  describe('when a name cannot be resolved because the viewer lacks permission', () => {
    it('still loads, rather than failing on the name lookup', () => {
      render({ grants: [derivedUnit], positionsFail: true, unitsFail: true });
      expect(component.loadError()).toBeNull();
      expect(component.derivedRows().length).toBe(1);
    });

    it('says the grant is scoped to a unit rather than leaving the scope blank', () => {
      render({ grants: [derivedUnit], unitsFail: true });
      const label = component.scopeLabel(component.derivedRows()[0]!);
      expect(label).toBe('manageRoles.scopeUnitUnnamed');
      expect(label).not.toBe('');
    });

    it('says the position cannot be shown rather than naming nothing', () => {
      render({ grants: [derivedUnit], positionsFail: true });
      const sentence = component.derivedSentence(component.derivedRows()[0]!);
      expect(sentence).toBe('manageRoles.comesWithPositionUnnamed');
      expect(sentence).not.toBe('');
    });
  });

  // ── editing ────────────────────────────────────────────────────────────────

  it('marks an unheld role as an addition and a held one as a removal', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    component.toggle(component.rows().find((r) => r.role.id === 'r2')!);
    component.toggle(component.rows().find((r) => r.role.id === 'r1')!);
    expect(component.added().map((r) => r.role.id)).toEqual(['r2']);
    expect(component.removed().map((r) => r.role.id)).toEqual(['r1']);
    expect(component.changeCount()).toBe(2);
  });

  it('returns a row to no-change when toggled back', () => {
    render({ grants: [] });
    const row = component.rows()[0]!;
    component.toggle(row);
    component.toggle(component.rows()[0]!);
    expect(component.changeCount()).toBe(0);
  });

  it('names every change in words', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    component.toggle(component.rows().find((r) => r.role.id === 'r2')!);
    expect(component.changeSummary()).toContain('+ Viewer');
  });

  // ── the last-role rule ─────────────────────────────────────────────────────

  it('would leave the user with no roles when the last direct grant is removed', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    component.toggle(component.rows().find((r) => r.role.id === 'r1')!);
    expect(component.wouldLeaveWithNoRoles()).toBe(true);
  });

  // The drawing's own rule: a person who still holds a derived role is not left
  // with none, so the confirm does not apply to them.
  it('would NOT, when a head-position grant remains', () => {
    render({ grants: [grant({ role: ROLES[0]! }), derivedUnit] });
    component.toggle(component.rows().find((r) => r.role.id === 'r1')!);
    expect(component.wouldLeaveWithNoRoles()).toBe(false);
  });

  // ── saving ─────────────────────────────────────────────────────────────────

  it('sends one call per changed role, and nothing for unchanged ones', () => {
    render({ grants: [grant({ role: ROLES[0]! })] });
    component.toggle(component.rows().find((r) => r.role.id === 'r1')!);
    component.toggle(component.rows().find((r) => r.role.id === 'r2')!);
    component.onSubmit();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('user-1', 'r1');
    expect(assign).toHaveBeenCalledWith('user-1', 'r2');
  });

  it('emits saved and clears the changes when every call succeeds', () => {
    render({ grants: [] });
    const saved = jasmine.createSpy('saved');
    component.saved.subscribe(saved);
    component.toggle(component.rows()[0]!);
    component.onSubmit();
    expect(saved).toHaveBeenCalled();
    expect(component.changeCount()).toBe(0);
  });

  // Partial failure is the shape the drawing specifies, and the one a single
  // try/catch would get wrong: the dialog stays open, what worked is marked
  // saved, what failed keeps its change so a second Save retries only it.
  describe('when some per-role calls fail', () => {
    function partial(): void {
      render({ grants: [], assignFails: ['r2'] });
      component.toggle(component.rows().find((r) => r.role.id === 'r1')!);
      component.toggle(component.rows().find((r) => r.role.id === 'r2')!);
      component.onSubmit();
    }

    it('does not emit saved', () => {
      const saved = jasmine.createSpy('saved');
      render({ grants: [], assignFails: ['r2'] });
      component.saved.subscribe(saved);
      component.toggle(component.rows().find((r) => r.role.id === 'r2')!);
      component.onSubmit();
      expect(saved).not.toHaveBeenCalled();
    });

    it('keeps only the failed change, so a second Save retries just that one', () => {
      partial();
      expect(component.changeCount()).toBe(1);
      expect(component.added().map((r) => r.role.id)).toEqual(['r2']);
    });

    it('marks the succeeded row as saved and the failed one as failed', () => {
      partial();
      const byId = new Map(component.rows().map((r) => [r.role.id, r]));
      expect(byId.get('r1')!.outcome).toBe('saved');
      expect(byId.get('r2')!.outcome).toBe('failed');
    });

    it('says how many of how many were saved', () => {
      partial();
      expect(component.saveError()).toContain('manageRoles.partialSave');
    });
  });

  // ── outcomes ───────────────────────────────────────────────────────────────

  it('offers a retry when the roles cannot be loaded', () => {
    render({ grantsFail: true });
    expect(component.loadError()).not.toBeNull();
    expect(text()).toContain('common.retry');
  });

  it('says so when the tenant has no roles at all', () => {
    render({ grants: [], roles: [] });
    expect(text()).toContain('manageRoles.noRolesExist');
  });

  it('says so when the user holds nothing', () => {
    render({ grants: [] });
    expect(text()).toContain('manageRoles.holdsNothing');
  });
});
