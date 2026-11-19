import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService, TranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { UserListComponent } from './user-list.component';
import { IUserDto, UserService } from '../../services/user.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { RoleService } from '../../../roles/services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { pickBilingualName } from '../../../../shared/utils/bilingual-name.util';
import { provideFormatTesting } from '../../../../core/formatting/testing';
import { expectArabicDateInPageDirection } from '../../../../../testing/arabic-date';

/**
 * ACC-313 (CC-323) — a row's Last login takes the page's direction. It sat in
 * a dir="ltr" span, so an Arabic date-time showed its day last
 * («سبتمبر 2026، 13:00 20»).
 */
describe('UserListComponent — Last login in Arabic (ACC-313)', () => {
  const USER = {
    id: 'cmtra1opx00nzocp15rd2xmhd',
    name: 'Dr. Yasser Al-Amri',
    email: 'yasser.alamri@alnakheel-hospital.test',
    status: 'ACTIVE',
    primaryOrgUnitId: null,
    positionId: null,
    managerId: null,
    lastLoginAt: '2026-09-20T10:00:00.000Z',
  } as unknown as IUserDto;

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
            listAllUsers: () => of([USER]),
            getStatusCounts: () => of({ ACTIVE: 1 }),
            listUsers: () => of({ data: [USER], total: 1, page: 1, pageSize: 25 }),
          },
        },
        { provide: OrgPositionService, useValue: { listPositions: () => of([]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: RoleService, useValue: { getUserRoles: () => of([]) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: 'cmtviewer0000ocp1notinlist' }) } },
        // Stubbed so the document's own direction is never written (ACC-184):
        // the rule under test is the span's, not the page's.
        {
          provide: LanguageService,
          useValue: {
            isArabic: () => true,
            isRtl: () => true,
            bilingual: (en: string, ar: string | null | undefined) => pickBilingualName(en, ar, true),
          },
        },
      ],
    });
    TestBed.inject(TranslateService).use('ar');
    const fixture = TestBed.createComponent(UserListComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('reads day first, with the time last, in the page direction', () => {
    const fixture = render();
    const spans = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('span'));
    const span = spans.find((s) => s.children.length === 0 && /^\s*20 سبتمبر/.test(s.textContent ?? ''));
    expectArabicDateInPageDirection(span, { day: '20', month: 'سبتمبر', time: '13:00' });
  });
});
