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

// ACC-266 — the matrix's sticky headings and its width, measured in a real
// layout. The host box stands in for the app shell's <main>: a sized box that
// scrolls, with the page inside it. Nothing here asserts a height the
// component does not own; every claim is about where the headings, the corner
// and the frozen column sit after a scroll, or how the width is shared.

const perm = (key: string): PermissionDto => {
  const [module, action] = key.split(':');
  return { id: key, module, action, description: null, inUse: true, rootRoleOnly: false };
};

// Enough rows to be several times taller than any host box below.
const LARGE: PermissionDto[] = [
  'users:view', 'users:manage', 'users:invite',
  'roles:view', 'roles:manage',
  'org:view', 'org:manage',
  'lookups:view', 'lookups:manage',
  'workflows:view',
  'committees:view', 'committees:create', 'committees:edit_details', 'committees:approve', 'committees:manage',
  'committees:add_member', 'committees:remove_member', 'committees:change_member_role',
  'documents:view', 'documents:create', 'documents:approve',
  'meetings:view', 'meetings:manage',
  'reports:view', 'reports:export',
  'setup:view',
].map(perm);
const SMALL: PermissionDto[] = ['users:view'].map(perm);

@Component({
  selector: 'am-test-main',
  standalone: true,
  imports: [RolePermissionMatrixComponent],
  // The shell's <main>: overflow auto, the page as its only child.
  template: `<div data-main [style.width.px]="width()" [style.height.px]="height()" style="overflow:auto;box-sizing:border-box">
    <app-role-permission-matrix />
  </div>`,
})
class MainHostComponent {
  readonly width = input(1440);
  readonly height = input(700);
}

