import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ConfirmationService, Confirmation } from 'primeng/api';
import { NEVER, of, throwError } from 'rxjs';
import { UserListComponent } from './user-list.component';
import { IUserDto, UserService } from '../../services/user.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { RoleService } from '../../../roles/services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { provideFormatTesting } from '../../../../core/formatting/testing';

/**
 * ACC-83 — what the reactivation confirmation SAYS, and the reserved message
 * slot that stopped it moving rows.
 *
 * The confirmation is the whole safety mechanism here. UserRole rows survive
 * deactivation, so a reactivated person returns holding every direct role they
 * had — possibly Organization Administrator — and an administrator should see
 * the authority they are about to restore while deciding, not discover it
 * afterwards.
 */
describe('UserListComponent — reactivation confirmation (ACC-83)', () => {
  let captured: Confirmation | null;
  let reactivate: jasmine.Spy;

  function create(opts: { roles?: { nameEn: string; nameAr: string }[]; rolesFail?: boolean } = {}) {
    captured = null;
    reactivate = jasmine.createSpy('reactivate').and.returnValue(of({ returnedTaskCount: 0 }));

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        {
          provide: ConfirmationService,
          // Captured rather than rendered: the dialog's TEXT is what is under
          // test, and PrimeNG's own rendering is not this spec's business.
          useValue: { confirm: (c: Confirmation) => (captured = c) },
        },
        {
          provide: UserService,
          useValue: {
            reactivate,
            revokeInvitation: () => of(undefined),
            // Called by the success path. Present so a test that accepts the
            // dialog fails on its own assertion rather than on a missing stub.
            getStatusCounts: () => of({}),
            listAllUsers: () => of([]),
          },
        },
        { provide: OrgPositionService, useValue: {} },
        { provide: OrgUnitService, useValue: {} },
        {
          provide: RoleService,
          useValue: {
            getUserRoles: () =>
              opts.rolesFail
                ? throwError(() => new Error('403'))
                : of((opts.roles ?? []).map((role) => ({ role }))),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: () => true },
        },
        // STUBBED, and not merely for convenience: the real LanguageService
        // writes document.documentElement.dir when it is constructed, and that
        // is global state no TestBed resets. Letting it run here turned the
        // document RTL and made DataListComponent's own alignment spec fail
        // later in the same browser, with column offsets in reverse order —
        // a failure in a file this one does not touch.
        { provide: LanguageService, useValue: { isArabic: () => false, isRtl: () => false } },
      ],
    });
    // The TestBed loads no translations, so instant() returns the KEY and the
    // interpolated role names never reach the string. Asserting on the names
    // without this would be asserting on a translation file that is not loaded
    // — it would pass or fail for the wrong reason either way. So instant() is
    // made to echo its PARAMS, which is what the component is actually
    // responsible for passing.
    const translate = TestBed.inject(TranslateService);
    spyOn(translate, 'instant').and.callFake(
      (key: string | string[], params?: object) =>
        `${String(key)}${params ? ' ' + JSON.stringify(params) : ''}`,
    );

    return TestBed.createComponent(UserListComponent).componentInstance;
  }

  const inactive = (): IUserDto =>
    ({
      id: 'u-1',
      name: 'Dr. Faisal Al-Qahtani',
      email: 'faisal@example.test',
      status: 'INACTIVE',
      primaryOrgUnitId: 'unit-1',
    }) as IUserDto;

  it('names the roles the person comes back holding', () => {
    const list = create({
      roles: [
        { nameEn: 'Organization Administrator', nameAr: 'مسؤول المؤسسة' },
        { nameEn: 'Auditor', nameAr: 'مراجع' },
      ],
    });

    list.confirmReactivate(inactive());

    expect(captured).toBeTruthy();
    expect(captured!.message).toContain('user.reactivateRoles');
    expect(captured!.message).toContain('Organization Administrator');
    expect(captured!.message).toContain('Auditor');
  });

  // The roles are read BEFORE the dialog opens. If the dialog opened first and
  // filled in afterwards, an administrator could confirm while the sentence
  // still said nothing — which is the failure mode this ordering exists for.
  it('does not open the dialog until the roles are known', () => {
    const list = create({ roles: [{ nameEn: 'Auditor', nameAr: 'مراجع' }] });

    list.confirmReactivate(inactive());

    expect(captured!.message).toContain('Auditor');
  });

  it('says plainly when they hold no roles, rather than leaving a gap', () => {
    const list = create({ roles: [] });

    list.confirmReactivate(inactive());

    expect(captured!.message).toContain('user.reactivateNoRoles');
  });

  // A caller may hold users:reactivate without users:view, and
  // GET /users/:id/roles needs the parent permission (ACC-101). The dialog must
  // still open and must SAY the roles could not be listed — a blank where
  // authority should be named is the worst of the three outcomes.
  it('still opens, and says so, when the roles cannot be read', () => {
    const list = create({ rolesFail: true });

    list.confirmReactivate(inactive());

    expect(captured).toBeTruthy();
    expect(captured!.message).toContain('user.reactivateRolesUnavailable');
    expect(captured!.message).not.toContain('user.reactivateNoRoles');
  });

  // ACC-83 already required the dialog to say what does NOT come back.
  it('builds the whole message from one translated string', () => {
    const list = create({ roles: [] });

    list.confirmReactivate(inactive());

    expect(captured!.message).toContain('user.reactivateConfirm');
    // Not assembled in the component: one instant() call carries both the
    // tasks note and the roles sentence, so the translation owns the order.
    expect(captured!.message).not.toContain('user.reactivateTasksNote');
  });

  it('only calls the endpoint once the confirmation is accepted', () => {
    const list = create({ roles: [] });
    // NEVER, deliberately: this test is about WHEN the call happens, and
    // letting it resolve would run the success path, which reloads a list this
    // unrendered component has no ViewChild for.
    reactivate.and.returnValue(NEVER);

    list.confirmReactivate(inactive());
    expect(reactivate).not.toHaveBeenCalled();

    captured!.accept!();
    expect(reactivate).toHaveBeenCalledWith('u-1');
  });
});

