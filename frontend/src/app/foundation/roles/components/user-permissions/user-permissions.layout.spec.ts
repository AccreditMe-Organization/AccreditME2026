import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import { UserPermissionsComponent } from './user-permissions.component';
import { PermissionDto, RoleService } from '../../services/role.service';
import { UserService } from '../../../user/services/user.service';
import { OrgUnitService } from '../../../organization/services/org-unit.service';
import { OrgPositionService } from '../../../org-position/services/org-position.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { grant, nouraGrants, person } from '../../permission-matrix/user-permissions.fixtures';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';

// ACC-272 — "A user's permissions" laid out, EN and AR, at 1280, 988, 390 and
// 328: one column, nothing sideways at any depth, and long names, source lines
// and "From" lines wrap rather than run out of their box. Below 768px a role's
// "Gives" line takes its own row.
//
// The host box stands in for the app shell's <main>: sized, scrolling, padded
// as the shell pads it (p-4).

const SENTENCES = (en as { roles: { matrix: { sentence: Record<string, string> } } }).roles.matrix.sentence;
const perm = (key: string): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse: true, rootRoleOnly: key === 'workflows:manage' };
};
const CATALOGUE = Object.keys(SENTENCES).map(perm);

// Long, on purpose: the wrap is what is measured.
const LONG_POSITION = { nameEn: 'Director of Clinical Quality Improvement and Accreditation Readiness', nameAr: 'مدير تحسين الجودة السريرية والجاهزية للاعتماد وسلامة المرضى' };
const LONG_UNIT = { nameEn: 'Department of Quality, Patient Safety and Clinical Governance', nameAr: 'إدارة الجودة وسلامة المرضى والحوكمة السريرية' };
const GRANTS = [
  ...nouraGrants(),
  grant({
    name: 'Accreditation Programme Coordinator for the Joint Commission Survey',
    nameAr: 'منسق برنامج الاعتماد لزيارة اللجنة الدولية المشتركة للمستشفيات',
    permissions: ['committees:remove_member', 'roles:view'],
  }),
];

@Component({
  selector: 'am-test-main',
  standalone: true,
  imports: [UserPermissionsComponent],
  template: `<div data-main [style.width.px]="width()" [style.height.px]="height()" style="overflow:auto;box-sizing:border-box;padding:1rem">
    <app-user-permissions />
  </div>`,
})
class MainHostComponent {
  readonly width = input(1280);
  readonly height = input(700);
}

