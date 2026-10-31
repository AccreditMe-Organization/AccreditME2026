import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, Subject, of, throwError } from 'rxjs';
import { RolePermissionMatrixComponent } from './role-permission-matrix.component';
import { PermissionDto, RoleDto, RoleService } from '../../services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';

// ACC-272 — the role permissions page as a grouped list (design sections 1
// and 2). Real translations, so assertions read what a person reads.
//
// The catalogue is every in-use key (the sentence table is exactly that list),
// plus platform:admin (hidden in a tenant) and documents:view, not in use,
// which the role HOLDS: it must travel back on save untouched. The held set is
// the design's Quality Editor: Committees 7 of 12 (records 3 of 5, members
// 2 of 3, tasks 2 of 4).

const SENTENCES = (en as { roles: { matrix: { sentence: Record<string, string> } } }).roles.matrix.sentence;
const perm = (key: string, inUse = true): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse, rootRoleOnly: key === 'workflows:manage' };
};
const CATALOGUE: PermissionDto[] = [...Object.keys(SENTENCES).map((k) => perm(k)), perm('documents:view', false)];

const HELD = [
  'tenant:view',
  'org:view',
  'users:view',
  'lookups:view',
  'workflows:view',
  'committees:view',
  'committees:create',
  'committees:edit_details',
  'committees:add_member',
  'committees:change_member_role',
  'committees:view_all_tasks',
  'committees:create_tasks',
  'meetings:view',
  'positions:view',
  'documents:view',
];

interface Setup {
  roleKey?: string;
  held?: string[];
  isSystem?: boolean;
  canManage?: boolean;
  platformOrg?: boolean;
  headPositionHolderCount?: number;
  assign?: () => Observable<RoleDto>;
  getRole?: () => Observable<RoleDto>;
  lang?: 'en' | 'ar';
}

