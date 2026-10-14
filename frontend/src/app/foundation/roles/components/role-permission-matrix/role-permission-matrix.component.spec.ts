import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { Observable, of, throwError } from 'rxjs';
import { RolePermissionMatrixComponent } from './role-permission-matrix.component';
import { PermissionDto, RoleDto, RoleService } from '../../services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';

// ACC-120 slice 5, PR B — the permission matrix screen (plan sections A, C–G).
//
// Real translations are loaded, so assertions read what a person reads. The
// rows of this catalogue, in order (users before committees: D3):
//   0 Users (module)          1 users:view
//   2 Committees (module)     3 committees:view      4 committees:create
//   5 committees:edit_details 6 committees:approve   7 committees:manage (whole row)
// platform:admin is hidden in a tenant; documents:view is not in use, and the
// role HOLDS it, so it must travel back on save untouched.

const perm = (key: string, inUse = true): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse };
};

const CATALOGUE: PermissionDto[] = [
  perm('committees:view'),
  perm('committees:create'),
  perm('committees:edit_details'),
  perm('committees:approve'),
  perm('committees:manage'),
  perm('users:view'),
  perm('platform:admin'),
  perm('documents:view', false),
];

const ROW = { usersModule: 0, committeesModule: 2, view: 3, create: 4, approve: 6, manage: 7 };
const CELL = { label: 0, view: 1, create: 2, edit: 3, delete: 4, approve: 5, audit: 6 };

interface Setup {
  roleKey?: string;
  held?: string[];
  canManage?: boolean;
  platformOrg?: boolean;
  headPositionHolderCount?: number;
  assign?: () => Observable<RoleDto>;
}