describe('UserPermissionsComponent layout (ACC-272)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<MainHostComponent>;
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-272 user permissions layout\n${measured.join('\n')}`));

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  function setViewport(width: number | null): void {
    const frame = window.frameElement as HTMLElement | null;
    if (width === null) {
      if (frame) frame.style.width = '';
      return;
    }
    if (!frame) throw new Error("These specs size the viewport through Karma's iframe, and there is none");
    frame.style.width = `${width}px`;
  }

  async function render(lang: 'en' | 'ar', width: number, viewport: number): Promise<HTMLElement> {
    setViewport(viewport);
    TestBed.resetTestingModule();
    const user = person({
      name: lang === 'en' ? 'Noura Abdulrahman Al-Mutairi Al-Qahtani Al-Dosari' : 'نورة عبدالرحمن المطيري القحطاني الدوسري',
      references: { position: LONG_POSITION, primaryOrgUnit: LONG_UNIT, actingOrgUnit: LONG_UNIT, manager: null, actingUser: null },
    });
    TestBed.configureTestingModule({
      imports: [MainHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ userId: 'user-noura' })) } },
        { provide: RoleService, useValue: { getUserPermissions: () => of(GRANTS), listAllPermissions: () => of(CATALOGUE) } },
        { provide: UserService, useValue: { getById: () => of(user), listAllUsers: () => of([user]) } },
        { provide: OrgUnitService, useValue: { getFlat: () => of([]) } },
        { provide: OrgPositionService, useValue: { listPositions: () => of([]) } },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true, isPlatformOrg: () => false } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(MainHostComponent);
    fixture.componentRef.setInput('width', width);
    document.body.appendChild(fixture.nativeElement);
    await settle();
    return fixture.nativeElement.querySelector('[data-main]') as HTMLElement;
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    setViewport(null);
  });

  const box = (el: Element): DOMRect => el.getBoundingClientRect();
  const lines = (el: HTMLElement): number => Math.round(box(el).height / parseFloat(getComputedStyle(el).lineHeight));
  function pastFrame(frame: HTMLElement): string[] {
    const f = box(frame);
    return Array.from(frame.querySelectorAll<HTMLElement>('*'))
      .filter((e) => {
        const r = box(e);
        return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
      })
      .map((e) => e.getAttribute('data-up-row') || e.className.toString().slice(0, 40) || e.tagName);
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const [width, viewport] of [
      [1280, 1440],
      [988, 1280],
      [390, 390],
      [328, 360],
    ] as const) {
      it(`${lang} at ${width}: one column, nothing sideways, long names and lines wrap`, async () => {
        const main = await render(lang, width, viewport);
        // Non-vacuity: the page rendered, with its roles and rows.
        const roles = main.querySelectorAll<HTMLElement>('[data-up-role]');
        expect(roles.length).toBe(5);
        expect(main.querySelectorAll('[data-up-row]').length).toBeGreaterThan(10);
        const sections = main.querySelectorAll<HTMLElement>('[data-up-card], [data-up-roles], [data-up-permissions]');
        expect(sections.length).toBe(3);
        expect(box(sections[0]!).width).toBeGreaterThan(200);

        // One column: the three sections start at the same inline edge.
        const edges = new Set(Array.from(sections).map((s) => Math.round(lang === 'ar' ? box(s).right : box(s).left)));
        expect(edges.size).withContext('one column').toBe(1);

        // Nothing sideways, at any depth.
        expect(main.scrollWidth).withContext('sideways').toBeLessThanOrEqual(main.clientWidth);
        expect(pastFrame(main)).withContext('past the frame').toEqual([]);

        // Nothing is cut: names, source lines, sentences and From lines wrap in their box.
        for (const sel of ['[data-up-name]', '[data-up-role-link]', '[data-up-source]', '[data-up-sentence]', '[data-up-from]', '[data-up-meta]']) {
          for (const el of Array.from(main.querySelectorAll<HTMLElement>(sel))) {
            expect(el.scrollWidth).withContext(`cut ${sel}: ${el.textContent}`).toBeLessThanOrEqual(el.clientWidth + 1);
            expect(getComputedStyle(el).whiteSpace).withContext(sel).not.toBe('nowrap');
          }
        }
        const headSource = roles[0]!.querySelector<HTMLElement>('[data-up-source]')!;
        const longRole = main.querySelector<HTMLElement>('[data-up-role="role-accreditation-programme-coordinator-for-the-joint-commission-survey"] [data-up-role-link]')!;
        const longFrom = main.querySelector<HTMLElement>('[data-up-row="committees:view"] [data-up-from]')!;
        if (width <= 390) {
          expect(lines(headSource)).withContext('the head-position source line wraps on a phone').toBeGreaterThan(1);
          expect(lines(longRole)).withContext('the long role name wraps on a phone').toBeGreaterThan(1);
          expect(lines(longFrom)).withContext('the From line wraps on a phone').toBeGreaterThan(1);
          // A role's "Gives" line takes its own row below 768px.
          const gives = roles[0]!.querySelector<HTMLElement>('[data-up-gives]')!;
          expect(Math.round(box(gives).top)).withContext('gives on its own row').toBeGreaterThanOrEqual(Math.round(box(headSource).bottom));
        } else {
          const gives = roles[0]!.querySelector<HTMLElement>('[data-up-gives]')!;
          expect(Math.round(box(gives).top)).withContext('gives beside the name').toBeLessThan(Math.round(box(headSource).bottom));
        }
        measured.push(
          `  ${lang} ${width}: page ${main.scrollHeight}, source ${lines(headSource)} line(s), role name ${lines(longRole)}, From ${lines(longFrom)}, sideways ${main.scrollWidth - main.clientWidth}`,
        );
      });
    }
  }
});
