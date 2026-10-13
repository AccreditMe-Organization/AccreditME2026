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
import { IUserDto } from '../../services/user.service';

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
  it('3 · an invited user shows the Invited chip and only Edit profile and Revoke', () => {
    const ctx = render({ permissions: ADMIN });
    flushUser(ctx, record({ status: 'INVITED' }));
    const chip = ctx.el.querySelector('app-status-chip')!;
    expect(chip.textContent).toContain('Invited');
    expect(chip.querySelector('.font-semibold')).not.toBeNull(); // the attention tier
    expect(actions(ctx.el)).toEqual(['editProfile', 'revokeInvitation']);
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
  it('14 · Committees, Tasks, Sessions and Access history are absent — not empty, not disabled', () => {
    const ctx = render({ viewer: ME, recordId: ME, permissions: ADMIN });
    flushUser(ctx, record({ id: ME }));
    ctx.http.expectOne((r) => r.url.endsWith(`/users/${ME}/roles`)).flush([]);
    ctx.fixture.detectChanges();

    const panels = Array.from(ctx.el.querySelectorAll('app-record-panel')).map((p) => p.getAttribute('data-panel'));
    expect(panels).toEqual(['roles', 'twoStep']);
    const text = ctx.el.textContent!;
    for (const absent of ['Committees', 'Sessions', 'Access history', 'Tasks']) {
      expect(text).not.toContain(absent);
    }
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
    expect(email.style.unicodeBidi).toBe('isolate');
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
});
