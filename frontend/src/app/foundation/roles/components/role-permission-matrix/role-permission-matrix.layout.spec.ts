import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { ConfirmationService } from 'primeng/api';
import { of } from 'rxjs';
import { RolePermissionMatrixComponent } from './role-permission-matrix.component';
import { PermissionDto, RoleDto, RoleService } from '../../services/role.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { LanguageService } from '../../../../core/services/language.service';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';

// ACC-272 — the grouped list laid out, EN and AR, at 1280, 988, 390 and 328:
// nothing sideways at any depth, the module heading sticky while its rows
// scroll, sentences wrapping (never cut), and below 768px the save bar at the
// bottom of the screen in place of the header's controls.
//
// The host box stands in for the app shell's <main>: a sized box that scrolls,
// padded as the shell pads it (`p-4`, 16px), with the page inside it. The
// padding matters: Chrome measures a sticky top from inside it. The viewport is Karma's iframe, narrowed for the
// phone widths, so the 768px breakpoint applies as it does on a phone.

const SENTENCES = (en as { roles: { matrix: { sentence: Record<string, string> } } }).roles.matrix.sentence;
const perm = (key: string): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse: true, rootRoleOnly: key === 'workflows:manage' };
};
const CATALOGUE = Object.keys(SENTENCES).map(perm);

@Component({
  selector: 'am-test-main',
  standalone: true,
  imports: [RolePermissionMatrixComponent],
  template: `<div data-main [style.width.px]="width()" [style.height.px]="height()" style="overflow:auto;box-sizing:border-box;padding:1rem">
    <app-role-permission-matrix />
  </div>`,
})
class MainHostComponent {
  readonly width = input(1280);
  readonly height = input(700);
}

