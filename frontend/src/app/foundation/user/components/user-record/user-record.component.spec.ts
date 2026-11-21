import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { UserRecordComponent } from './user-record.component';
import { EditProfileDialogComponent } from './edit-profile-dialog.component';
import { AuthService } from '../../../../core/services/auth.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { FormatService } from '../../../../core/formatting';
import { IUserDto } from '../../services/user.service';
import { UserSessionsPanelComponent } from './user-sessions-panel.component';

// ACC-120 slice 5 — the user record page. Numbered tests are the plan's
// (backend/Plans/step-120-5-user-record.md); each was seen to fail under its
// mutation.
describe('UserRecordComponent (ACC-120 slice 5)', () => {
  const ME = 'cmtra1n1i00nuocp1hnoxvttd';
  const OTHER = 'cmtra1opx00nzocp15rd2xmhd';

  const record = (overrides: Partial<IUserDto> = {}): IUserDto => ({
    id: OTHER,
    organizationId: 'cmtr9x7zq0000ocp1am2rs14o',
    email: 'yasser.alamri@alnakheel-hospital.test',
    name: 'Dr. Yasser Al-Amri',
    avatarUrl: null,
    status: 'ACTIVE',
    language: null,
    positionId: 'pos-senior',
    primaryOrgUnitId: 'unit-im',
    managerId: 'mgr-1',
    outOfOfficeFrom: null,
    outOfOfficeTo: null,
    actingUserId: 'cover-1',
    actingOrgUnitId: null,
    actingOrgUnitUntil: null,
    lastLoginAt: null,
    createdAt: '2026-09-07T00:00:00.000Z',
    updatedAt: '2026-09-07T00:00:00.000Z',
    references: {
      position: { nameEn: 'Senior Specialist', nameAr: 'أخصائي أول' },
      primaryOrgUnit: { nameEn: 'Internal Medicine Ward', nameAr: 'جناح الباطنة' },
      actingOrgUnit: null,
      manager: 'Dr. Layla Al-Harbi',
      actingUser: 'Dr. Omar Siddiqui',
    },
    ...overrides,
  });

  // Every users:* and roles:* permission an Organization Administrator holds.
  const ADMIN = [
    'users:view',
    'users:manage',
    'users:invite',
    'users:deactivate',
    'users:reactivate',
    'users:transfer',
    'roles:view',
    'roles:manage',
  ];

  function render(opts: { viewer?: string; permissions?: string[]; arabic?: boolean; recordId?: string } = {}) {
    const permissions = opts.permissions ?? [];
    const arabic = opts.arabic ?? false;
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserRecordComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { paramMap: convertToParamMap({ id: opts.recordId ?? OTHER }) } },
        },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: opts.viewer ?? ME, email: 'me@example.test', name: 'Me' }).asReadonly(),
            getMfaStatus: () => of({ enabled: false }),
          },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        // STUBBED: the real one writes document.dir, which no TestBed resets.
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => arabic,
            isRtl: () => arabic,
            bilingual: (en: string, ar: string | null) => (arabic ? ar || en : en),
            use: () => of(undefined),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(arabic ? 'ar' : 'en');
    const fixture = TestBed.createComponent(UserRecordComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  const flushUser = (
    ctx: ReturnType<typeof render>,
    user: IUserDto,
  ): void => {
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${user.id}`) && r.method === 'GET').flush(user);
    ctx.fixture.detectChanges();
  };

  const actions = (el: HTMLElement): string[] =>
    Array.from(el.querySelectorAll('[data-user-actions] [data-action]')).map((b) => b.getAttribute('data-action')!);

  const urls = (http: HttpTestingController): string[] => http.match(() => true).map((r) => r.request.urlWithParams);

  // ── Test 1 ──────────────────────────────────────────────────────────────
  // Each action against the permission its endpoint enforces: present with it,
  // absent with every OTHER admin permission but that one.
  const CASES: { action: string; permission: string; user: Partial<IUserDto> }[] = [
    { action: 'editProfile', permission: 'users:manage', user: {} },
    { action: 'outOfOffice', permission: 'users:manage', user: {} },
    { action: 'transfer', permission: 'users:transfer', user: {} },
    { action: 'deactivate', permission: 'users:deactivate', user: {} },
    { action: 'reactivate', permission: 'users:reactivate', user: { status: 'INACTIVE' } },
    { action: 'revokeInvitation', permission: 'users:invite', user: { status: 'INVITED' } },
  ];
  for (const c of CASES) {
    it(`1 · ${c.action} needs ${c.permission} on someone else's record`, () => {
      const without = render({ permissions: ADMIN.filter((p) => p !== c.permission) });
      flushUser(without, record(c.user));
      expect(actions(without.el)).not.toContain(c.action);

      const withIt = render({ permissions: ADMIN });
      flushUser(withIt, record(c.user));
      expect(actions(withIt.el)).toContain(c.action);
    });
  }

  // ── ACC-221 — the account owner ─────────────────────────────────────────
  describe('the account owner (ACC-221)', () => {
    it('shows the chip and the owner line on the Roles panel, and offers no Deactivate', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, record({ isAccountOwner: true }));
      // The owner holds Organization Administrator; an empty panel shows its empty state instead.
      ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([
        { id: 'g-admin', role: { id: 'r-admin', key: 'TENANT_ADMIN', nameEn: 'Organization Administrator', nameAr: 'مسؤول المؤسسة', isActive: true }, grantedAt: '2026-10-01T09:00:00.000Z', source: 'DIRECT', grantedViaHeadPositionId: null, grantedViaHeadPositionOrgUnitId: null },
      ]);
      ctx.fixture.detectChanges();

      expect(ctx.el.querySelector('[data-user-account-owner]')!.textContent!.trim()).toBe('Account owner');
      expect(actions(ctx.el)).not.toContain('deactivate');
      expect(ctx.el.querySelector('[data-user-account-owner-line]')!.textContent!.trim()).toBe(
        'This is the account owner. Only AccreditMe support can transfer ownership.',
      );
    });

    it("does not offer Revoke invitation on the owner's pending invitation", () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, record({ isAccountOwner: true, status: 'INVITED' }));
      expect(actions(ctx.el)).not.toContain('revokeInvitation');
    });

    it('an administrator who is not the owner still has every action, and no chip', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, record({ isAccountOwner: false }));
      ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([]);
      ctx.fixture.detectChanges();

      expect(actions(ctx.el)).toContain('deactivate');
      expect(ctx.el.querySelector('[data-user-account-owner]')).toBeNull();
      expect(ctx.el.querySelector('[data-user-account-owner-line]')).toBeNull();

      const invited = render({ permissions: ADMIN });
      flushUser(invited, record({ isAccountOwner: false, status: 'INVITED' }));
      expect(actions(invited.el)).toContain('revokeInvitation');
    });

    it('Arabic: «مالك الحساب»', () => {
      const ctx = render({ permissions: ADMIN, arabic: true });
      flushUser(ctx, record({ isAccountOwner: true }));
      expect(ctx.el.querySelector('[data-user-account-owner]')!.textContent!.trim()).toBe('مالك الحساب');
    });
  });

  it('1 · Manage roles needs roles:manage, on the Roles panel', () => {
    const without = render({ permissions: ADMIN.filter((p) => p !== 'roles:manage') });
    flushUser(without, record());
    without.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([]);
    without.fixture.detectChanges();
    expect(without.el.querySelector('[data-action="manageRoles"]')).toBeNull();

    const withIt = render({ permissions: ADMIN });
    flushUser(withIt, record());
    withIt.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([]);
    withIt.fixture.detectChanges();
    expect(withIt.el.querySelector('[data-action="manageRoles"]')).not.toBeNull();
  });

  // ── Test 2 (D4) ─────────────────────────────────────────────────────────
  it('2 · Deactivate is absent on your OWN record, even for an administrator', () => {
    const own = render({ viewer: ME, recordId: ME, permissions: ADMIN });
    flushUser(own, record({ id: ME }));
    expect(actions(own.el)).not.toContain('deactivate');
    // Everything else an administrator may do to an active user is still there.
    expect(actions(own.el)).toEqual(['editProfile', 'outOfOffice', 'transfer']);
  });

  // ── Test 3 ──────────────────────────────────────────────────────────────
  it('3 · an invited user shows the Invited chip and only Edit profile, Resend and Revoke', () => {
    const ctx = render({ permissions: ADMIN });
    flushUser(ctx, record({ status: 'INVITED' }));
    const chip = ctx.el.querySelector('app-status-chip')!;
    expect(chip.textContent).toContain('Invited');
    expect(chip.querySelector('.font-semibold')).not.toBeNull(); // the attention tier
    // ACC-159 — Resend sits beside Revoke.
    expect(actions(ctx.el)).toEqual(['editProfile', 'resendInvitation', 'revokeInvitation']);
    // Invited: the date they were invited, not "Never signed in".
    expect(ctx.el.querySelector('[data-fact="invited"]')).not.toBeNull();
    expect(ctx.el.querySelector('[data-fact="lastSignIn"]')).toBeNull();
  });

  // ── Test 4, the page's half: who gets the placement fields ──────────────
  it('4 · Edit profile offers placement only with users:manage — never just for being your own record', () => {
    const own = render({ viewer: ME, recordId: ME, permissions: [] });
    flushUser(own, record({ id: ME }));
    const dialog = own.fixture.debugElement.query(By.directive(EditProfileDialogComponent))
      .componentInstance as EditProfileDialogComponent;
    expect(dialog.isOwn()).toBe(true);
    expect(dialog.canEditPlacement()).toBe(false);

    const admin = render({ permissions: ['users:view', 'users:manage'] });
    flushUser(admin, record());
    const adminDialog = admin.fixture.debugElement.query(By.directive(EditProfileDialogComponent))
      .componentInstance as EditProfileDialogComponent;
    expect(adminDialog.canEditPlacement()).toBe(true);
  });

  // ── Test 5 ──────────────────────────────────────────────────────────────
  it('5 · a direct grant shows its date; a head-position grant shows its source and no date', () => {
    const ctx = render({ permissions: ['users:view', 'roles:view'] });
    flushUser(ctx, record());
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([
      {
        id: 'g-direct',
        role: { id: 'r1', nameEn: 'Auditor', nameAr: 'مدقق' },
        grantedAt: '2026-10-03T09:00:00.000Z',
        source: 'DIRECT',
        grantedViaHeadPositionId: null,
        grantedViaHeadPositionOrgUnitId: null,
      },
      {
        id: 'g-head',
        role: { id: 'r2', nameEn: 'Unit Head', nameAr: null },
        grantedAt: '2026-09-01T09:00:00.000Z',
        source: 'HEAD_POSITION_UNIT',
        grantedViaHeadPositionId: 'pos-senior',
        grantedViaHeadPositionOrgUnitId: 'unit-im',
      },
    ]);
    ctx.fixture.detectChanges();

    const derived = ctx.el.querySelector('[data-role-row="derived"]')!;
    const direct = ctx.el.querySelector('[data-role-row="direct"]')!;
    expect(derived.textContent).toContain('Unit Head');
    expect(derived.querySelector('[data-role-detail]')!.textContent).toContain(
      'Comes with the head position Senior Specialist',
    );
    expect(derived.textContent).toContain('Internal Medicine Ward only');
    expect(derived.textContent).not.toContain('Granted');
    expect(direct.querySelector('[data-role-detail]')!.textContent!.trim()).toBe('Granted 3 Oct 2026');
    // The panel reads; it never removes — no control in any row.
    expect(ctx.el.querySelectorAll('[data-role-row] button').length).toBe(0);
    // Position grants first, as Manage roles lists them.
    const order = Array.from(ctx.el.querySelectorAll('[data-role-row]')).map((r) => r.getAttribute('data-role-row'));
    expect(order).toEqual(['derived', 'direct']);
  });

  // ── ACC-272 — "See permissions", a way in to "A user's permissions" ────
  const LOOKUP = ['admin:access', 'roles:view', 'users:view'];
  for (const missing of LOOKUP) {
    it(`ACC-272 · "See permissions" is absent without ${missing}`, () => {
      const ctx = render({ permissions: LOOKUP.filter((p) => p !== missing) });
      flushUser(ctx, record());
      ctx.http.match((r) => r.url.endsWith(`/users/${OTHER}/roles`)).forEach((r) => r.flush([]));
      ctx.fixture.detectChanges();
      expect(ctx.el.querySelector('[data-action="seePermissions"]')).toBeNull();
    });
  }

  it("ACC-272 · 'See permissions' opens 'A user's permissions' with this person chosen", () => {
    const ctx = render({ permissions: LOOKUP });
    flushUser(ctx, record());
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([]);
    ctx.fixture.detectChanges();
    const link = ctx.el.querySelector<HTMLAnchorElement>('[data-panel="roles"] [data-action="seePermissions"]')!;
    expect(link.textContent!.trim()).toBe('See permissions');
    expect(link.getAttribute('href')).toBe(`/roles/user-permissions/${OTHER}`);
  });

  it('ACC-272 · the Roles panel lists an inactive role last, after direct grants', () => {
    const ctx = render({ permissions: ['users:view', 'roles:view'] });
    flushUser(ctx, record());
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/roles`)).flush([
      { id: 'g-old', role: { id: 'r0', nameEn: 'Old Role', nameAr: null, isActive: false }, grantedAt: '2026-01-01T09:00:00.000Z', source: 'DIRECT', grantedViaHeadPositionId: null, grantedViaHeadPositionOrgUnitId: null },
      { id: 'g-direct', role: { id: 'r1', nameEn: 'Auditor', nameAr: null, isActive: true }, grantedAt: '2026-10-03T09:00:00.000Z', source: 'DIRECT', grantedViaHeadPositionId: null, grantedViaHeadPositionOrgUnitId: null },
      { id: 'g-head', role: { id: 'r2', nameEn: 'Unit Head', nameAr: null, isActive: true }, grantedAt: '2026-09-01T09:00:00.000Z', source: 'HEAD_POSITION_UNIT', grantedViaHeadPositionId: 'pos-senior', grantedViaHeadPositionOrgUnitId: 'unit-im' },
    ]);
    ctx.fixture.detectChanges();
    const names = Array.from(ctx.el.querySelectorAll('[data-role-row] .font-medium')).map((e) => e.textContent!.trim());
    expect(names).toEqual(['Unit Head', 'Auditor', 'Old Role']);
  });

  // ── Test 6 ──────────────────────────────────────────────────────────────
  it('6 · without roles:view the Roles panel is absent and makes no request', () => {
    const ctx = render({ permissions: ['users:view'] });
    flushUser(ctx, record());
    expect(ctx.el.querySelector('[data-panel="roles"]')).toBeNull();
    expect(urls(ctx.http).some((u) => u.includes('/roles'))).toBe(false);
  });

  // ── Test 7 ──────────────────────────────────────────────────────────────
  it("7 · a panel's error stays in that panel; Retry asks again", () => {
    const ctx = render({ viewer: ME, recordId: ME, permissions: ['roles:view'] });
    flushUser(ctx, record({ id: ME }));
    ctx.http
      .expectOne((r) => r.url.endsWith(`/users/${ME}/roles`))
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    ctx.fixture.detectChanges();

    const roles = ctx.el.querySelector('[data-panel="roles"]')!;
    expect(roles.querySelector('[data-panel-error]')).not.toBeNull();
    // The rest of the page is untouched.
    expect(ctx.el.querySelector('h1')!.textContent).toContain('Dr. Yasser Al-Amri');
    expect(ctx.el.querySelector('[data-user-facts]')).not.toBeNull();
    expect(ctx.el.querySelector('[data-panel="twoStep"] [data-two-step-status]')).not.toBeNull();
    expect(ctx.el.querySelector('[data-user-load-error]')).toBeNull();

    (roles.querySelector('[data-panel-error] button') as HTMLButtonElement).click();
    ctx.fixture.detectChanges();
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${ME}/roles`)).flush([]);
    ctx.fixture.detectChanges();
    expect(roles.querySelector('[data-panel-error]')).toBeNull();
  });

  // ── Test 9 ──────────────────────────────────────────────────────────────
  it('9 · the two-step sign-in panel only on your own record', () => {
    const other = render({ permissions: ADMIN });
    flushUser(other, record());
    expect(other.el.querySelector('[data-panel="twoStep"]')).toBeNull();

    const own = render({ viewer: ME, recordId: ME });
    flushUser(own, record({ id: ME }));
    const panel = own.el.querySelector('[data-panel="twoStep"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Off. Signing in needs only your password.');
    expect(panel.querySelector('[data-action="twoStepSetUp"]')).not.toBeNull();
  });

  // ACC-164 — someone else's two-step sign-in, drawn only from the server's
  // `twoStep` (rule 4: only to people allowed to reset it).
  describe("someone else's two-step sign-in (ACC-164)", () => {
    const RESETTER = [...ADMIN, 'users:reset_mfa'];
    const panelOf = (el: HTMLElement) => el.querySelector('[data-panel="twoStepOther"]');

    it('is drawn, with Reset, when the server says it is on and may be reset', () => {
      const ctx = render({ permissions: RESETTER });
      flushUser(ctx, record({ twoStep: { enabled: true, mayReset: true } }));
      const panel = panelOf(ctx.el)!;
      expect(panel.textContent).toContain('On. A code from an authenticator app is asked for at every sign-in.');
      expect(panel.querySelector('[data-action="twoStepReset"]')?.textContent?.trim()).toBe('Reset');
      expect(ctx.el.querySelector('[data-panel="twoStep"]')).toBeNull();
    });

    it('reads "Off." with no action when it is off', () => {
      const ctx = render({ permissions: RESETTER });
      flushUser(ctx, record({ twoStep: { enabled: false, mayReset: false } }));
      const panel = panelOf(ctx.el)!;
      expect(panel.querySelector('[data-two-step-status]')?.textContent?.trim()).toBe('Off.');
      expect(panel.querySelector('[data-action]')).toBeNull();
    });

    it('hides Reset while signed in as someone else (mayReset false), keeping the status', () => {
      const ctx = render({ permissions: RESETTER });
      flushUser(ctx, record({ twoStep: { enabled: true, mayReset: false } }));
      const panel = panelOf(ctx.el)!;
      expect(panel.textContent).toContain('On.');
      expect(panel.querySelector('[data-action="twoStepReset"]')).toBeNull();
    });

    it('draws no panel at all — never "Off" — when the server sends none', () => {
      for (const twoStep of [null, undefined]) {
        const ctx = render({ permissions: RESETTER });
        flushUser(ctx, record({ twoStep }));
        expect(panelOf(ctx.el)).toBeNull();
      }
    });

    it('Reset opens the confirm naming the person', () => {
      const ctx = render({ permissions: RESETTER });
      flushUser(ctx, record({ twoStep: { enabled: true, mayReset: true } }));
      (ctx.el.querySelector('[data-action="twoStepReset"]') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
      ctx.fixture.detectChanges();
      expect(document.querySelector('.p-dialog')?.textContent).toContain(
        'Reset two-step sign-in for ⁨Dr. Yasser Al-Amri⁩?',
      );
      ctx.fixture.destroy();
    });

    it('Arabic: «إعادة ضبط» and «غير مفعّل.»', () => {
      const on = render({ permissions: RESETTER, arabic: true });
      flushUser(on, record({ twoStep: { enabled: true, mayReset: true } }));
      expect(on.el.querySelector('[data-action="twoStepReset"]')?.textContent?.trim()).toBe('إعادة ضبط');
      const off = render({ permissions: RESETTER, arabic: true });
      flushUser(off, record({ twoStep: { enabled: false, mayReset: false } }));
      expect(panelOf(off.el)?.querySelector('[data-two-step-status]')?.textContent?.trim()).toBe('غير مفعّل.');
    });
  });

  it('9 · the status request is never made on someone else\'s record', () => {
    TestBed.resetTestingModule();
    const getMfaStatus = jasmine.createSpy('getMfaStatus').and.returnValue(of({ enabled: false }));
    const ctx = renderWithAuthSpy(getMfaStatus, OTHER);
    expect(getMfaStatus).not.toHaveBeenCalled();
    ctx.destroy();
    const own = renderWithAuthSpy(getMfaStatus, ME);
    expect(getMfaStatus).toHaveBeenCalledTimes(1);
    own.destroy();
  });

  function renderWithAuthSpy(getMfaStatus: jasmine.Spy, recordId: string) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserRecordComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: recordId }) } } },
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: ME, email: 'me@example.test', name: 'Me' }).asReadonly(), getMfaStatus },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: () => false } },
        {
          provide: LanguageService,
          useValue: { isArabic: () => false, isRtl: () => false, bilingual: (e: string) => e, use: () => of(undefined) },
        },
      ],
    });
    const fixture = TestBed.createComponent(UserRecordComponent);
    fixture.detectChanges();
    return fixture;
  }

  // ── Test 14 (D1) ────────────────────────────────────────────────────────
  // ACC-216: Committees is absent here because ADMIN holds no committees:view
  // (test 16 covers it with the key). Tasks (test 20), Access history (test 18) and Signed-in devices (test 19) are present, each on its own frame.
  it('14 · without committees:view, Committees is absent — not empty, not disabled', () => {
    const ctx = render({ viewer: ME, recordId: ME, permissions: ADMIN });
    flushUser(ctx, record({ id: ME }));
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${ME}/roles`)).flush([]);
    ctx.fixture.detectChanges();

    const panels = Array.from(ctx.el.querySelectorAll('app-record-panel')).map((p) => p.getAttribute('data-panel'));
    expect(panels).toEqual(['roles', 'twoStep']);
    const text = ctx.el.textContent!;
    for (const absent of ['Committees']) {
      expect(text).not.toContain(absent);
    }
  });

  // ── Test 18 (ACC-216 part 2) ────────────────────────────────────────────
  // Yourself, or users:view: the endpoint's own rule. Otherwise ABSENT and never
  // asked, not an empty panel.
  it('18 · ACC-216 · Access history: present for yourself and with users:view, absent and never requested otherwise', () => {
    const accessRequests = (ctx: ReturnType<typeof render>) => urls(ctx.http).filter((u) => u.includes('/access-history'));

    const neither = render({ viewer: ME, recordId: OTHER, permissions: ['roles:view'] });
    flushUser(neither, record());
    expect(neither.el.querySelector('app-user-access-history-panel')).toBeNull();
    expect(accessRequests(neither)).toEqual([]);

    const own = render({ viewer: ME, recordId: ME, permissions: [] });
    flushUser(own, record({ id: ME }));
    expect(own.el.querySelector('app-user-access-history-panel')).not.toBeNull();
    // match() consumes what it returns: read it once.
    const ownRequests = accessRequests(own);
    expect(ownRequests.length).toBe(1);
    expect(ownRequests[0]).toContain(`/users/${ME}/access-history?skip=0&take=5`);

    const admin = render({ viewer: ME, recordId: OTHER, permissions: ['users:view'] });
    flushUser(admin, record());
    admin.http
      .expectOne((r) => r.url.endsWith(`/users/${OTHER}/access-history`))
      .flush({ rows: [{ id: 'audit:1', at: '2026-11-10T08:00:00.000Z', kind: 'DEACTIVATED', actor: null }], total: 1, skip: 0, take: 5 });
    admin.fixture.detectChanges();
    const panel = admin.el.querySelector('[data-testid="access-history-panel"]')!;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Access history');
    expect(panel.textContent).toContain('Account deactivated');
  });

  // ── Test 19 (ACC-216 Sessions) ──────────────────────────────────────────
  // Yourself ('own'), or users:view + users:manage_sessions ('admin'): the
  // endpoint's own rule. Anyone else gets NO panel and NO request.
  it('19 · ACC-216 · Signed-in devices: yours, or with users:view + users:manage_sessions; absent and never requested otherwise', () => {
    const sessionRequests = (ctx: ReturnType<typeof render>) => urls(ctx.http).filter((u) => u.includes('/sessions'));
    const modeOf = (ctx: ReturnType<typeof render>) => {
      const host = ctx.fixture.debugElement.query((d) => d.componentInstance instanceof UserSessionsPanelComponent);
      return host ? (host.componentInstance as UserSessionsPanelComponent).mode() : null;
    };

    for (const permissions of [[], ['users:view'], ['users:manage_sessions'], ADMIN]) {
      const ctx = render({ viewer: ME, recordId: OTHER, permissions });
      flushUser(ctx, record());
      expect({ permissions, panel: ctx.el.querySelector('app-user-sessions-panel') }).toEqual({ permissions, panel: null });
      expect(sessionRequests(ctx)).toEqual([]);
    }

    const own = render({ viewer: ME, recordId: ME, permissions: [] });
    flushUser(own, record({ id: ME }));
    expect(modeOf(own)).toBe('own');
    const ownRequests = sessionRequests(own);
    expect(ownRequests.length).toBe(1);
    expect(ownRequests[0]).toContain(`/users/${ME}/sessions`);

    const admin = render({ viewer: ME, recordId: OTHER, permissions: ['users:view', 'users:manage_sessions'] });
    flushUser(admin, record());
    expect(modeOf(admin)).toBe('admin');
    admin.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/sessions`)).flush({ total: 0, rows: [] });
    admin.fixture.detectChanges();
    expect(admin.el.querySelector('[data-testid="sessions-panel"]')!.textContent).toContain('Signed-in devices');
  });

  // ── Test 20 (ACC-216 PR 5) ──────────────────────────────────────────────
  // A person's Tasks: yourself, or users:view, the endpoint's own gate. Anyone
  // else gets NO panel and NO request.
  it('20 · ACC-216 · Tasks: yours, or with users:view; absent and never requested otherwise', () => {
    const taskReads = (ctx: ReturnType<typeof render>) => urls(ctx.http).filter((u) => u.includes('/tasks/record-panel'));

    for (const permissions of [[], ['committees:view'], ['users:manage_sessions']]) {
      const ctx = render({ viewer: ME, recordId: OTHER, permissions });
      flushUser(ctx, record());
      expect({ permissions, panel: ctx.el.querySelector('app-record-tasks-panel') }).toEqual({ permissions, panel: null });
      expect(taskReads(ctx)).toEqual([]);
    }

    const own = render({ viewer: ME, recordId: ME, permissions: [] });
    flushUser(own, record({ id: ME }));
    expect(own.el.querySelector('app-record-tasks-panel')).not.toBeNull();
    expect(taskReads(own)).toEqual([jasmine.stringContaining(`/tasks/record-panel?person=${ME}`)]);

    const viewer = render({ viewer: ME, recordId: OTHER, permissions: ['users:view'] });
    flushUser(viewer, record());
    viewer.http.expectOne((r) => r.url.endsWith('/tasks/record-panel') && r.params.get('person') === OTHER).flush({ total: 0, scope: 'all', rows: [] });
    viewer.fixture.detectChanges();
    expect(viewer.el.querySelector('[data-panel="tasks"] h2')!.textContent!.trim()).toBe('Tasks');
  });

  // ── Test 16 (ACC-216) ───────────────────────────────────────────────────
  it('16 · ACC-216 · the Committees panel: present with committees:view, absent and never requested without it', () => {
    const without = render({ viewer: ME, recordId: OTHER, permissions: ['users:view'] });
    flushUser(without, record());
    expect(without.el.querySelector('app-user-committees-panel')).toBeNull();
    expect(without.el.querySelector('[data-panel="committees"]')).toBeNull();
    expect(urls(without.http).filter((u) => u.includes('/committees'))).toEqual([]);

    const withKey = render({ viewer: ME, recordId: OTHER, permissions: ['users:view', 'committees:view'] });
    flushUser(withKey, record());
    const req = withKey.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/committees`) && r.method === 'GET');
    req.flush({
      total: 1,
      rows: [
        {
          committee: { id: 'c1', nameEn: 'Quality Committee', nameAr: 'لجنة الجودة' },
          seat: { id: 's1', labelEn: 'Member', labelAr: 'عضو', layer: 'SYSTEM' },
          joinedAt: '2026-03-01T00:00:00.000Z',
          leftAt: null,
          current: true,
        },
      ],
    });
    withKey.fixture.detectChanges();
    const panel = withKey.el.querySelector('[data-panel="committees"]')!;
    expect(panel).not.toBeNull();
    expect(panel.querySelector('[data-committee-link]')!.textContent!.trim()).toBe('Quality Committee');
  });

  // ── Test 17 (CC-276) ────────────────────────────────────────────────────
  // The retired #718096 (4.02:1 on white) stays out of THIS template: meta text
  // is ink-500. Read from the compiled definition's static attributes, which
  // hold this page's own class strings and none of the shared record-panel
  // frame's (retired separately). The ink-500 guard runs first.
  it('17 · its template uses no retired --am-text-secondary', () => {
    const def = (UserRecordComponent as unknown as { ɵcmp: { consts: unknown } }).ɵcmp;
    const template = JSON.stringify(typeof def.consts === 'function' ? (def.consts as () => unknown)() : def.consts);
    expect(template).withContext('the template classes were read').toContain('--am-ink-500');
    expect(template).not.toContain('--am-text-secondary');
  });

  // ── Test 15 ─────────────────────────────────────────────────────────────
  it('15 · Arabic: the facts and headings are translated, names in Arabic, the email isolated LTR', () => {
    const ctx = render({ viewer: ME, recordId: ME, permissions: ['roles:view'], arabic: true });
    flushUser(ctx, record({ id: ME }));
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${ME}/roles`)).flush([
      {
        id: 'g1',
        role: { id: 'r1', nameEn: 'Auditor', nameAr: 'مدقق' },
        grantedAt: '2026-10-03T09:00:00.000Z',
        source: 'DIRECT',
        grantedViaHeadPositionId: null,
        grantedViaHeadPositionOrgUnitId: null,
      },
      {
        id: 'g2',
        role: { id: 'r2', nameEn: 'Records Officer', nameAr: null },
        grantedAt: '2026-10-03T09:00:00.000Z',
        source: 'DIRECT',
        grantedViaHeadPositionId: null,
        grantedViaHeadPositionOrgUnitId: null,
      },
    ]);
    ctx.fixture.detectChanges();
    // ACC-160 — Arabic where there is one, English where there is not, never blank.
    const roleNames = Array.from(ctx.el.querySelectorAll('[data-role-row] .font-medium')).map((n) => n.textContent!.trim());
    expect(roleNames).toEqual(['مدقق', 'Records Officer']);

    const facts = ctx.el.querySelector('[data-user-facts]')!.textContent!;
    expect(facts).toContain('المسمى الوظيفي');
    expect(facts).toContain('المدير المباشر');
    expect(facts).toContain('أخصائي أول');
    expect(facts).toContain('جناح الباطنة');
    expect(facts).toContain('لا يوجد تسجيل دخول بعد');
    expect(ctx.el.querySelector('[data-panel="roles"]')!.textContent).toContain('الأدوار');
    expect(ctx.el.querySelector('[data-panel="twoStep"]')!.textContent).toContain('التحقق بخطوتين');

    const email = ctx.el.querySelector('[data-user-email]') as HTMLElement;
    expect(email.getAttribute('dir')).toBe('ltr');
    expect(getComputedStyle(email).unicodeBidi).toBe('isolate');
  });

  it("shows the identity card's shape while the record loads, and the record once it arrives", () => {
    const ctx = render({ viewer: ME, recordId: ME });
    expect(ctx.el.querySelector('[data-user-loading]')).not.toBeNull();
    expect(ctx.el.querySelector('[data-user-identity]')).toBeNull();
    flushUser(ctx, record({ id: ME }));
    expect(ctx.el.querySelector('[data-user-loading]')).toBeNull();
    expect(ctx.el.querySelector('[data-user-identity]')).not.toBeNull();
  });

  it('a failed load shows the error, not an endless skeleton', () => {
    const ctx = render({ viewer: ME, recordId: ME });
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush({}, { status: 500, statusText: 'Server Error' });
    ctx.fixture.detectChanges();
    expect(ctx.el.querySelector('[data-user-load-error]')).not.toBeNull();
    expect(ctx.el.querySelector('[data-user-loading]')).toBeNull();
  });

  // ── Kept from the old profile spec (ACC-79) ─────────────────────────────
  it('requests none of the lists it has no permission to read', () => {
    const ctx = render({ viewer: ME, recordId: ME });
    const requested = urls(ctx.http);
    expect(requested.some((u) => u.includes('/org-positions'))).toBe(false);
    expect(requested.some((u) => u.includes('/units/flat'))).toBe(false);
    expect(requested.some((u) => /\/users\?/.test(u))).toBe(false);
    expect(requested.some((u) => u.endsWith(`/users/${ME}`))).toBe(true);
  });

  it('names the current cover person even without the colleague list', () => {
    const ctx = render({ viewer: ME, recordId: ME });
    flushUser(ctx, record({ id: ME }));
    expect(ctx.fixture.componentInstance.coverOptions()).toEqual([
      { id: 'cover-1', name: 'Dr. Omar Siddiqui', unit: '' },
    ]);
  });

  it('shows out of office in the facts, with the cover person', () => {
    const ctx = render({ permissions: ['users:view'] });
    flushUser(ctx, record({ outOfOfficeFrom: '2026-10-20T00:00:00.000Z', outOfOfficeTo: '2026-10-24T00:00:00.000Z' }));
    const fact = ctx.el.querySelector('[data-fact="outOfOffice"]')!.textContent!;
    expect(fact).toContain('20 Oct 2026');
    expect(fact).toContain('24 Oct 2026');
    expect(fact).toContain('Covered by Dr. Omar Siddiqui');
  });

  // ── ACC-159 — Resend invitation, and when the link stops working ─────────
  describe('Resend invitation and the expiry line (ACC-159)', () => {
    const NOW = new Date('2026-11-21T09:00:00.000Z');
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(NOW);
    });
    afterEach(() => jasmine.clock().uninstall());

    const invited = (overrides: Partial<IUserDto> = {}): IUserDto =>
      record({ status: 'INVITED', invitationExpiresAt: '2026-11-23T09:00:00.000Z', ...overrides });

    const press = (ctx: ReturnType<typeof render>): void => {
      (ctx.el.querySelector('[data-action="resendInvitation"] button') as HTMLButtonElement).click();
      ctx.fixture.detectChanges();
    };
    const resendCall = (ctx: ReturnType<typeof render>) =>
      ctx.http.expectOne((r) => r.url.endsWith(`/users/${OTHER}/resend-invitation`) && r.method === 'POST');
    const errorText = (ctx: ReturnType<typeof render>): string =>
      ctx.el.querySelector('[data-user-action-error]')?.textContent?.trim() ?? '';

    it('is offered beside Revoke for an invited person, to a users:invite holder only', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited());
      expect(actions(ctx.el)).toEqual(['editProfile', 'resendInvitation', 'revokeInvitation']);

      const without = render({ permissions: ADMIN.filter((p) => p !== 'users:invite') });
      flushUser(without, invited());
      expect(actions(without.el)).not.toContain('resendInvitation');

      for (const status of ['ACTIVE', 'INACTIVE', 'SUSPENDED']) {
        const other = render({ permissions: ADMIN });
        flushUser(other, record({ status }));
        expect(actions(other.el)).withContext(status).not.toContain('resendInvitation');
      }
    });

    it("is offered on the account owner's pending invitation, where Revoke is not", () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited({ isAccountOwner: true }));
      expect(actions(ctx.el)).toContain('resendInvitation');
      expect(actions(ctx.el)).not.toContain('revokeInvitation');
    });

    it('calls the endpoint once, names the person, and reads the record again', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited({ invitationExpiresAt: '2026-11-18T09:00:00.000Z' }));
      press(ctx);
      // A second press while the first is in flight sends nothing more.
      press(ctx);
      const calls = ctx.http.match((r) => r.url.endsWith(`/users/${OTHER}/resend-invitation`) && r.method === 'POST');
      expect(calls.length).withContext('one press, one request').toBe(1);
      calls[0]!.flush({ invitationExpiresAt: '2026-11-23T09:00:00.000Z' });
      ctx.fixture.detectChanges();

      expect(ctx.el.querySelector('[data-user-action-message]')!.textContent!.trim()).toBe(
        'Invitation sent again to Dr. Yasser Al-Amri.',
      );
      flushUser(ctx, invited());
      expect(ctx.el.querySelector('[data-fact="invitationExpiry"]')!.textContent).toContain('Expires in 2 days');
    });

    const REFUSALS: { code: string; body?: Record<string, unknown>; text: string }[] = [
      {
        code: 'INVITATION_NOT_PENDING',
        body: { userStatus: 'ACTIVE' },
        text: 'Dr. Yasser Al-Amri no longer has a pending invitation. Status now: Active.',
      },
      {
        code: 'SEAT_LIMIT_REACHED',
        text: "Every seat on your organisation's plan is in use. A seat frees up when an invitation expires or someone is deactivated.",
      },
      { code: 'POSITION_INACTIVE', text: "This position is inactive, so it can't be given to anyone." },
      { code: 'POSITION_ALREADY_HELD', text: 'Someone else already holds this position in this unit.' },
      { code: 'UNIT_ALREADY_HAS_HEAD', text: 'This unit already has a head.' },
    ];
    for (const r of REFUSALS) {
      it(`says ${r.code} in words, never the server's English`, () => {
        const ctx = render({ permissions: ADMIN });
        flushUser(ctx, invited());
        press(ctx);
        resendCall(ctx).flush(
          { statusCode: 409, message: 'SERVER ENGLISH', error: 'Conflict', code: r.code, ...r.body },
          { status: 409, statusText: 'Conflict' },
        );
        ctx.fixture.detectChanges();
        expect(errorText(ctx)).toBe(r.text);
        expect(errorText(ctx)).not.toContain('SERVER ENGLISH');
      });
    }

    it('says a refusal with no code in its own words, and the button stays enabled', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited());
      press(ctx);
      resendCall(ctx).flush({ statusCode: 500, message: 'SERVER ENGLISH' }, { status: 500, statusText: 'Error' });
      ctx.fixture.detectChanges();
      expect(errorText(ctx)).toBe("The invitation couldn't be sent again. Try again.");
      const button = ctx.el.querySelector('[data-action="resendInvitation"] button') as HTMLButtonElement;
      expect(button.disabled).toBeFalse();
      // A press after a refusal is a new request.
      press(ctx);
      resendCall(ctx);
    });

    it('shows when an open invitation stops working, relative, with the full date-time under it', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited());
      const fact = ctx.el.querySelector('[data-fact="invitationExpiry"]')!;
      expect(fact.querySelector('dt')!.textContent!.trim()).toBe('Invitation');
      expect(fact.querySelector('dd')!.textContent!.trim()).toBe('Expires in 2 days');
      expect(fact.querySelector('[data-fact-detail]')!.textContent!.trim()).toBe(
        TestBed.inject(FormatService).dateTime('2026-11-23T09:00:00.000Z'),
      );
    });

    it('says an expired invitation has expired', () => {
      const ctx = render({ permissions: ADMIN });
      flushUser(ctx, invited({ invitationExpiresAt: '2026-11-18T09:00:00.000Z' }));
      expect(ctx.el.querySelector('[data-fact="invitationExpiry"] dd')!.textContent!.trim()).toBe('Expired 3 days ago');
    });

    it('shows nothing for someone not invited, or with no expiry sent', () => {
      const active = render({ permissions: ADMIN });
      flushUser(active, record({ invitationExpiresAt: '2026-11-23T09:00:00.000Z' }));
      expect(active.el.querySelector('[data-fact="invitationExpiry"]')).toBeNull();

      const none = render({ permissions: ADMIN });
      flushUser(none, record({ status: 'INVITED' }));
      expect(none.el.querySelector('[data-fact="invitationExpiry"]')).toBeNull();
    });

    it('Arabic: «إعادة إرسال الدعوة», «تنتهي خلال يومين» and «انتهت»', () => {
      const ctx = render({ permissions: ADMIN, arabic: true });
      flushUser(ctx, invited());
      expect(ctx.el.querySelector('[data-action="resendInvitation"]')!.textContent!.trim()).toBe('إعادة إرسال الدعوة');
      expect(ctx.el.querySelector('[data-fact="invitationExpiry"] dt')!.textContent!.trim()).toBe('الدعوة');
      expect(ctx.el.querySelector('[data-fact="invitationExpiry"] dd')!.textContent!.trim()).toBe('تنتهي خلال يومين');

      const expired = render({ permissions: ADMIN, arabic: true });
      flushUser(expired, invited({ invitationExpiresAt: '2026-11-18T09:00:00.000Z' }));
      expect(expired.el.querySelector('[data-fact="invitationExpiry"] dd')!.textContent!.trim()).toMatch(/^انتهت قبل/);
    });
  });
});
