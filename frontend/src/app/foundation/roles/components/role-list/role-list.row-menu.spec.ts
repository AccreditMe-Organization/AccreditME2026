import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { Confirmation, ConfirmationService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LayerStackService } from '../../../../shared/overlay/layer-stack.service';
import { RoleDto, RoleService } from '../../services/role.service';
import { RoleListComponent } from './role-list.component';

// ACC-235 — the Roles row ⋯ is am-row-menu: attached to the page body under its
// own row's ⋯, so it can never widen the list or make the page scroll sideways
// (the p-menu popup it replaces rendered inside <main>). Plus the Roles dialog
// clean-up: field errors on submit, Cancel asking first, "Inactive" not
// "Cancelled", and a row action's failure said from its code.

function role(id: string, over: Partial<RoleDto> = {}): RoleDto {
  return {
    id,
    key: `ROLE_${id}`,
    nameEn: `Role ${id}`,
    nameAr: `دور ${id}`,
    description: null,
    isSystem: false,
    isActive: true,
    permissionCount: 3,
    ...over,
  } as RoleDto;
}

const ROLES = [
  role('a', { nameEn: 'Auditor' }),
  role('b', { nameEn: 'Quality Manager' }),
  role('c', { nameEn: 'Retired Role', isActive: false }),
];