describe('RolePermissionMatrixComponent layout (ACC-266)', () => {
  preserveDocumentLanguage();
  let fixture: ComponentFixture<MainHostComponent>;

  async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(opts: { lang?: 'en' | 'ar'; width?: number; height?: number; catalogue?: PermissionDto[] } = {}): Promise<void> {
    const lang = opts.lang ?? 'en';
    TestBed.resetTestingModule();
    const role: RoleDto = {
      id: 'r1', organizationId: 'org-1', key: 'BASE_USER', nameEn: 'Base User', nameAr: 'مستخدم أساسي', description: null,
      isSystem: true, isActive: true, createdAt: '', updatedAt: '', permissions: ['users:view'], activeHolderCount: 3, headPositionHolderCount: 0,
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
        {
          provide: RoleService,
          useValue: { getRole: () => of(role), listAllPermissions: () => of(opts.catalogue ?? LARGE), assignPermissions: () => of(role) },
        },
        { provide: NavigationAccessService, useValue: { hasPermission: () => true, isPlatformOrg: () => false } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(lang);
    TestBed.inject(LanguageService).use(lang);
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
    fixture = TestBed.createComponent(MainHostComponent);
    fixture.componentRef.setInput('width', opts.width ?? 1440);
    fixture.componentRef.setInput('height', opts.height ?? 700);
    document.body.appendChild(fixture.nativeElement);
    await settle();
  }

  afterEach(() => {
    fixture?.nativeElement.remove();
    document.querySelectorAll('.p-dialog-mask, .p-dialog').forEach((n) => n.remove());
    setViewport(null);
  });

  // The specs run in Karma's iframe, so narrowing that iframe is a real
  // viewport change: the sm breakpoint (640px) applies exactly as on a phone.
  function setViewport(width: number | null): void {
    const frame = window.frameElement as HTMLElement | null;
    if (width === null) {
      if (frame) frame.style.width = '';
      return;
    }
    if (!frame) throw new Error('These specs narrow the viewport through Karma\'s iframe, and there is none');
    frame.style.width = `${width}px`;
  }

  const q = <T extends HTMLElement = HTMLElement>(sel: string): T => (fixture.nativeElement as HTMLElement).querySelector(sel) as T;
  const box = (el: Element): DOMRect => el.getBoundingClientRect();
  const scroller = (): HTMLElement => q('.pm-scroll');
  const head = (): HTMLElement => q('.pm-row--head');
  const corner = (): HTMLElement => q('.pm-row--head > .pm-frozen');
  const bodyFrozen = (): HTMLElement => q('.pm-row:not(.pm-row--head) > .pm-frozen');
  const z = (el: Element): number => Number(getComputedStyle(el).zIndex);
  // The shadow's x-offset: computed as 'rgba(…) 6px 0px 8px -6px', colour first.
  const shadowX = (el: Element): number => Number(/\)\s+(-?[\d.]+)px/.exec(getComputedStyle(el).boxShadow)?.[1]);

  it('the header row and the corner are sticky, and the corner sits above the header and the frozen column', async () => {
    await render({ width: 900, height: 600 });
    expect(getComputedStyle(head()).position).toBe('sticky');
    expect(shadowX(bodyFrozen())).withContext('English shadow falls to the right').toBe(6);
    expect(getComputedStyle(head()).top).toBe('0px');
    expect(getComputedStyle(corner()).position).toBe('sticky');
    expect(z(corner())).withContext('corner above header').toBeGreaterThan(z(head()));
    expect(z(head())).withContext('header above frozen column').toBeGreaterThan(z(bodyFrozen()));

    // Non-vacuity: there is room to scroll both ways, so "stays put" means something.
    const s = scroller();
    expect(s.scrollHeight).toBeGreaterThan(s.clientHeight + 200);
    expect(s.scrollWidth).toBeGreaterThan(s.clientWidth + 100);
    const before = box(s);
    s.scrollTop = 400;
    s.scrollLeft = 200;
    await settle();
    expect(s.scrollTop).toBe(400);
    expect(Math.round(box(head()).top)).withContext('header at the top').toBe(Math.round(before.top));
    expect(Math.round(box(corner()).top)).withContext('corner at the top').toBe(Math.round(before.top));
    expect(Math.round(box(corner()).left)).withContext('corner at the start').toBe(Math.round(before.left));
    // A permission name below stays pinned at the start too.
    const label = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.pm-row:not(.pm-row--head) > .pm-frozen'))
      .find((el) => box(el).top > box(head()).bottom)!;
    expect(Math.round(box(label).left)).toBe(Math.round(before.left));
  });

  it('the frame fits the box and scrolls vertically when the content is taller', async () => {
    await render({ width: 1440, height: 700 });
    const main = q('[data-main]');
    const frame = q('.pm-frame');
    const s = scroller();
    expect(s.scrollHeight).withContext('content taller than the scroller').toBeGreaterThan(s.clientHeight);
    expect(main.scrollHeight).withContext('the page does not overflow <main>').toBeLessThanOrEqual(main.clientHeight);
    expect(box(frame).bottom).toBeLessThanOrEqual(box(main).bottom + 0.5);
    expect(getComputedStyle(s).overflowY).toBe('auto');
  });

  it('a role with few rows gets a frame only as tall as its content', async () => {
    await render({ width: 1440, height: 700, catalogue: SMALL });
    const s = scroller();
    const main = q('[data-main]');
    expect(s.scrollHeight).toBe(s.clientHeight);
    // Far less than the room it had: no empty box.
    expect(box(q('.pm-frame')).bottom).toBeLessThan(box(main).bottom - 300);
  });

  it('a short window keeps a usable frame and lets <main> scroll the page', async () => {
    await render({ width: 1440, height: 320 });
    const frame = q('.pm-frame');
    const main = q('[data-main]');
    // Non-vacuity: the box is shorter than the floor, so the floor is what decides.
    expect(main.clientHeight).toBeLessThan(400);
    expect(frame.offsetHeight).withContext('header + six rows + legend').toBeGreaterThanOrEqual(35 + 6 * 44 + 40);
    expect(main.scrollHeight).toBeGreaterThan(main.clientHeight);
  });

  it('the grid fills a 1440 frame, the frozen column 300 and the six action columns equal', async () => {
    await render({ width: 1440, height: 700 });
    const s = scroller();
    const grid = q('.pm-grid');
    const cells = Array.from(head().querySelectorAll<HTMLElement>('.pm-cell'));
    expect(cells.length).toBe(6);
    expect(Math.round(box(grid).width)).toBe(s.clientWidth);
    expect(s.scrollWidth).toBe(s.clientWidth);
    expect(box(corner()).width).toBe(300);
    const widths = cells.map((c) => box(c).width);
    expect(widths[0]).toBeGreaterThan(150);
    for (const w of widths) expect(w).toBeCloseTo(widths[0], 1);
    // Body rows share the same columns.
    const bodyCells = Array.from(q('.pm-row:not(.pm-row--head)').querySelectorAll<HTMLElement>('.pm-cell'));
    bodyCells.forEach((c, i) => expect(box(c).left).toBeCloseTo(box(cells[i]).left, 1));
  });

  it('below 1200 the grid keeps 1200 and scrolls sideways', async () => {
    await render({ width: 900, height: 600 });
    expect(Math.round(box(q('.pm-grid')).width)).toBe(1200);
    for (const c of Array.from(head().querySelectorAll<HTMLElement>('.pm-cell'))) expect(box(c).width).toBe(150);
  });

  it('in Arabic the frozen column is pinned at the right, with the right-to-left shadow, after a sideways scroll', async () => {
    await render({ lang: 'ar', width: 900, height: 600 });
    const s = scroller();
    const right = box(s).right;
    expect(Math.round(box(bodyFrozen()).right)).toBe(Math.round(right));
    expect(shadowX(bodyFrozen())).withContext('shadow falls to the left, on the inner edge').toBe(-6);
    // An RTL scroller scrolls with negative scrollLeft in Chrome.
    s.scrollLeft = -200;
    s.scrollTop = 300;
    await settle();
    expect(s.scrollLeft).toBe(-200);
    expect(Math.round(box(bodyFrozen()).right)).toBe(Math.round(right));
    expect(Math.round(box(corner()).right)).toBe(Math.round(right));
    expect(Math.round(box(corner()).top)).toBe(Math.round(box(s).top));
  });

  it('focus keeps the cell clear of the frozen column and of the sticky header', async () => {
    await render({ width: 900, height: 600 });
    const s = scroller();
    expect(getComputedStyle(s).scrollPaddingInlineStart).toBe('300px');
    expect(getComputedStyle(s).scrollPaddingBlockStart).toBe('35px');

    // Each cell is put PARTLY under the header or the frozen column, with more
    // than 32px still showing — the case Chrome's own focus() scroll leaves
    // where it is — and reached with the arrows, as a person reaches it.
    const grid = q('[role="grid"]');
    const press = async (key: string): Promise<void> => {
      grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle();
    };
    const cellBox = (at: string): DOMRect => box(q(`[data-pm-cell="${at}"]`).closest('.pm-cell, .pm-frozen')!);

    // Up into a row 10px under the header (34px of it showing).
    s.scrollTop += cellBox('12:1').top - box(s).top - 25;
    await settle();
    expect(cellBox('12:1').top - box(s).top).withContext('starts under the header').toBeLessThan(35);
    q('[data-pm-cell="13:1"]').focus({ preventScroll: true });
    await press('ArrowUp');
    expect(document.activeElement?.closest('[data-pm-cell]')?.getAttribute('data-pm-cell') ?? document.activeElement?.getAttribute('data-pm-cell')).toBe('12:1');
    expect(cellBox('12:1').top - box(s).top).withContext('clear of the header').toBeGreaterThanOrEqual(35 - 0.5);

    // Left into a cell 60px under the frozen column (90px of it showing).
    s.scrollLeft += cellBox('13:2').left - box(s).left - 240;
    await settle();
    expect(cellBox('13:2').left - box(s).left).withContext('starts under the frozen column').toBeLessThan(300);
    q('[data-pm-cell="13:3"]').focus({ preventScroll: true });
    await press('ArrowLeft');
    expect(cellBox('13:2').left - box(s).left).withContext('clear of the frozen column').toBeGreaterThanOrEqual(300 - 0.5);
  });

  // ── Phones (Ahmad, 27 Oct): below sm the frozen column is 160 and names wrap ─
  // The page at 390 is <main> at 358 (its 16px padding each side).
  for (const lang of ['en', 'ar'] as const) {
    const rtl = lang === 'ar';
    const startOf = (r: DOMRect): number => (rtl ? r.right : r.left);
    const endOf = (r: DOMRect): number => (rtl ? r.left : r.right);
    // How far `a` sits past `b` towards the end of the line (left in Arabic).
    const past = (a: number, b: number): number => (rtl ? b - a : a - b);

    it(`${lang} at 390: the frozen column is 160, names wrap without clipping, and a whole action column shows beside it`, async () => {
      setViewport(390);
      await render({ lang, width: 358, height: 700 });
      // Non-vacuity: this really is a phone-width viewport.
      expect(window.innerWidth).toBe(390);
      const s = scroller();
      const frozen = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.pm-row:not(.pm-row--head) > .pm-frozen'));
      expect(box(corner()).width).toBe(160);
      for (const f of frozen) expect(box(f).width).toBe(160);
      // Every frozen cell holds its text: nothing clipped, nothing cut short.
      for (const f of [corner(), ...frozen]) {
        expect(f.scrollHeight).withContext(`clipped: ${f.textContent?.trim()}`).toBeLessThanOrEqual(f.clientHeight);
        expect(f.scrollWidth).withContext(`clipped: ${f.textContent?.trim()}`).toBeLessThanOrEqual(f.clientWidth);
      }
      // Names wrap instead: permission names and module descriptions run to more lines.
      const lines = (sel: string, lineHeight: number): number =>
        Math.max(...Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(sel)).map((e) => Math.round(box(e).height / lineHeight)));
      expect(lines('.pm-perm-name', 22)).withContext('a permission name wraps').toBeGreaterThanOrEqual(2);
      expect(lines('.pm-module-desc', 18)).withContext('a module description wraps').toBeGreaterThanOrEqual(2);
      // Rows grow to fit, and never below 44.
      for (const row of Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.pm-row:not(.pm-row--head)'))) {
        expect(row.offsetHeight).toBeGreaterThanOrEqual(44);
        const f = row.querySelector<HTMLElement>('.pm-frozen')!;
        expect(row.offsetHeight).toBeGreaterThanOrEqual(f.scrollHeight);
      }
      // The grid minimum follows: 160 + 6 × 150.
      expect(Math.round(box(q('.pm-grid')).width)).toBe(1060);
      // A whole action column fits beside the frozen column.
      const first = box(head().querySelectorAll<HTMLElement>('.pm-cell')[0]);
      expect(past(startOf(first), endOf(box(corner())))).toBeGreaterThanOrEqual(-0.5);
      expect(past(endOf(box(s)), endOf(first))).withContext('the whole first action column shows').toBeGreaterThanOrEqual(-0.5);
      expect(getComputedStyle(s).scrollPaddingInlineStart).toBe('160px');
    });

    it(`${lang} at 390: the arrow keys never leave the focused cell under the frozen column or the header`, async () => {
      setViewport(390);
      await render({ lang, width: 358, height: 700 });
      expect(window.innerWidth).toBe(390);
      const s = scroller();
      const grid = q('[role="grid"]');
      q('[data-pm-cell="0:0"]').focus();
      const next = rtl ? 'ArrowLeft' : 'ArrowRight';
      const back = rtl ? 'ArrowRight' : 'ArrowLeft';
      const walk = [...Array(14).fill('ArrowDown'), ...Array(6).fill(next), ...Array(10).fill('ArrowDown'), ...Array(6).fill(back), ...Array(6).fill(next)];
      let moved = 0;
      for (const key of walk) {
        grid.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
        await settle();
        const el = (document.activeElement as HTMLElement).closest<HTMLElement>('.pm-cell, .pm-frozen')!;
        expect(el).withContext(`focus left the grid after ${key}`).not.toBeNull();
        if (!el.classList.contains('pm-frozen')) {
          moved++;
          const b = box(el);
          expect(past(startOf(b), endOf(box(bodyFrozen())))).withContext(`under the frozen column after ${key}`).toBeGreaterThanOrEqual(-0.5);
          expect(past(endOf(box(s)), endOf(b))).withContext(`past the frame after ${key}`).toBeGreaterThanOrEqual(-0.5);
        }
        expect(box(el).top).withContext(`under the header after ${key}`).toBeGreaterThanOrEqual(box(head()).bottom - 0.5);
      }
      // Non-vacuity: most moves landed on action cells, the ones that could hide.
      expect(moved).toBeGreaterThan(20);
    });
  }
});
