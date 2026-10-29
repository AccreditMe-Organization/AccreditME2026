import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, ParamMap, Router, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { BehaviorSubject, Observable, Subject, of, throwError } from 'rxjs';
import { UserPermissionsComponent } from './user-permissions.component';
import { PermissionDto, RoleService, UserPermissionGrantDto } from '../../services/role.service';
import { IUserDto, UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { grant, layla, noActiveGrants, nouraGrants, person, rootGrants } from '../../permission-matrix/user-permissions.fixtures';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';

// ACC-272 — "A user's permissions" (design section B), every state in English
// and Arabic, with real translations: assertions read what a person reads.

type Matrix = { roles: { matrix: { sentence: Record<string, string>; module: Record<string, { name: string }> } } };
const SENTENCES = (en as Matrix).roles.matrix.sentence;
const ALL_SHOWN = Object.keys(SENTENCES).filter((k) => !k.startsWith('platform:'));
const perm = (key: string, inUse = true): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse, rootRoleOnly: key === 'workflows:manage' };
};
const CATALOGUE: PermissionDto[] = [...Object.keys(SENTENCES).map((k) => perm(k)), perm('documents:view', false)];
const moduleName = (lang: 'en' | 'ar', m: string) => ((lang === 'en' ? en : ar) as Matrix).roles.matrix.module[m]!.name;

interface Setup {
  userId?: string | null;
  lang?: 'en' | 'ar';
  user?: IUserDto;
  grants?: UserPermissionGrantDto[];
  getById?: () => Observable<IUserDto>;
  getUserPermissions?: () => Observable<UserPermissionGrantDto[]>;
  people?: IUserDto[];
}