describe('RoleListComponent — the row ⋯ menu and the Roles dialog (ACC-235)', () => {
  let fixture: ComponentFixture<RoleListComponent>;
  let el: HTMLElement;
  let service: jasmine.SpyObj<RoleService>;
  let confirm: jasmine.Spy<(c: Confirmation) => ConfirmationService>;

  async function setup(): Promise<void> {
    service = jasmine.createSpyObj<RoleService>('RoleService', [
      'listRoles',
      'deactivateRole',
      'activateRole',
      'createRole',
      'updateRole',
    ]);
    service.listRoles.and.returnValue(of({ data: ROLES, total: ROLES.length, page: 1, pageSize: 25 }));
    service.activateRole.and.returnValue(of(void 0));
    TestBed.configureTestingModule({
      imports: [RoleListComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: RoleService, useValue: service },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use('en');
    confirm = spyOn(TestBed.inject(ConfirmationService), 'confirm');
    fixture = TestBed.createComponent(RoleListComponent);
    el = fixture.nativeElement;
    // Pinned to the window, as the app's page is: earlier specs can leave the
    // test page long enough to put a row below the window, and CDK then pulls
    // the menu back into view away from its ⋯.
    el.style.cssText = 'position: fixed; inset: 0; display: block; overflow: auto';
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(el);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => {
    document.documentElement.style.overflow = '';
    el?.remove();
    document.querySelectorAll('.cdk-overlay-container, .p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    try {
      localStorage.clear();
    } catch {
      /* no storage: nothing to clear */
    }
  });

  const triggers = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[data-testid="row-menu-trigger"]'));
  const menu = () => document.querySelector<HTMLElement>('[data-testid="row-menu"]');
  const item = (action: string) => menu()?.querySelector<HTMLButtonElement>(`[data-action="${action}"]`) ?? null;

  async function open(index: number): Promise<HTMLButtonElement> {
    const trigger = triggers()[index]!;
    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    return trigger;
  }

  it('each row has a ⋯ that names its role', async () => {
    await setup();
    expect(triggers().length).withContext('one ⋯ per row').toBe(3);
    expect(triggers().map((t) => t.getAttribute('aria-label'))).toEqual([
      'Actions for Auditor',
      'Actions for Quality Manager',
      'Actions for Retired Role',
    ]);
  });

  it('the menu opens at its own row’s ⋯, aligned to its end, outside the list', async () => {
    await setup();
    const trigger = await open(1);
    const m = menu();
    expect(m).withContext('the menu opened').not.toBeNull();
    // Non-vacuity: both boxes are laid out before their positions mean anything.
    const t = trigger.getBoundingClientRect();
    const r = m!.getBoundingClientRect();
    expect(t.width).toBeGreaterThan(0);
    expect(r.width).toBeGreaterThan(0);
    // Below the ⋯, or above it when there is no room below (the menu's own
    // fallback): either way, against its own row's ⋯.
    const adjacent = r.top >= t.bottom - 1 || r.bottom <= t.top + 1;
    expect(adjacent).withContext(`next to the ⋯ (menu ${r.top}-${r.bottom}, ⋯ ${t.top}-${t.bottom})`).toBeTrue();
    expect(Math.min(Math.abs(r.top - t.bottom), Math.abs(t.top - r.bottom))).withContext('touching its ⋯').toBeLessThanOrEqual(8);
    expect(Math.abs(r.right - t.right)).withContext('aligned to the ⋯’s end').toBeLessThanOrEqual(2);
    // Attached to the page body, so nothing inside the list can be widened by it.
    expect(el.contains(m)).withContext('the menu is not inside the list').toBeFalse();
  });

  it('Manage permissions opens the role’s permissions page', async () => {
    await setup();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    await open(1);
    item('permissions')!.click();
    expect(navigate).toHaveBeenCalledWith(['b', 'permissions'], jasmine.anything());
  });

  it('Deactivate asks first, and confirming deactivates that role', async () => {
    await setup();
    service.deactivateRole.and.returnValue(of(void 0));
    await open(0);
    item('deactivate')!.click();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(service.deactivateRole).not.toHaveBeenCalled();
    confirm.calls.mostRecent().args[0].accept!();
    expect(service.deactivateRole).toHaveBeenCalledWith('a');
  });

  it('an inactive role offers Activate, which activates it', async () => {
    await setup();
    await open(2);
    expect(item('deactivate')).toBeNull();
    item('activate')!.click();
    expect(service.activateRole).toHaveBeenCalledWith('c');
  });

  it('Escape closes only the menu, and focus goes back to its ⋯', async () => {
    await setup();
    const layers = TestBed.inject(LayerStackService);
    const trigger = await open(0);
    expect(layers.depth()).withContext('the menu is a layer').toBe(1);
    // keyCode too: the CDK menu reads keyCode, not key.
    menu()!.querySelector('button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    expect(menu()).withContext('the menu closed').toBeNull();
    expect(document.activeElement).withContext('focus is back on the ⋯').toBe(trigger);
    expect(layers.depth()).toBe(0);
    expect(fixture.componentInstance.showFormDialog()).toBeFalse();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('an inactive role reads "Inactive", not the account chip’s "Cancelled"', async () => {
    await setup();
    const text = el.textContent!;
    expect(text).toContain('Retired Role');
    expect(text).toContain('Inactive');
    expect(text).not.toContain('Cancelled');
  });

  // ACC-221 — Organization Administrator is never deactivated.
  it('Organization Administrator offers no Deactivate; any other role still does', async () => {
    await setup();
    const ids = (r: RoleDto) => fixture.componentInstance.menuFor(r).map((i) => i.id);
    expect(ids(role('root', { key: 'TENANT_ADMIN', isSystem: true }))).toEqual(['permissions']);
    expect(ids(role('other'))).toEqual(['permissions', 'deactivate']);
  });

  it('ROOT_ROLE_CANNOT_BE_DEACTIVATED is said from its code (ACC-221)', async () => {
    await setup();
    service.deactivateRole.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'ROOT_ROLE_CANNOT_BE_DEACTIVATED', message: 'server text' } })),
    );
    fixture.componentInstance.pick(ROLES[0]!, 'deactivate');
    confirm.calls.mostRecent().args[0].accept!();
    fixture.detectChanges();
    const box = el.querySelector('[data-testid="role-action-error"]')!;
    expect(box.textContent).toContain("Organization Administrator can't be deactivated.");
    expect(box.textContent).not.toContain('server text');
  });

  it('a refused deactivate is said from its code, with no Try again when trying again cannot help', async () => {
    await setup();
    service.deactivateRole.and.returnValue(
      throwError(() => new HttpErrorResponse({ status: 409, error: { code: 'LAST_ACTIVE_ADMINISTRATOR', message: 'server text' } })),
    );
    fixture.componentInstance.pick(ROLES[0]!, 'deactivate');
    confirm.calls.mostRecent().args[0].accept!();
    fixture.detectChanges();
    const box = el.querySelector('[data-testid="role-action-error"]')!;
    expect(box.textContent).toContain('no active administrator');
    expect(box.textContent).not.toContain('server text');
    expect(box.querySelector('button')).withContext('no Try again').toBeNull();
  });

  it('a failed deactivate offers Try again, which tries again', async () => {
    await setup();
    service.deactivateRole.and.returnValue(throwError(() => new HttpErrorResponse({ status: 500 })));
    fixture.componentInstance.pick(ROLES[0]!, 'deactivate');
    confirm.calls.mostRecent().args[0].accept!();
    fixture.detectChanges();
    const box = el.querySelector('[data-testid="role-action-error"]')!;
    expect(box.textContent).toContain("The role couldn't be deactivated.");
    service.deactivateRole.and.returnValue(of(void 0));
    box.querySelector<HTMLButtonElement>('button')!.click();
    fixture.detectChanges();
    expect(service.deactivateRole).toHaveBeenCalledTimes(2);
    expect(el.querySelector('[data-testid="role-action-error"]')).withContext('cleared on success').toBeNull();
  });

  it('the role form shows its errors on submit, and sends nothing', async () => {
    await setup();
    fixture.componentInstance.openAdd();
    fixture.detectChanges();
    await fixture.whenStable();
    const form = document.querySelector<HTMLFormElement>('app-role-form form')!;
    expect(form).withContext('the form rendered').not.toBeNull();
    expect(document.querySelectorAll('app-role-form am-field').length).withContext('every field wrapped').toBe(3);
    // Save is in the dialog's footer, outside the body.
    const save = document.querySelector<HTMLButtonElement>('[data-testid="role-save"] button')!;
    expect(save.disabled).withContext('Save stays enabled').toBeFalse();
    save.click();
    fixture.detectChanges();
    expect(document.body.textContent).toContain("Enter the role's name in English.");
    expect(service.createRole).not.toHaveBeenCalled();
  });

  it('Cancel on a changed role form asks before discarding', async () => {
    await setup();
    fixture.componentInstance.openEdit(ROLES[1]!);
    fixture.detectChanges();
    await fixture.whenStable();
    const name = document.querySelector<HTMLInputElement>('app-role-form #nameEn')!;
    expect(name.value).toBe('Quality Manager');
    name.value = 'Quality Lead';
    name.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog .am-dialog__footer button, .p-dialog .p-dialog-footer button')).find(
      (b) => b.textContent!.trim() === 'Cancel',
    )!;
    cancel.click();
    fixture.detectChanges();
    expect(confirm).withContext('asked first').toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.showFormDialog()).withContext('still open').toBeTrue();
  });

  it('Cancel on an unchanged role form simply closes', async () => {
    await setup();
    fixture.componentInstance.openEdit(ROLES[1]!);
    fixture.detectChanges();
    await fixture.whenStable();
    const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>('.p-dialog .am-dialog__footer button, .p-dialog .p-dialog-footer button')).find(
      (b) => b.textContent!.trim() === 'Cancel',
    )!;
    cancel.click();
    fixture.detectChanges();
    expect(confirm).not.toHaveBeenCalled();
    expect(fixture.componentInstance.showFormDialog()).toBeFalse();
  });
});