describe('RolePermissionMatrixComponent layout (ACC-272)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<MainHostComponent>;
  const measured: string[] = [];
  afterAll(() => console.log(`ACC-272 permission list layout\n${measured.join('\n')}`));

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
    const role: RoleDto = {
      id: 'r1', organizationId: 'org-1', key: null, nameEn: 'Quality Editor', nameAr: 'محرر الجودة', description: null,
      isSystem: false, isActive: true, createdAt: '', updatedAt: '',
      permissions: ['committees:view', 'committees:create', 'committees:add_member', 'lookups:view', 'users:view'],
      activeHolderCount: 14, headPositionHolderCount: 0,
    };
    TestBed.configureTestingModule({
      imports: [MainHostComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'r1' }) } } },
        { provide: ConfirmationService, useValue: { confirm: () => undefined } },
        { provide: RoleService, useValue: { getRole: () => of(role), listAllPermissions: () => of(CATALOGUE), assignPermissions: () => of(role) } },
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
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    setViewport(null);
  });

  const box = (el: Element): DOMRect => el.getBoundingClientRect();
  const page = (): RolePermissionMatrixComponent =>
    fixture.debugElement.children[0]!.children[0]!.componentInstance as RolePermissionMatrixComponent;
  function pastFrame(frame: HTMLElement): string[] {
    const f = box(frame);
    return Array.from(frame.querySelectorAll<HTMLElement>('*'))
      // The phone bar is fixed to the SCREEN, not the frame (measured on its own).
      .filter((e) => !e.closest('[data-pm-phone-bar]'))
      .filter((e) => {
        const r = box(e);
        return r.width > 0 && (r.right > f.right + 1 || r.left < f.left - 1);
      })
      .map((e) => e.getAttribute('data-pm-row') || e.className.toString().slice(0, 40) || e.tagName);
  }

  for (const lang of ['en', 'ar'] as const) {
    for (const [width, viewport] of [
      [1280, 1440],
      [988, 1280],
      [390, 390],
      [328, 360],
    ] as const) {
      it(`${lang} at ${width}: one column of modules, nothing sideways, sentences wrap, the heading sticks`, async () => {
        const main = await render(lang, width, viewport);
        const mods = main.querySelectorAll<HTMLElement>('[data-pm-module]');
        // Non-vacuity: the list rendered, every module and row with a size.
        expect(mods.length).toBe(11);
        const rows = main.querySelectorAll<HTMLElement>('[data-pm-row]');
        expect(rows.length).toBe(34);
        expect(box(mods[0]!).width).toBeGreaterThan(200);

        // One column: every module starts at the same inline edge.
        const edges = new Set(Array.from(mods).map((m) => Math.round(lang === 'ar' ? box(m).right : box(m).left)));
        expect(edges.size).withContext('one column').toBe(1);

        // Nothing sideways, at any depth.
        expect(main.scrollWidth).withContext('sideways').toBeLessThanOrEqual(main.clientWidth);
        expect(pastFrame(main)).withContext('past the frame').toEqual([]);

        // Sentences wrap, never cut: no sentence is wider than its box or clips.
        for (const s of Array.from(main.querySelectorAll<HTMLElement>('.pm-sentence'))) {
          expect(s.scrollWidth).withContext(`cut: ${s.textContent}`).toBeLessThanOrEqual(s.clientWidth + 1);
          expect(getComputedStyle(s).whiteSpace).toBe('normal');
        }
        const longest = main.querySelector<HTMLElement>('[data-pm-row="committees:view_unit_tasks"] .pm-sentence')!;
        const lines = Math.round(box(longest).height / parseFloat(getComputedStyle(longest).lineHeight));
        if (width === 328) expect(lines).withContext('the longest sentence wraps at 328').toBeGreaterThan(1);

        // The heading is sticky: scroll Committees' rows under the top of <main>.
        const committees = main.querySelector<HTMLElement>('[data-pm-module="committees"]')!;
        const head = committees.querySelector<HTMLElement>('[data-pm-head]')!;
        expect(getComputedStyle(head).position).toBe('sticky');
        main.scrollTop = committees.offsetTop - main.offsetTop + head.offsetHeight + 120;
        await settle();
        expect(Math.round(box(head).top)).withContext('heading at the top of <main>').toBe(Math.round(box(main).top));
        const firstRow = committees.querySelector<HTMLElement>('[data-pm-row]')!;
        expect(box(firstRow).top).withContext('rows scroll under it').toBeLessThan(box(head).top);
        // No row shows through above the heading, inside <main>'s padding.
        const peeking = Array.from(committees.querySelectorAll<HTMLElement>('[data-pm-row]')).filter((r) => {
          // The part of the row between the top of <main> and the top of the heading.
          const b = box(r);
          return Math.min(b.bottom, box(head).top) - Math.max(b.top, box(main).top) > 1;
        });
        expect(peeking.map((r) => r.getAttribute('data-pm-row'))).withContext('rows showing above the heading').toEqual([]);
        // Its box stays in reach.
        const modBox = head.querySelector<HTMLElement>('[data-pm-module-box]')!;
        expect(box(modBox).top).toBeGreaterThanOrEqual(box(main).top);

        measured.push(`  ${lang} ${width}: page ${main.scrollHeight}, longest sentence ${lines} line(s), sideways ${main.scrollWidth - main.clientWidth}`);
      });
    }

    for (const [width, viewport, phone] of [
      [390, 390, true],
      [328, 360, true],
      [988, 1280, false],
    ] as const) {
      it(`${lang} at ${width}: with changes, the save controls are ${phone ? 'a bar at the bottom of the screen' : 'in the header'}`, async () => {
        const main = await render(lang, width, viewport);
        const c = page();
        c.toggle(['committees:approve']);
        c.toggle(['committees:view']);
        c.toggle(['lookups:view']);
        await settle();
        const bar = document.querySelector<HTMLElement>('[data-pm-phone-bar]')!;
        const header = main.querySelector<HTMLElement>('[data-pm-review]')!;
        expect(bar).withContext('the bar is in the page').not.toBeNull();
        if (phone) {
          expect(getComputedStyle(bar).display).not.toBe('none');
          expect(getComputedStyle(bar).position).toBe('fixed');
          expect(Math.round(box(bar).bottom)).withContext('at the bottom of the screen').toBe(document.documentElement.clientHeight);
          expect(Math.round(box(bar).width)).toBe(document.documentElement.clientWidth);
          expect(bar.textContent).toContain(lang === 'en' ? 'Review 3 changes…' : 'مراجعة');
          expect(box(header).width).withContext('the header controls are hidden').toBe(0);
          // The bar's own contents fit it.
          expect(bar.scrollWidth).toBeLessThanOrEqual(bar.clientWidth);
        } else {
          expect(getComputedStyle(bar).display).toBe('none');
          expect(box(header).width).toBeGreaterThan(0);
        }
        expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
      });
    }

    it(`${lang} at 328: a filter, its match line and a changed row's tag stay inside the frame`, async () => {
      const main = await render(lang, 328, 360);
      const c = page();
      c.toggle(['committees:remove_member']);
      c.query.set(lang === 'en' ? 'member' : 'أعضاء');
      await settle();
      expect(main.querySelectorAll('[data-pm-module]').length).toBe(1);
      expect(main.querySelector('[data-pm-tag]')).not.toBeNull();
      expect(main.scrollWidth).toBeLessThanOrEqual(main.clientWidth);
      expect(pastFrame(main)).toEqual([]);
    });
  }
});
