import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ConfirmationService } from 'primeng/api';
import { UserProfileComponent } from './user-profile.component';
import { AuthService } from '../../../../core/services/auth.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';

// ACC-79 — a user without admin permissions opening their OWN profile, which
// the route guard used to prevent. Before these fixes the page fired four
// requests that could only 403, rendered the ACC-43 read-only fields blank, and
// showed a failed role section beside a control nobody could use.
describe('UserProfileComponent for a viewer without admin permissions (ACC-79)', () => {
  const ME = 'cmtra1n1i00nuocp1hnoxvttd';

  const RECORD = {
    id: ME,
    organizationId: 'cmtr9x7zq0000ocp1am2rs14o',
    email: 'yasser.alamri@alnakheel-hospital.test',
    name: 'Dr. Yasser Al-Amri',
    avatarUrl: null,
    status: 'ACTIVE',
    language: null,
    positionId: 'cmtr9x8hq0002ocp1ugnz7jfc',
    primaryOrgUnitId: 'cmtra03gk00k4ocp1c2bpqj4g',
    managerId: 'cmtr9ztly00j6ocp1emfq6s99',
    outOfOfficeFrom: null,
    outOfOfficeTo: null,
    actingUserId: 'cmtra1opx00nzocp15rd2xmhd',
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
  };

  function render(permissions: string[], arabic = false) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideTranslateService({ lang: 'en' }),
        ConfirmationService,
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: ME }) } } },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: ME, email: RECORD.email, name: RECORD.name }).asReadonly(),
            getMfaStatus: () => ({ subscribe: () => undefined }),
          },
        },
        {
          provide: NavigationAccessService,
          useValue: { hasPermission: (p: string) => permissions.includes(p) },
        },
        {
          provide: LanguageService,
          useValue: { isArabic: () => arabic, use: () => ({ subscribe: () => undefined }) },
        },
      ],
    });
    const fixture = TestBed.createComponent(UserProfileComponent);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    return { fixture, http };
  }

  const urlsOf = (http: HttpTestingController) =>
    http.match(() => true).map((r) => r.request.urlWithParams);

  it('requests none of the lists it has no permission to read', () => {
    const { http } = render([]);
    const urls = urlsOf(http);
    expect(urls.some((u) => u.includes('/org-positions'))).toBe(false);
    expect(urls.some((u) => u.includes('/units/flat'))).toBe(false);
    expect(urls.some((u) => /\/users\?/.test(u))).toBe(false);
    expect(urls.some((u) => u.endsWith(`/users/${ME}`))).toBe(true);
  });

  it('still requests the lists for a viewer who holds the permissions', () => {
    const { http } = render(['positions:view', 'org:view', 'users:view', 'users:manage', 'roles:view']);
    const urls = urlsOf(http);
    expect(urls.some((u) => u.includes('/org-positions'))).toBe(true);
    expect(urls.some((u) => u.includes('/units/flat'))).toBe(true);
    expect(urls.some((u) => /\/users\?/.test(u))).toBe(true);
  });

  // ACC-43 made these visible-but-read-only. They stay visible — as text.
  it('shows the read-only admin fields as named text, not blank pickers', () => {
    const { fixture, http } = render([]);
    http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush(RECORD);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const values = Array.from(el.querySelectorAll('dd')).map((d) => d.textContent!.trim());
    expect(values).toEqual([
      'Senior Specialist',
      'Internal Medicine Ward',
      'Dr. Layla Al-Harbi',
      '—',
      '—',
    ]);
    expect(el.querySelector('[formcontrolname=positionId]')).toBeNull();
  });

  it('names bilingual references in the reading language', () => {
    const { fixture, http } = render([], true);
    http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush(RECORD);
    fixture.detectChanges();

    const values = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('dd')).map(
      (d) => d.textContent!.trim(),
    );
    expect(values.slice(0, 2)).toEqual(['أخصائي أول', 'جناح الباطنة']);
  });

  it('keeps the pickers for a viewer who may edit the fields', () => {
    const { fixture, http } = render(['users:manage', 'users:view', 'positions:view', 'org:view']);
    http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush(RECORD);
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[formcontrolname=positionId]')).not.toBeNull();
    expect(el.querySelectorAll('dd').length).toBe(0);
  });

  it('does not render the role section without roles:view', () => {
    const { fixture, http } = render([]);
    http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush(RECORD);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('app-user-role-assignment')).toBeNull();
    expect(urlsOf(http).some((u) => u.includes('/roles'))).toBe(false);
  });

  // Without the colleague list the picker had no options, so it could not even
  // show who the current stand-in is.
  it('shows the current acting user even without the colleague list', () => {
    const { fixture, http } = render([]);
    http.expectOne((r) => r.url.endsWith(`/users/${ME}`)).flush(RECORD);
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.otherUsers()).toEqual([
      { id: RECORD.actingUserId, name: 'Dr. Omar Siddiqui', primaryOrgUnitId: null },
    ]);
  });
});