/**
 * ACC-83 — the message slot is RESERVED, so a message cannot move the rows.
 *
 * These two blocks sat in normal flow, so either appearing pushed the whole
 * table down by roughly 60px. On a list whose row menu holds an irreversible
 * action that is not cosmetic: the wrong person was deactivated with it, by
 * clicking the position a row had occupied a moment before a refusal appeared.
 */
describe('UserListComponent — the message slot does not move the rows (ACC-83)', () => {
  function render() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserListComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        {
          provide: UserService,
          useValue: {
            listAllUsers: () => of([]),
            getStatusCounts: () => of({}),
            listUsers: () => of({ data: [], total: 0, page: 1, pageSize: 25 }),
          },
        },
        { provide: OrgPositionService, useValue: { listPositions: () => of([]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: RoleService, useValue: { getUserRoles: () => of([]) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        // STUBBED, and not merely for convenience: the real LanguageService
        // writes document.documentElement.dir when it is constructed, and that
        // is global state no TestBed resets. Letting it run here turned the
        // document RTL and made DataListComponent's own alignment spec fail
        // later in the same browser, with column offsets in reverse order —
        // a failure in a file this one does not touch.
        { provide: LanguageService, useValue: { isArabic: () => false, isRtl: () => false } },
      ],
    });
    const fixture = TestBed.createComponent(UserListComponent);
    fixture.detectChanges();
    return fixture;
  }

  function slot(fixture: ReturnType<typeof render>): HTMLElement {
    const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '.min-h-\\[2\\.5rem\\]',
    );
    expect(el).withContext('the reserved message slot is rendered').toBeTruthy();
    return el!;
  }

  // THE NON-VACUITY GUARD, first: a height comparison where both numbers are
  // zero passes for the wrong reason.
  it('reserves real height while empty', () => {
    const fixture = render();
    const height = slot(fixture).getBoundingClientRect().height;

    expect(height).toBeGreaterThan(0);
  });

  it('does not grow when a message appears, so nothing below it moves', () => {
    const fixture = render();
    const empty = slot(fixture).getBoundingClientRect().height;

    fixture.componentInstance.infoMessage.set('Dr. Faisal Al-Qahtani is active again.');
    fixture.detectChanges();

    const filled = slot(fixture).getBoundingClientRect().height;
    expect(filled).toBe(empty);
  });

  it('shows the message it was given, so the slot is not merely empty space', () => {
    const fixture = render();

    fixture.componentInstance.infoMessage.set('Dr. Faisal Al-Qahtani is active again.');
    fixture.detectChanges();

    expect(slot(fixture).textContent).toContain('is active again');
  });
});