describe('RolePermissionMatrixComponent (ACC-272, the grouped list)', () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<RolePermissionMatrixComponent>;
  let component: RolePermissionMatrixComponent;
  let assign: jasmine.Spy;
  let getRole: jasmine.Spy;
  let confirm: jasmine.Spy;

  const role = (s: Setup): RoleDto => ({
    id: 'r1',
    organizationId: 'org-1',
    key: s.roleKey ?? null,
    nameEn: 'Quality Editor',
    nameAr: 'محرر الجودة',
    description: null,
    isSystem: s.isSystem ?? false,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    permissions: s.held ?? HELD,
    activeHolderCount: 14,
    headPositionHolderCount: s.headPositionHolderCount ?? 0,
  });

  function render(s: Setup = {}): void {
    TestBed.resetTestingModule();
    assign = jasmine.createSpy('assignPermissions').and.callFake(
      s.assign ?? ((_id: string, keys: string[]) => of({ ...role(s), permissions: keys })),
    );
    getRole = jasmine.createSpy('getRole').and.callFake(s.getRole ?? (() => of(role(s))));
    confirm = jasmine.createSpy('confirm');
    TestBed.configureTestingModule({
      imports: [RolePermissionMatrixComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'r1' }) } } },
        { provide: ConfirmationService, useValue: { confirm } },
        { provide: RoleService, useValue: { getRole, listAllPermissions: () => of(CATALOGUE), assignPermissions: assign } },
        {
          provide: NavigationAccessService,
          useValue: {
            hasPermission: (p: string) => p === 'roles:manage' && s.canManage !== false,
            isPlatformOrg: () => s.platformOrg === true,
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(s.lang ?? 'en');
    TestBed.inject(LanguageService).use(s.lang ?? 'en');
    fixture = TestBed.createComponent(RolePermissionMatrixComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog, .p-tooltip').forEach((n) => n.remove());
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = host()): T | null => root.querySelector<T>(sel);
  const all = (sel: string, root: ParentNode = host()): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  // Bidi isolates are invisible; strip them where a test reads English prose.
  const plain = (s: string | null | undefined): string => (s ?? '').replace(/[⁦-⁩]/g, '');
  const mod = (m: string) => q(`[data-pm-module="${m}"]`)!;
  const row = (k: string) => q(`[data-pm-row="${k}"]`);
  const box = (k: string) => q<HTMLInputElement>(`[data-pm-row="${k}"] input[type="checkbox"]`)!;
  const moduleBox = (m: string) => q<HTMLButtonElement>(`[data-pm-module="${m}"] [data-pm-module-box]`)!;
  const groupBox = (g: string) => q<HTMLButtonElement>(`[data-pm-group="${g}"] [data-pm-group-box]`)!;
  const counts = (m: string) => all('[data-pm-count]', mod(m)).map((e) => plain(text(e)));
  /** Each group heading as "label · count". */
  const groupLines = (m: string) =>
    all('[data-pm-group]', mod(m)).map((g) => `${text(g.querySelector('span.flex-auto'))} · ${plain(text(g.querySelector('[data-pm-count]')))}`);
  const legend = () => all('[data-pm-legend] > span').map((e) => text(e));
  /** A row's own checkbox: the toggle switch has an input too. */
  const rowBoxes = () => all('[data-pm-row] input[type="checkbox"]');
  const click = (el: HTMLElement | null) => {
    el!.click();
    fixture.detectChanges();
  };
  const find = (value: string) => {
    const input = q<HTMLInputElement>('[data-pm-find]')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const dialogText = (): string => plain(document.querySelector('[data-pm-confirm]')?.textContent);
  const buttonByAttr = (attr: string): HTMLButtonElement | null => document.querySelector(`[${attr}] button`) as HTMLButtonElement | null;

  // ── What is shown ──────────────────────────────────────────────────────────

  it('one section per module in the product order, with its name, description and sentences, never a key or a column', () => {
    render();
    expect(all('[data-pm-module]').map((m) => m.getAttribute('data-pm-module'))).toEqual([
      'tenant',
      'org',
      'users',
      'roles',
      'lookups',
      'workflows',
      'committees',
      'meetings',
      'positions',
      'setup',
      'admin',
    ]);
    expect(text(q('[data-pm-head]', mod('committees')))).toContain('Committees');
    expect(text(q('[data-pm-head]', mod('committees')))).toContain('Who may see, run and sign off committees');
    expect(text(row('committees:manage'))).toBe('Submit, suspend, reactivate, dissolve');
    expect(host().textContent).not.toContain('committees:');
    expect(q('[role="grid"]')).toBeNull();
    expect(q('[role="columnheader"]')).toBeNull();
  });

  it('no platform key in a tenant; the platform organisation shows them', () => {
    render();
    expect(q('[data-pm-module="platform"]')).toBeNull();
    render({ platformOrg: true });
    expect(q('[data-pm-module="platform"]')).not.toBeNull();
  });

  it('Committees: three labelled groups with their counts, and the module "7 of 12"', () => {
    render();
    expect(groupLines('committees')).toEqual(['Committee records · 3 of 5', 'Members · 2 of 3', 'Tasks on committees · 2 of 4']);
    expect(counts('committees')[0]).toBe('7 of 12');
    // Users has exactly six: no groups.
    expect(all('[data-pm-group]', mod('users')).length).toBe(0);
    expect(counts('users')).toEqual(['1 of 6']);
  });

  it("Administration's row has its second line", () => {
    render();
    expect(text(row('admin:access'))).toContain('Open the Administration area');
    expect(text(row('admin:access'))).toContain('Each admin page also needs its own permission.');
  });

  it('workflows:manage shows only on the root role, tagged "Organization Administrator only"', () => {
    render();
    expect(row('workflows:manage')).toBeNull();
    expect(counts('workflows')).toEqual(['1 of 1']);
    render({ roleKey: 'TENANT_ADMIN', isSystem: true });
    expect(text(row('workflows:manage'))).toContain('Change workflows and their stage tasks');
    expect(text(q('[data-pm-tag]', row('workflows:manage')!))).toBe('Organization Administrator only');
  });

  // ── ACC-221 — "Manage roles" on another role is a warning, never a block ──
  describe('"Manage roles" on a role other than Organization Administrator (ACC-221)', () => {
    const warning = () => q('[data-pm-self-elevation]', row('roles:manage')!);

    it('ticking it shows the warning under the row, part of its description', () => {
      render();
      expect(warning()).toBeNull();
      click(box('roles:manage'));
      expect(plain(text(warning()))).toBe('⚠ Anyone with this can make themselves Organization Administrator.');
      expect(box('roles:manage').getAttribute('aria-describedby')).toBe(q('[data-pm-self-elevation]')!.parentElement!.id);
    });

    it('a role that already holds it shows the warning on load', () => {
      render({ held: [...HELD, 'roles:manage'] });
      expect(warning()).not.toBeNull();
    });

    it('Organization Administrator itself shows no warning', () => {
      render({ roleKey: 'TENANT_ADMIN', isSystem: true, held: [...HELD, 'roles:manage'] });
      expect(warning()).toBeNull();
    });

    it('the save is not blocked: ticking it saves', () => {
      render();
      click(box('roles:manage'));
      click(q('[data-pm-review] button'));
      buttonByAttr('data-pm-save')!.click();
      expect(assign).toHaveBeenCalledTimes(1);
      expect(assign.calls.mostRecent().args[1]).toContain('roles:manage');
    });

    it('Arabic: «أي شخص لديه هذه الصلاحية يستطيع أن يجعل نفسه مسؤول المؤسسة.»', () => {
      render({ lang: 'ar', held: [...HELD, 'roles:manage'] });
      expect(plain(text(warning()))).toBe('⚠ أي شخص لديه هذه الصلاحية يستطيع أن يجعل نفسه مسؤول المؤسسة.');
    });
  });

  // ── Changing ───────────────────────────────────────────────────────────────

  it('a row is a plain checkbox named by its sentence; ticking it grants only that row and marks it', () => {
    render();
    const manage = box('committees:manage');
    expect(manage.getAttribute('aria-label')).toBe('Submit, suspend, reactivate, dissolve');
    expect(manage.tabIndex).toBe(0);
    click(manage);
    expect(component.changeCount()).toBe(1);
    expect(component.changes().added.map((p) => p.key)).toEqual(['committees:manage']);
    expect(row('committees:manage')!.getAttribute('data-pm-mark')).toBe('granted');
    expect(row('committees:manage')!.classList).toContain('pm-row--granted');
    expect(text(q('[data-pm-tag]', row('committees:manage')!))).toBe('＋ Granted · not saved');
    expect(counts('committees')[0]).toBe('8 of 12');
    expect(text(q('[data-pm-unsaved]'))).toBe('1 change unsaved');
    expect(text(q('[data-pm-review]'))).toBe('Review 1 change…');
  });

  it('a revoked row is struck through and tagged; the screen reader hears the same', () => {
    render();
    click(box('committees:view'));
    const r = row('committees:view')!;
    expect(r.getAttribute('data-pm-mark')).toBe('revoked');
    expect(text(q('[data-pm-tag]', r))).toBe('− Revoked · not saved');
    const describedBy = box('committees:view').getAttribute('aria-describedby')!;
    expect(text(document.getElementById(describedBy))).toBe('Newly revoked · not saved');
  });

  it('the module box is a real tri-state: mixed, named with the whole count; a press grants all, the next revokes all', () => {
    render();
    const b = moduleBox('committees');
    expect(b.getAttribute('role')).toBe('checkbox');
    expect(b.getAttribute('aria-checked')).toBe('mixed');
    expect(b.getAttribute('aria-label')).toBe('All Committees permissions, 7 of 12 granted');
    click(b);
    expect(moduleBox('committees').getAttribute('aria-checked')).toBe('true');
    expect(counts('committees')[0]).toBe('12 of 12');
    expect(component.changeCount()).toBe(5);
    click(moduleBox('committees'));
    expect(moduleBox('committees').getAttribute('aria-checked')).toBe('false');
    expect(counts('committees')[0]).toBe('0 of 12');
    // Nothing outside Committees moved.
    expect(component.selected().has('users:view')).toBeTrue();
  });

  it('a group box acts on its group only, named with the group', () => {
    render();
    const b = groupBox('members');
    expect(b.getAttribute('aria-checked')).toBe('mixed');
    expect(b.getAttribute('aria-label')).toBe('All Members permissions, 2 of 3 granted');
    click(b);
    expect(component.changes().added.map((p) => p.key)).toEqual(['committees:remove_member']);
    expect(groupBox('members').getAttribute('aria-checked')).toBe('true');
    expect(groupBox('records').getAttribute('aria-checked')).toBe('mixed');
  });

  it('Discard puts every row back, with no confirm', () => {
    render();
    click(box('committees:manage'));
    click(q('[data-pm-unsaved] ~ p-button button'));
    expect(component.changeCount()).toBe(0);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('modules open expanded and can be folded; the fold button says what it does', () => {
    render();
    const fold = q<HTMLButtonElement>('[data-pm-fold]', mod('committees'))!;
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(fold.getAttribute('aria-label')).toBe('Collapse Committees');
    click(fold);
    expect(row('committees:view')).toBeNull();
    expect(q('[data-pm-fold]', mod('committees'))!.getAttribute('aria-label')).toBe('Expand Committees');
    expect(row('users:view')).not.toBeNull();
  });

  // ── Find and Show granted only ─────────────────────────────────────────────

  it('Find filters by sentence: only matching rows and modules, "n of 12 match"', () => {
    render();
    find('member');
    expect(all('[data-pm-module]').map((m) => m.getAttribute('data-pm-module'))).toEqual(['committees']);
    expect(counts('committees')[0]).toBe('4 of 12 match');
    expect(all('[data-pm-row]').map((r) => r.getAttribute('data-pm-row'))).toEqual([
      'committees:view',
      'committees:add_member',
      'committees:remove_member',
      'committees:change_member_role',
    ]);
    // The group counts stay the group's whole count.
    expect(counts('committees').slice(1)).toEqual(['3 of 5', '2 of 3']);
    // The filter shows; it never changes what is saved.
    expect(component.changeCount()).toBe(0);
  });

  it('Show granted only uses the edited set and keeps a changed row, a revocation included', () => {
    render();
    click(box('committees:change_member_role'));
    click(q('[data-pm-granted-only] input'));
    expect(component.grantedOnly()).toBeTrue();
    const shown = all('[data-pm-row]', mod('committees')).map((r) => r.getAttribute('data-pm-row'));
    expect(shown).toContain('committees:change_member_role');
    expect(shown).not.toContain('committees:remove_member');
    expect(shown.length).toBe(7);
  });

  it('under a filter a box acts only on the visible rows, and says so in its tooltip', () => {
    render();
    find('member');
    const b = moduleBox('committees');
    expect(b.getAttribute('aria-description')).toBe('Acts only on the 4 rows shown by the current filter.');
    // Its state and its spoken count are the whole module's.
    expect(b.getAttribute('aria-label')).toBe('All Committees permissions, 7 of 12 granted');
    click(b);
    expect(component.changes().added.map((p) => p.key)).toEqual(['committees:remove_member']);
    expect(component.selected().has('committees:approve')).toBeFalse();
    // No filter, no tooltip.
    find('');
    expect(moduleBox('committees').getAttribute('aria-description')).toBeNull();
  });

  it('under a filter a group box acts only on its visible rows too', () => {
    render();
    find('member');
    // Committee records shows one row, "view", which is held: the box revokes
    // that row only, never the group's other four.
    const b = groupBox('records');
    expect(b.getAttribute('aria-description')).toBe('Acts only on the 1 row shown by the current filter.');
    expect(b.getAttribute('aria-checked')).toBe('mixed');
    click(b);
    expect(component.changes().removed.map((p) => p.key)).toEqual(['committees:view']);
    expect(component.changes().added).toEqual([]);
  });

  it('no match: "No permissions match. Clear the search." and the link clears both filters', () => {
    render();
    click(q('[data-pm-granted-only] input'));
    find('invoice');
    expect(all('[data-pm-module]').length).toBe(0);
    expect(text(q('[data-pm-no-match]'))).toBe('No permissions match. Clear the search.');
    click(q('[data-pm-clear]'));
    expect(component.query()).toBe('');
    expect(component.grantedOnly()).toBeFalse();
    expect(all('[data-pm-module]').length).toBe(11);
  });

  it('a filter opens a folded module, so a match is never hidden in a fold', () => {
    render();
    click(q('[data-pm-fold]', mod('committees')));
    find('member');
    expect(row('committees:add_member')).not.toBeNull();
  });

  it('the find box clears with its ✕', () => {
    render();
    find('member');
    click(q('[data-pm-find-clear]'));
    expect(component.query()).toBe('');
    expect(q('[data-pm-find-clear]')).toBeNull();
  });

  it('the legend shows the four marks, and no hatch', () => {
    render();
    expect(legend()).toEqual(['✓Held', 'Not held', '＋Newly granted · not saved', '−Newly revoked · not saved']);
    expect(host().textContent).not.toMatch(/not applicable/i);
  });

  // ── Read-only ──────────────────────────────────────────────────────────────

  for (const [what, setup, notice] of [
    ['the root role', { roleKey: 'TENANT_ADMIN', isSystem: true }, 'roles.matrixFrozenRootRole'],
    ['the Platform Administrator role', { roleKey: 'PLATFORM_ADMIN' }, 'roles.matrix.frozenPlatformRole'],
    ['a reader without roles:manage', { canManage: false }, 'roles.matrixReadOnly'],
  ] as const) {
    it(`${what} is read-only: ✓ and ·, no checkboxes, no boxes, no save controls, and its own sentence`, () => {
      render(setup);
      expect(component.readOnly()).toBeTrue();
      expect(component.noticeKey()).toBe(notice);
      expect(rowBoxes().length).toBe(0);
      expect(all('[role="checkbox"]').length).toBe(0);
      expect(q('[data-pm-review]')).toBeNull();
      expect(q('[data-pm-phone-bar]')).toBeNull();
      const held = q('[data-pm-glyph]', row('committees:view')!)!;
      expect(text(held)).toBe('✓');
      expect(held.getAttribute('aria-label')).toBe('Held');
      const notHeld = q('[data-pm-glyph]', row('committees:approve')!)!;
      expect(text(notHeld)).toBe('·');
      expect(notHeld.getAttribute('aria-label')).toBe('Not held');
      expect(legend()).toEqual(['✓Held', '·Not held']);
    });
  }

  it('a system role being edited shows the System chip and stays editable', () => {
    render({ isSystem: true, roleKey: 'QUALITY_MANAGER' });
    expect(text(host())).toContain('System');
    expect(component.readOnly()).toBeFalse();
    click(box('committees:manage_tasks'));
    expect(text(q('[data-pm-unsaved]'))).toBe('1 change unsaved');
  });

  // ── Loading and error ──────────────────────────────────────────────────────

  it('loading shows skeleton modules, then the list', () => {
    const later = new Subject<RoleDto>();
    render({ getRole: () => later });
    expect(all('[data-pm-skeleton]').length).toBe(3);
    expect(q('[data-pm-module]')).toBeNull();
    later.next(role({}));
    later.complete();
    fixture.detectChanges();
    expect(all('[data-pm-skeleton]').length).toBe(0);
    expect(all('[data-pm-module]').length).toBe(11);
  });

  it('a failed load is the standard error with Retry, which loads again', () => {
    let fail = true;
    render({ getRole: () => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(role({}))) });
    const alert = q('[data-pm-error]')!;
    expect(alert.getAttribute('role')).toBe('alert');
    expect(text(alert)).toContain("Couldn't load this role's permissions");
    expect(text(alert)).toContain('Nothing has changed. Check your connection and try again.');
    fail = false;
    click(q('[data-pm-retry] button'));
    expect(q('[data-pm-error]')).toBeNull();
    expect(all('[data-pm-module]').length).toBe(11);
  });

  // ── The phone bar ──────────────────────────────────────────────────────────

  it('with changes, the phone bar carries the count and "Review n changes…"; with none, it is absent', () => {
    render();
    expect(q('[data-pm-phone-bar]')).toBeNull();
    click(box('committees:manage'));
    click(box('committees:view'));
    click(box('lookups:view'));
    const bar = q('[data-pm-phone-bar]')!;
    expect(text(bar)).toContain('3 changes unsaved');
    expect(text(q('[data-pm-phone-review]', bar))).toBe('Review 3 changes…');
    click(q('[data-pm-phone-review] button', bar));
    expect(component.confirmOpen()).toBeTrue();
  });

  // ── Arabic ─────────────────────────────────────────────────────────────────

  it('Arabic: the counts read right to left with isolated digits, «7 من 12»; the groups and the box in Arabic', () => {
    render({ lang: 'ar' });
    expect(all('[data-pm-count]', mod('committees'))[0]!.textContent!.trim()).toBe('⁦7⁩ من ⁦12⁩');
    expect(groupLines('committees')).toEqual(['سجلات اللجان · 3 من 5', 'الأعضاء · 2 من 3', 'المهام على اللجان · 2 من 4']);
    expect(plain(moduleBox('committees').getAttribute('aria-label'))).toBe('كل صلاحيات اللجان، 7 من 12 ممنوحة');
    expect(q('[data-pm-find]')!.getAttribute('placeholder')).toBe('ابحث عن صلاحية');
    find('أعضاء');
    expect(plain(all('[data-pm-count]', mod('committees'))[0]!.textContent).trim()).toBe('2 من 12 مطابقة');
    expect(plain(moduleBox('committees').getAttribute('aria-description'))).toBe('يؤثر فقط في الصفين الظاهرين بالتصفية الحالية.');
    find('فاتورة');
    expect(text(q('[data-pm-no-match]'))).toBe('لا توجد صلاحيات مطابقة. امسح البحث.');
  });

  it('Arabic: a change is tagged in Arabic, and the root role tag too', () => {
    render({ lang: 'ar' });
    click(box('committees:manage'));
    expect(text(q('[data-pm-tag]', row('committees:manage')!))).toBe('＋ ممنوحة · غير محفوظة');
    expect(text(q('[data-pm-admin]') ?? row('admin:access'))).toContain('كل صفحة إدارية تحتاج أيضًا إلى صلاحيتها الخاصة.');
    render({ lang: 'ar', roleKey: 'TENANT_ADMIN' });
    expect(text(q('[data-pm-tag]', row('workflows:manage')!))).toBe('لمسؤول المنشأة فقط');
  });

  // ── Saving (unchanged from the grid: D4, D, G) ─────────────────────────────

  function grantManageAndOpen(): void {
    click(box('committees:manage'));
    click(q('[data-pm-review] button'));
  }

  it('the confirmation says who it applies to, and lists the change in words', () => {
    render({ headPositionHolderCount: 3 });
    grantManageAndOpen();
    expect(dialogText()).toContain("Applies to 14 users as soon as it's saved.");
    expect(dialogText()).toContain('3 of them hold this role through a head position.');
    expect(dialogText()).toContain('Committees · Submit, suspend, reactivate, dissolve');
  });

  it('three changes: Review lists the granted and the revoked, in the list order', () => {
    render();
    click(box('committees:approve'));
    click(box('committees:change_member_role'));
    click(box('lookups:view'));
    click(q('[data-pm-review] button'));
    expect(dialogText()).toContain('Committees · Approve terms, changes and dissolutions');
    expect(dialogText()).toContain('Lookups · See lookup lists and their values');
    expect(dialogText()).toContain("Committees · Change a member’s role on a committee");
    expect(component.changes().removed.map((p) => p.key)).toEqual(['lookups:view', 'committees:change_member_role']);
  });

  it('save sends the edited set AND the set as loaded, hidden held keys included (D4)', () => {
    render();
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    expect(assign).toHaveBeenCalledTimes(1);
    const [id, keys, expected] = assign.calls.mostRecent().args as [string, string[], string[]];
    expect(id).toBe('r1');
    expect([...keys].sort()).toEqual([...HELD, 'committees:manage'].sort());
    expect([...expected].sort()).toEqual([...HELD].sort());
  });

  it('a 400 PERMISSION_ROOT_ROLE_ONLY says only the Organization Administrator can edit workflows, and offers no Save', () => {
    render({
      assign: () => throwError(() => new HttpErrorResponse({ status: 400, error: { code: 'PERMISSION_ROOT_ROLE_ONLY', keys: ['workflows:manage'] } })),
    });
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('rootRoleOnly');
    expect(buttonByAttr('data-pm-save')).toBeNull();
  });

  it('a 409 says someone else saved first, and offers only "Reload role", which reloads', () => {
    render({ assign: () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ROLE_PERMISSIONS_CHANGED' } })) });
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('conflict');
    expect(plain(document.querySelector('[data-pm-alert]')?.textContent)).toContain(
      'Quality Editor was changed by someone else since you opened it. Nothing was saved.',
    );
    expect(buttonByAttr('data-pm-save')).toBeNull();
    buttonByAttr('data-pm-reload')!.click();
    fixture.detectChanges();
    expect(getRole).toHaveBeenCalledTimes(2);
    expect(component.changeCount()).toBe(0);
  });

  it('isolates the role name inside an Arabic sentence', () => {
    render({ lang: 'ar', assign: () => throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ROLE_PERMISSIONS_CHANGED' } })) });
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(document.querySelector('[data-pm-alert]')?.textContent).toContain('«⁨محرر الجودة⁩»');
  });

  it('a 403 says the permission is gone, and drops Try again', () => {
    render({ assign: () => throwError(() => new HttpErrorResponse({ status: 403, error: {} })) });
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('forbidden');
    expect(buttonByAttr('data-pm-save')).toBeNull();
  });

  it('a failed save keeps every change and offers Try again', () => {
    render({ assign: () => throwError(() => new HttpErrorResponse({ status: 500, error: {} })) });
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('failed');
    expect(component.changeCount()).toBe(1);
    expect(buttonByAttr('data-pm-save')?.textContent?.trim()).toBe('Try again');
  });

  it('a successful save clears the marks and the count', () => {
    render();
    grantManageAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.changeCount()).toBe(0);
    expect(component.confirmOpen()).toBeFalse();
    expect(row('committees:manage')!.getAttribute('data-pm-mark')).toBe('on');
    expect(text(q('[data-pm-saved]'))).toContain('Saved · 1 change');
  });

  // ── Leaving (D11) ──────────────────────────────────────────────────────────

  it('leaves freely with nothing unsaved', () => {
    render();
    expect(component.canLeave()).toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving with unsaved changes, and stays if told to', async () => {
    render();
    click(box('committees:manage'));
    const answer = component.canLeave() as Promise<boolean>;
    expect(confirm).toHaveBeenCalledTimes(1);
    const options = confirm.calls.mostRecent().args[0] as { header: string; acceptLabel: string; rejectLabel: string; reject: () => void };
    expect(options.header).toBe('Leave without saving?');
    expect(options.acceptLabel).toBe('Leave');
    expect(options.rejectLabel).toBe('Stay');
    options.reject();
    expect(await answer).toBeFalse();
  });

  it('warns on a reload or closed tab while changes are unsaved', () => {
    render();
    const clean = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.onBeforeUnload(clean);
    expect(clean.defaultPrevented).toBeFalse();
    click(box('committees:manage'));
    const dirty = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.onBeforeUnload(dirty);
    expect(dirty.defaultPrevented).toBeTrue();
  });
});