describe("UserPermissionsComponent (ACC-272, A user's permissions)", () => {
  preserveDocumentLanguage();

  let fixture: ComponentFixture<UserPermissionsComponent>;
  let component: UserPermissionsComponent;
  let params: BehaviorSubject<ParamMap>;
  let getById: jasmine.Spy;
  let getUserPermissions: jasmine.Spy;
  let listAllPermissions: jasmine.Spy;
  let navigate: jasmine.Spy;

  function render(s: Setup = {}): void {
    TestBed.resetTestingModule();
    const id = s.userId === undefined ? 'user-noura' : s.userId;
    params = new BehaviorSubject(convertToParamMap(id ? { userId: id } : {}));
    getById = jasmine.createSpy('getById').and.callFake(s.getById ?? (() => of(s.user ?? person())));
    getUserPermissions = jasmine.createSpy('getUserPermissions').and.callFake(s.getUserPermissions ?? (() => of(s.grants ?? nouraGrants())));
    listAllPermissions = jasmine.createSpy('listAllPermissions').and.returnValue(of(CATALOGUE));
    TestBed.configureTestingModule({
      imports: [UserPermissionsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: RoleService, useValue: { getUserPermissions, listAllPermissions } },
        {
          provide: UserService,
          useValue: { getById, listAllUsers: () => of(s.people ?? [person(), layla(), person({ id: 'user-old', name: 'Omar Old', email: 'o@x.example', status: 'INACTIVE' })]) },
        },
        { provide: OrgUnitService, useValue: { getFlat: () => of([{ id: 'unit-qd', nameEn: 'Quality Department', nameAr: 'إدارة الجودة' }]) } },
        { provide: OrgPositionService, useValue: { listPositions: () => of([{ id: 'pos-qd', nameEn: 'Quality Director', nameAr: 'مدير الجودة' }]) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true, isPlatformOrg: () => false } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(s.lang ?? 'en');
    TestBed.inject(LanguageService).use(s.lang ?? 'en');
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(UserPermissionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove()));

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const q = (sel: string, root: ParentNode = host()): HTMLElement | null => root.querySelector<HTMLElement>(sel);
  const all = (sel: string, root: ParentNode = host()): HTMLElement[] => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  /** Isolates are invisible: strip them where a test reads prose. */
  const plain = (s: string): string => s.replace(/[⁦-⁩]/g, '');
  const t = (sel: string, root?: ParentNode) => plain(text(q(sel, root)));
  const rowsOf = (m: string) => all('[data-up-row]', q(`[data-up-module="${m}"]`)!).map((r) => r.getAttribute('data-up-row'));
  const find = (value: string) => {
    const input = q('[data-up-find]') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

  // ── Before a choice ─────────────────────────────────────────────────────────

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: before a choice, the picker and the intro, and nothing read`, () => {
      render({ userId: null, lang });
      expect(t('[data-up-intro]')).toBe(
        lang === 'en'
          ? 'Choose a user to see what they can do and which role gives each permission.'
          : 'اختر مستخدمًا لترى ما يستطيع فعله والدور الذي يمنحه كل صلاحية.',
      );
      expect((q('[data-up-find-user]') as HTMLInputElement).placeholder).toBe(
        lang === 'en' ? 'Find a user by name or email' : 'ابحث عن مستخدم بالاسم أو البريد',
      );
      expect(q('[data-up-card]')).toBeNull();
      expect(getUserPermissions).not.toHaveBeenCalled();
    });
  }

  // ── The example ─────────────────────────────────────────────────────────────

  it('en: the card, the summary and the picker showing the person', () => {
    render();
    expect(t('[data-up-name]')).toBe('Noura Al-Mutairi');
    expect(t('[data-up-meta]')).toBe('Quality Department · Quality Director');
    expect(t('[data-up-status]')).toBe('Active');
    expect(t('[data-up-summary]')).toBe('16 permissions through 3 active roles');
    expect(q('[data-up-open-record]')!.getAttribute('href')).toBe('/users/user-noura');
    expect(t('[data-up-open-record]')).toBe('Open user record');
    expect((q('[data-up-find-user]') as HTMLInputElement).value).toBe('Noura Al-Mutairi · Quality Department · Quality Director');
    expect(q('[data-up-deactivated]')).toBeNull();
    // One read each, once.
    expect(getById).toHaveBeenCalledOnceWith('user-noura');
    expect(getUserPermissions).toHaveBeenCalledOnceWith('user-noura');
  });

  it('en: roles head positions first, then direct, then inactive, each with its source and what it gives', () => {
    render();
    const rows = all('[data-up-role]');
    expect(rows.map((r) => t('[data-up-role-link]', r))).toEqual(['Unit Head', 'Patient Safety Reviewer', 'Quality Editor', 'Committee Secretary']);
    expect(rows.map((r) => t('[data-up-source]', r))).toEqual([
      'Comes with the head position Quality Director · Quality Department',
      // An acting headship: the server names the unit's head position and the unit.
      'Comes with the head position Patient Safety Lead · Patient Safety Unit',
      'Granted directly · 3 Oct 2026',
      'Granted directly · 12 Aug 2026',
    ]);
    expect(rows.map((r) => t('[data-up-gives]', r))).toEqual([
      'Gives 6 permissions',
      'Gives 3 permissions',
      'Gives 14 permissions',
      'Gives no permissions while inactive',
    ]);
    // Each role links to its own permissions page; the inactive one is muted and chipped.
    expect(q('[data-up-role-link]', rows[2]!)!.getAttribute('href')).toBe('/roles/role-quality-editor/permissions');
    expect(rows[3]!.getAttribute('data-up-active')).toBe('false');
    expect(rows[3]!.classList).toContain('up-role--off');
    expect(t('[data-up-inactive]', rows[3]!)).toBe('Inactive');
    expect(q('[data-up-inactive]', rows[0]!)).toBeNull();
    expect(q('[data-up-system]')).toBeNull();
  });

  it("en: an acting head's line names the head position and the unit, though neither is the person's own", () => {
    // The person's own position and units are elsewhere: only the server's names can say these.
    const acting = grant({
      name: 'Ward Head',
      source: 'HEAD_POSITION_UNIT',
      positionId: 'pos-ward-head',
      unitId: 'unit-ward-7',
      headPosition: { nameEn: 'Ward Manager', nameAr: 'مدير الجناح' },
      headUnit: { nameEn: 'Ward 7', nameAr: 'الجناح 7' },
      permissions: ['org:view'],
    });
    render({ grants: [acting] });
    expect(t('[data-up-role] [data-up-source]')).toBe('Comes with the head position Ward Manager · Ward 7');
  });

  it('without names from the server, the record\'s own references, then a generic line', () => {
    const withoutNames = nouraGrants().map((g) => ({ ...g, headPosition: null, headUnit: null }));
    render({ grants: withoutNames });
    const sources = all('[data-up-role]').map((r) => t('[data-up-source]', r));
    expect(sources.slice(0, 2)).toEqual([
      // The person's own position and primary unit, from references.
      'Comes with the head position Quality Director · Quality Department',
      // Not the person's own position; the unit is their acting unit.
      'Comes with a head position · Patient Safety Unit',
    ]);
  });

  it('en: granted rows only, each module "n of N", each row "From" every active role that gives it', () => {
    render();
    expect(t('[data-up-read-only]')).toBe(
      "Read-only. To change what this person can do, change their roles on the user record, or change a role's permissions.",
    );
    expect(all('[data-up-module]').map((m) => m.getAttribute('data-up-module'))).toEqual([
      'tenant',
      'org',
      'users',
      'lookups',
      'workflows',
      'committees',
      'meetings',
      'positions',
    ]);
    expect(t('[data-up-module="committees"] [data-up-count]')).toBe('9 of 12');
    expect(rowsOf('committees').length).toBe(9);
    expect(rowsOf('committees')).not.toContain('committees:remove_member');
    expect(all('[data-up-group]', q('[data-up-module="committees"]')!).map((g) => text(g))).toEqual([
      'Committee records',
      'Members',
      'Tasks on committees',
    ]);
    const from = (k: string) => t(`[data-up-row="${k}"] [data-up-from]`);
    expect(from('committees:view')).toBe('From Unit Head, Patient Safety Reviewer, Quality Editor');
    expect(from('committees:approve')).toBe('From Patient Safety Reviewer');
    expect(t('[data-up-row="committees:approve"] [data-up-sentence]')).toBe('Approve terms, changes and dissolutions');
    // ✓, never a checkbox; nothing to click that changes anything.
    expect(all('input[type="checkbox"], [role="checkbox"]').length).toBe(0);
    expect(text(q('[data-up-row="committees:view"] .up-tick'))).toBe('✓');
    expect(t('[data-up-nothing]')).toBe('Nothing granted in Roles, Setup health and Administration.');
    // The count is the shown set's: 16 rows in all.
    expect(all('[data-up-row]').length).toBe(16);
  });

  it('ar: the same page, in the page direction: isolated counts and dates, Arabic names', () => {
    render({ lang: 'ar' });
    const raw = text(q('[data-up-summary]'));
    expect(raw).toBe('⁦16⁩ صلاحية من خلال ⁦3⁩ أدوار نشطة');
    expect(t('[data-up-status]')).toBe('نشط');
    expect(t('[data-up-meta]')).toBe('إدارة الجودة · مدير الجودة');
    const rows = all('[data-up-role]');
    expect(rows.map((r) => t('[data-up-role-link]', r))).toEqual(['رئيس وحدة', 'مراجع سلامة المرضى', 'محرر الجودة', 'أمين سر اللجنة']);
    expect(t('[data-up-source]', rows[0]!)).toBe('مرتبط بمنصب الرئاسة مدير الجودة · إدارة الجودة');
    expect(t('[data-up-source]', rows[1]!)).toBe('مرتبط بمنصب الرئاسة رئيس سلامة المرضى · وحدة سلامة المرضى');
    expect(text(q('[data-up-source]', rows[2]!))).toContain('⁦3⁩');
    expect(rows.map((r) => t('[data-up-gives]', r))).toEqual(['يمنح 6 صلاحيات', 'يمنح 3 صلاحيات', 'يمنح 14 صلاحية', 'لا يمنح أي صلاحية ما دام غير نشط']);
    expect(text(q('[data-up-module="committees"] [data-up-count]'))).toBe('⁦9⁩ من ⁦12⁩');
    expect(t('[data-up-row="committees:view"] [data-up-from]')).toBe('من: رئيس وحدة، مراجع سلامة المرضى، محرر الجودة');
    expect(t('[data-up-nothing]')).toBe(`لا شيء ممنوح في: ${moduleName('ar', 'roles')}، ${moduleName('ar', 'setup')} و${moduleName('ar', 'admin')}.`);
  });

  // ── Find ────────────────────────────────────────────────────────────────────

  it('en: Find filters the granted rows by sentence; the counts stay the whole module\'s', () => {
    render();
    find('member');
    expect(all('[data-up-module]').map((m) => m.getAttribute('data-up-module'))).toEqual(['committees']);
    expect(rowsOf('committees')).toEqual(['committees:view', 'committees:add_member', 'committees:change_member_role']);
    expect(t('[data-up-module="committees"] [data-up-count]')).toBe('9 of 12');
    // No "nothing granted" line while searching.
    expect(q('[data-up-nothing]')).toBeNull();
  });

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: Find with no match, and Clear the search`, () => {
      render({ lang });
      find(lang === 'en' ? 'invoice' : 'فاتورة');
      expect(all('[data-up-module]').length).toBe(0);
      expect(t('[data-up-no-match]')).toBe(lang === 'en' ? 'No permissions match. Clear the search.' : 'لا توجد صلاحيات مطابقة. امسح البحث.');
      (q('[data-up-clear]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(component.query()).toBe('');
      expect(all('[data-up-row]').length).toBe(16);
    });
  }

  it('ar: Find matches the reader\'s language only', () => {
    render({ lang: 'ar' });
    find('أعضاء');
    expect(rowsOf('committees')).toEqual(['committees:add_member']);
    find('member');
    expect(all('[data-up-module]').length).toBe(0);
  });

  // ── States ──────────────────────────────────────────────────────────────────

  for (const lang of ['en', 'ar'] as const) {
    it(`${lang}: no active roles`, () => {
      render({ lang, grants: noActiveGrants() });
      expect(t('[data-up-summary]')).toBe(lang === 'en' ? 'No permissions · no active roles' : 'لا صلاحيات · لا أدوار نشطة');
      expect(t('[data-up-no-active]')).toBe(
        lang === 'en'
          ? "Noura Al-Mutairi has no active roles, so can sign in but can't do anything yet."
          : 'لا توجد لدى Noura Al-Mutairi أدوار نشطة، لذا يمكن الدخول إلى النظام دون القدرة على فعل أي شيء بعد.',
      );
      expect(q('[data-up-find]')).toBeNull();
      expect(all('[data-up-module]').length).toBe(0);
      expect(q('[data-up-nothing]')).toBeNull();
      expect(all('[data-up-role]').length).toBe(1);
    });

    it(`${lang}: an Organization Administrator holder: every row, workflows:manage included`, () => {
      render({ lang, user: layla(), grants: rootGrants(ALL_SHOWN) });
      expect(t('[data-up-summary]')).toBe(lang === 'en' ? 'Every permission, through Organization Administrator' : 'كل الصلاحيات، من خلال مسؤول المنشأة');
      expect(t('[data-up-gives]')).toBe(lang === 'en' ? 'Gives every permission' : 'يمنح كل الصلاحيات');
      expect(q('[data-up-system]')).not.toBeNull();
      expect(all('[data-up-row]').length).toBe(ALL_SHOWN.length);
      expect(q('[data-up-row="workflows:manage"]')).not.toBeNull();
      expect(t('[data-up-row="workflows:manage"] [data-up-from]')).toBe(lang === 'en' ? 'From Organization Administrator' : 'من: مسؤول المنشأة');
      expect(t('[data-up-module="workflows"] [data-up-count]')).toBe(lang === 'en' ? '2 of 2' : '2 من 2');
      expect(q('[data-up-nothing]')).toBeNull();
      expect(t('[data-up-row="admin:access"] [data-up-note]')).toBe(
        lang === 'en' ? 'Each admin page also needs its own permission.' : 'كل صفحة إدارية تحتاج أيضًا إلى صلاحيتها الخاصة.',
      );
    });

    it(`${lang}: a deactivated person, with the status note`, () => {
      render({ lang, user: person({ status: 'INACTIVE' }) });
      expect(t('[data-up-status]')).toBe(lang === 'en' ? 'Deactivated' : 'معطّل');
      expect(q('[data-up-status]')!.classList).toContain('up-chip--off');
      expect(t('[data-up-deactivated]')).toBe(
        lang === 'en'
          ? 'Deactivated. These permissions apply only if the account is reactivated.'
          : 'الحساب معطّل. لا تسري هذه الصلاحيات إلا إذا أعيد تنشيطه.',
      );
      // The permissions are still shown: they are what a reactivation restores.
      expect(all('[data-up-row]').length).toBe(16);
    });

    it(`${lang}: loading shows skeleton sections`, () => {
      const pending = new Subject<UserPermissionGrantDto[]>();
      render({ lang, getUserPermissions: () => pending });
      expect(all('[data-up-skeleton]').length).toBe(3);
      expect(q('[data-up-card]')).toBeNull();
      pending.next(nouraGrants());
      pending.complete();
      fixture.detectChanges();
      expect(all('[data-up-skeleton]').length).toBe(0);
      expect(q('[data-up-card]')).not.toBeNull();
    });

    it(`${lang}: the error state, and Retry reads again`, () => {
      let fail = true;
      render({ lang, getUserPermissions: () => (fail ? throwError(() => new HttpErrorResponse({ status: 500 })) : of(nouraGrants())) });
      expect(t('[data-up-error] p')).toBe(lang === 'en' ? "Couldn't load this person's permissions" : 'تعذّر تحميل صلاحيات هذا الشخص');
      expect(text(q('[data-up-error]'))).toContain(lang === 'en' ? 'Nothing has changed. Check your connection and try again.' : 'لم يتغير شيء. تحقق من الاتصال وحاول مرة أخرى.');
      fail = false;
      (q('[data-up-retry] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('[data-up-error]')).toBeNull();
      expect(q('[data-up-card]')).not.toBeNull();
      expect(getUserPermissions).toHaveBeenCalledTimes(2);
    });

    it(`${lang}: a user from another organisation is a 404: "This user isn't in your organization"`, () => {
      render({ lang, getById: () => throwError(() => new HttpErrorResponse({ status: 404 })) });
      expect(t('[data-up-not-found]')).toBe(lang === 'en' ? "This user isn't in your organization" : 'هذا المستخدم ليس ضمن مؤسستك');
      expect(q('[data-up-error]')).toBeNull();
      expect(q('[data-up-card]')).toBeNull();
    });
  }

  // ── The picker and the address ─────────────────────────────────────────────

  it('the picker lists every person with unit, position and status; a choice puts them in the address', async () => {
    render({ userId: null });
    (q('[data-up-find-user-button]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const people = Array.from(document.querySelectorAll<HTMLElement>('[data-up-person]')).map((e) => text(e));
    // Deactivated people can be chosen too.
    expect(people).toEqual(['Layla Al-Harbi', 'Noura Al-Mutairi', 'Omar Old']);
    const noura = Array.from(document.querySelectorAll<HTMLElement>('.am-sl__pick')).find((b) => b.textContent!.includes('Noura'))!;
    expect(noura.textContent).toContain('Quality Department');
    expect(noura.textContent).toContain('Quality Director');
    expect(noura.textContent).toContain('Active');
    const omar = Array.from(document.querySelectorAll<HTMLElement>('.am-sl__pick')).find((b) => b.textContent!.includes('Omar'))!;
    expect(omar.textContent).toContain('Deactivated');
    noura.click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/roles/user-permissions', 'user-noura']);
    expect(component.pickerOpen()).toBeFalse();
  });

  it('a new person in the address is read afresh, and the find box is cleared', () => {
    render();
    find('member');
    params.next(convertToParamMap({ userId: 'user-layla' }));
    fixture.detectChanges();
    expect(getUserPermissions).toHaveBeenCalledWith('user-layla');
    expect(component.query()).toBe('');
    // The catalogue is read once, not once per person.
    expect(listAllPermissions).toHaveBeenCalledTimes(1);
  });
});