describe('RolePermissionMatrixComponent (ACC-120 slice 5, PR B)', () => {
  // Two specs switch to Arabic, which flips <html dir>; this puts it back.
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
    isSystem: false,
    isActive: true,
    createdAt: '',
    updatedAt: '',
    permissions: s.held ?? ['committees:view', 'documents:view'],
    activeHolderCount: 14,
    headPositionHolderCount: s.headPositionHolderCount ?? 0,
  });

  function render(s: Setup = {}): void {
    TestBed.resetTestingModule();
    assign = jasmine.createSpy('assignPermissions').and.callFake(
      s.assign ?? ((_id: string, keys: string[]) => of({ ...role(s), permissions: keys })),
    );
    getRole = jasmine.createSpy('getRole').and.callFake(() => of(role(s)));
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
        {
          provide: RoleService,
          useValue: { getRole, listAllPermissions: () => of(CATALOGUE), assignPermissions: assign },
        },
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
    TestBed.inject(TranslateService).use('en');
    fixture = TestBed.createComponent(RolePermissionMatrixComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
  });

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const grid = (): HTMLElement => host().querySelector('[role="grid"]') as HTMLElement;
  const cell = (r: number, c: number): HTMLElement =>
    host().querySelector(`[data-pm-cell="${r}:${c}"]`) as HTMLElement;
  const key = (k: string, shift = false): void => {
    grid().dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
    fixture.detectChanges();
  };
  const focusOn = (r: number, c: number): void => {
    component.focusAt.set([r, c]);
    fixture.detectChanges();
  };
  const checkboxes = (): HTMLElement[] => Array.from(host().querySelectorAll('[role="checkbox"]'));
  // Bidi isolates are invisible; strip them where a test reads English prose.
  const plain = (s: string | null | undefined): string => (s ?? '').replace(/[⁨⁩]/g, '');
  const dialogText = (): string => plain(document.querySelector('[data-pm-confirm]')?.textContent);
  const buttonByAttr = (attr: string): HTMLButtonElement | null =>
    document.querySelector(`[${attr}] button`) as HTMLButtonElement | null;

  // ── Rows, columns and what is shown ────────────────────────────────────────

  it('labels rows with sentences, never keys, and hides platform keys inside a tenant (D2, R4)', () => {
    render();
    const text = host().textContent ?? '';
    expect(text).toContain('Approve terms and confirm a dissolution');
    expect(text).not.toContain('committees:approve');
    expect(text).not.toContain('Run the AccreditMe platform');
    // Not in use: never shown, though the role holds it.
    expect(text).not.toContain('documents');
  });

  it('shows platform keys in the platform organisation (D2)', () => {
    render({ platformOrg: true });
    expect(host().textContent).toContain('Run the AccreditMe platform');
  });

  it('a whole-row grant: the toggle is in the label column, and all six cells are hatched (D1, R3)', () => {
    render();
    const label = cell(ROW.manage, CELL.label);
    expect(label.getAttribute('role')).toBe('checkbox');
    const row = label.closest('[role="row"]') as HTMLElement;
    expect(row.querySelectorAll('[role="gridcell"] [role="checkbox"]').length).toBe(0);
    expect(row.querySelectorAll('[role="gridcell"] .pm-glyph--na').length).toBe(6);
  });

  // ── The keyboard (D9) ──────────────────────────────────────────────────────

  it('Space toggles the focused cell', () => {
    render();
    focusOn(ROW.create, CELL.create);
    key(' ');
    expect(component.selected().has('committees:create')).toBeTrue();
    key(' ');
    expect(component.selected().has('committees:create')).toBeFalse();
  });

  // Found in the browser check: focus that arrives WITHOUT an arrow key (Tab,
  // a script, a screen reader) left the roving stop behind, and Space toggled
  // the first module instead of the focused cell.
  it('Space acts on the cell that has focus, however focus got there', () => {
    render();
    cell(ROW.create, CELL.create).focus();
    key(' ');
    expect(component.selected().has('committees:create')).toBeTrue();
    expect(component.changeCount()).toBe(1);
  });

  it('Shift+Space toggles the whole row: on a module row, the whole module', () => {
    render();
    focusOn(ROW.committeesModule, CELL.view);
    key(' ', true);
    expect(
      ['committees:view', 'committees:create', 'committees:edit_details', 'committees:approve', 'committees:manage'].every(
        (k) => component.selected().has(k),
      ),
    ).toBeTrue();
  });

  it('the module checkbox is a real tri-state: mixed while part of the module is granted', () => {
    render();
    expect(cell(ROW.committeesModule, CELL.label).getAttribute('aria-checked')).toBe('mixed');
    cell(ROW.committeesModule, CELL.label).click();
    fixture.detectChanges();
    expect(cell(ROW.committeesModule, CELL.label).getAttribute('aria-checked')).toBe('true');
  });

  it('arrows follow the eye: ArrowRight moves forward in English and BACK in Arabic', () => {
    render();
    focusOn(ROW.view, CELL.view);
    key('ArrowRight');
    expect(component.focusAt()).toEqual([ROW.view, CELL.create]);

    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    focusOn(ROW.view, CELL.create);
    key('ArrowRight');
    expect(component.focusAt()).toEqual([ROW.view, CELL.view]);
  });

  it('an unsaved grant is ringed and named as such', () => {
    render();
    cell(ROW.create, CELL.create).closest('[role="gridcell"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const box = cell(ROW.create, CELL.create);
    expect(box.classList).toContain('pm-glyph--granted');
    expect(box.getAttribute('aria-label')).toBe('Create a committee · Create · granted, not saved');
  });

  // ── Read-only (C / D7, G) ──────────────────────────────────────────────────

  for (const [what, setup, notice] of [
    ['the root role', { roleKey: 'TENANT_ADMIN' }, 'roles.matrixFrozenRootRole'],
    ['the Platform Administrator role', { roleKey: 'PLATFORM_ADMIN' }, 'roles.matrix.frozenPlatformRole'],
    ['a reader without roles:manage', { canManage: false }, 'roles.matrixReadOnly'],
  ] as const) {
    it(`${what} is read-only: glyphs, no checkboxes, no save bar, and its own sentence`, () => {
      render(setup);
      expect(component.readOnly()).toBeTrue();
      expect(checkboxes().length).toBe(0);
      expect(host().querySelector('[data-pm-review]')).toBeNull();
      expect(component.noticeKey()).toBe(notice);
      expect(cell(ROW.view, CELL.view).getAttribute('aria-label')).toBe(
        'Open a committee record and its members · View · granted',
      );
      key(' ');
      expect(component.changeCount()).toBe(0);
    });
  }

  // ── Saving (D4, D, G) ──────────────────────────────────────────────────────

  function grantCreateAndOpen(): void {
    focusOn(ROW.create, CELL.create);
    key(' ');
    (host().querySelector('[data-pm-review] button') as HTMLButtonElement).click();
    fixture.detectChanges();
  }

  it('the confirmation says who it applies to, and lists the change in words', () => {
    render({ headPositionHolderCount: 3 });
    grantCreateAndOpen();
    expect(dialogText()).toContain("Applies to 14 users as soon as it's saved.");
    expect(dialogText()).toContain('3 of them hold this role through a head position.');
    expect(dialogText()).toContain('Committees · Create a committee');
    expect(dialogText()).not.toMatch(/lose/i);
  });

  it('omits the head-position line when nobody holds it that way', () => {
    render({ headPositionHolderCount: 0 });
    grantCreateAndOpen();
    expect(document.querySelector('[data-pm-head]')).toBeNull();
  });

  it('save sends the edited set AND the set as loaded, hidden held keys included (D4)', () => {
    render();
    grantCreateAndOpen();
    buttonByAttr('data-pm-save')!.click();
    expect(assign).toHaveBeenCalledTimes(1);
    const [id, keys, expected] = assign.calls.mostRecent().args as [string, string[], string[]];
    expect(id).toBe('r1');
    expect([...keys].sort()).toEqual(['committees:create', 'committees:view', 'documents:view']);
    expect([...expected].sort()).toEqual(['committees:view', 'documents:view']);
  });

  it('a 409 says someone else saved first, and offers only "Reload role", which reloads', () => {
    render({
      assign: () =>
        throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ROLE_PERMISSIONS_CHANGED' } })),
    });
    grantCreateAndOpen();
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

  // Found in the browser check: an English name inside an Arabic sentence lost
  // its order («Matrix check (delete me)» rendered with the brackets swapped).
  it('isolates the role name inside an Arabic sentence', () => {
    render({
      assign: () =>
        throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ROLE_PERMISSIONS_CHANGED' } })),
    });
    TestBed.inject(TranslateService).use('ar');
    fixture.detectChanges();
    grantCreateAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(document.querySelector('[data-pm-alert]')?.textContent).toContain('«⁨محرر الجودة⁩»');
  });

  it('a 403 says the permission is gone, and drops Try again', () => {
    render({ assign: () => throwError(() => new HttpErrorResponse({ status: 403, error: {} })) });
    grantCreateAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('forbidden');
    expect(document.querySelector('[data-pm-alert]')?.textContent).toContain(
      'You no longer have permission to change roles. Nothing was saved.',
    );
    expect(buttonByAttr('data-pm-save')).toBeNull();
  });

  it('a failed save keeps every change and offers Try again', () => {
    render({ assign: () => throwError(() => new HttpErrorResponse({ status: 500, error: {} })) });
    grantCreateAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.saveState()).toBe('failed');
    expect(component.changeCount()).toBe(1);
    expect(buttonByAttr('data-pm-save')?.textContent?.trim()).toBe('Try again');
  });

  it('a successful save clears the rings and the count', () => {
    render();
    grantCreateAndOpen();
    buttonByAttr('data-pm-save')!.click();
    fixture.detectChanges();
    expect(component.changeCount()).toBe(0);
    expect(component.confirmOpen()).toBeFalse();
    expect(host().querySelector('[data-pm-saved]')?.textContent).toContain('Saved · 1 change');
  });

  // ── Leaving (D11) ──────────────────────────────────────────────────────────

  it('leaves freely with nothing unsaved', () => {
    render();
    expect(component.canLeave()).toBeTrue();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving with unsaved changes, in translated words, and stays if told to', async () => {
    render();
    focusOn(ROW.create, CELL.create);
    key(' ');
    const answer = component.canLeave() as Promise<boolean>;
    expect(confirm).toHaveBeenCalledTimes(1);
    const options = confirm.calls.mostRecent().args[0] as {
      header: string;
      acceptLabel: string;
      rejectLabel: string;
      reject: () => void;
    };
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
    focusOn(ROW.create, CELL.create);
    key(' ');
    const dirty = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    component.onBeforeUnload(dirty);
    expect(dirty.defaultPrevented).toBeTrue();
  });
});
