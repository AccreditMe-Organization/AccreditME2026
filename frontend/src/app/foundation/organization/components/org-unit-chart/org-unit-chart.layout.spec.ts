import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { of } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { AccreditMePreset } from '../../../../core/theme/accreditme-preset';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { OrgChartNodeDto, OrgChartResponseDto, OrgUnitService } from '../../services/org-unit.service';
import { CONNECTOR } from './org-chart-model';
import { OrgUnitChartComponent, PANEL_WIDTH } from './org-unit-chart.component';

// ACC-120 slice 11, PR E — the chart's layout, measured with the real theme in
// both languages, at the CONTENT widths the shell leaves at 1280, 390 and 360
// (988, 358 and 328px):
//   - every box at its drawn size, per level and language;
//   - every box on a level at the same top and height (the row is level);
//   - every connector stub within 1px of its box's centre, read from the
//     stub's OWN computed position — including a deliberately uneven subtree;
//   - the panel 280 wide beside the chart, or below it as a sheet on a phone;
//   - the chart scrolls sideways inside its own area, the page never does.
// And the 150-box timings, logged.
//
// NON-VACUITY FIRST (ACC-120): a chart that never laid out passes "every stub
// is centred" with every number zero, so each case first proves boxes
// rendered, with distinct, non-zero positions.

const DEPT = { id: 'dept', key: 'dept', labelEn: 'Department', labelAr: 'قسم', isRetired: false };
const HEAD = { userId: 'h', name: 'Dr. Abdulrahman Al-Mutairi', positionId: 'p', positionNameEn: 'Head of Department', positionNameAr: 'رئيس القسم', role: 'substantive' as const, countedHere: true };

function n(id: string, parentId: string | null, depth: number, over: Partial<OrgChartNodeDto> = {}): OrgChartNodeDto {
  return {
    id,
    parentId,
    nameEn: `Inpatient Pharmacy and Medication Safety ${id}`,
    nameAr: `صيدلية المرضى المنومين وسلامة الأدوية ${id}`,
    code: id.toUpperCase(),
    type: DEPT,
    sortOrder: 0,
    isActive: true,
    childCount: 0,
    heads: [HEAD],
    acting: null,
    headcount: 14,
    committees: { count: 0 },
    depth,
    ...over,
  };
}

/**
 * Uneven on purpose: `a` carries a wide subtree on one side only, `b` none,
 * `c` a single child with four of its own — so a parent centred on the wrong
 * thing (its first child, the group's start) would show here.
 * With `tall`, `c1x` hides 3 children, making level 4 tall.
 */
function uneven(tall: boolean): OrgChartResponseDto {
  return {
    root: { id: 'root', path: [{ id: 'root', nameEn: 'Al Nakheel Specialist Hospital', nameAr: 'مستشفى النخيل التخصصي' }] },
    depth: 4,
    asOf: '',
    nodes: [
      n('root', null, 0, { childCount: 3 }),
      n('a', 'root', 1, { childCount: 3 }),
      n('a1', 'a', 2, { childCount: 3 }),
      n('a1x', 'a1', 3),
      n('a1y', 'a1', 3),
      n('a1z', 'a1', 3),
      n('a2', 'a', 2),
      n('a3', 'a', 2),
      n('b', 'root', 1),
      n('c', 'root', 1, { childCount: 1 }),
      n('c1', 'c', 2, { childCount: 4 }),
      n('c1w', 'c1', 3, { heads: [] }),
      n('c1x', 'c1', 3, { childCount: tall ? 3 : 0 }),
      n('c1y', 'c1', 3),
      n('c1z', 'c1', 3),
    ],
  };
}

/** 150 boxes, four levels: 1 + 5 + 25 + 119. */
function big(rootId = 'r'): OrgChartResponseDto {
  const nodes: OrgChartNodeDto[] = [n(rootId, null, 0, { childCount: 5 })];
  for (let i = 0; i < 5; i++) {
    nodes.push(n(`${rootId}-${i}`, rootId, 1, { childCount: 5 }));
    for (let j = 0; j < 5; j++) {
      nodes.push(n(`${rootId}-${i}-${j}`, `${rootId}-${i}`, 2, { childCount: 5 }));
      for (let k = 0; k < 5 && nodes.length < 150; k++) nodes.push(n(`${rootId}-${i}-${j}-${k}`, `${rootId}-${i}-${j}`, 3, { childCount: 2 }));
    }
  }
  nodes.splice(150); // the last level-2 unit, with no child shown
  return { root: { id: rootId, path: [{ id: rootId, nameEn: rootId, nameAr: null }] }, depth: 4, asOf: '', nodes };
}

/** The routed page: the chart in a frame as wide as the shell's content area. */
let frameWidth = 988;
@Component({
  standalone: true,
  imports: [OrgUnitChartComponent],
  template: `<div data-testid="frame" [style.width.px]="w" style="box-sizing: content-box"><am-org-unit-chart /></div>`,
})
class RouteComponent {
  readonly w = frameWidth;
}

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

describe('OrgUnitChart — layout (ACC-120 slice 11, PR E)', () => {
  preserveDocumentLanguage();
  const measured: string[] = [];
  let harness: RouterTestingHarness;
  let response: (rootId: string | undefined) => OrgChartResponseDto;

  async function settle(): Promise<void> {
    for (let i = 0; i < 4; i++) {
      harness.detectChanges();
      await harness.fixture.whenStable();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  }

  async function render(language: 'en' | 'ar', width: number, res: (rootId: string | undefined) => OrgChartResponseDto, opts: { phone?: boolean; url?: string } = {}) {
    TestBed.resetTestingModule();
    frameWidth = width;
    response = res;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'organization', component: RouteComponent }]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({ theme: { preset: AccreditMePreset, options: { darkModeSelector: false } } }),
        { provide: NavigationAccessService, useValue: { hasPermission: () => true } },
        { provide: AuthService, useValue: { currentUser: () => null } },
        { provide: OrgUnitService, useValue: { getChart: (o: { rootId?: string }) => of(response(o.rootId)), getSummary: () => of(null) } },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(language);
    TestBed.inject(LanguageService).use(language);
    document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
    harness = await RouterTestingHarness.create();
    document.body.appendChild(harness.fixture.nativeElement);
    const started = performance.now();
    await harness.navigateByUrl(opts.url ?? '/organization?view=chart');
    const chart = harness.fixture.debugElement.query(By.directive(OrgUnitChartComponent)).componentInstance as OrgUnitChartComponent;
    // The shell's media query reads the Karma frame's viewport, not this frame's
    // width, so each case states it; the browser check drives the real one.
    chart.phone.set(!!opts.phone);
    await settle();
    const ms = performance.now() - started;
    return { chart, frame: harness.fixture.nativeElement.querySelector('[data-testid="frame"]') as HTMLElement, ms };
  }

  afterEach(() => harness?.fixture.nativeElement.remove());
  afterAll(() => console.log(`ACC-120 slice 11 PR E chart layout\n${measured.join('\n')}`));

  const rect = (e: Element): Rect => e.getBoundingClientRect();
  const boxes = (frame: HTMLElement) => Array.from(frame.querySelectorAll<HTMLElement>('am-org-chart-box'));

  /** A stub's centre, from its own computed inset (the inline-start side flips in RTL). */
  function stubX(el: HTMLElement, pseudo: '::before' | '::after', rtl: boolean): number {
    const s = getComputedStyle(el, pseudo);
    const r = rect(el);
    const w = parseFloat(s.width);
    return rtl ? r.right - parseFloat(s.right) - w / 2 : r.left + parseFloat(s.left) + w / 2;
  }

  /** Every connector in the frame: each stub's offset from the box centre it serves, and where the bars end. */
  function connectorOffsets(frame: HTMLElement, rtl: boolean): { worst: number; checked: number; barMisses: number } {
    let worst = 0;
    let checked = 0;
    let barMisses = 0;
    const centre = (e: Element) => rect(e).left + rect(e).width / 2;
    for (const kids of Array.from(frame.querySelectorAll<HTMLElement>('.occ__kids'))) {
      const parentBox = kids.parentElement!.querySelector(':scope > am-org-chart-box')!;
      const down = stubX(kids, '::before', rtl);
      worst = Math.max(worst, Math.abs(down - centre(parentBox)));
      checked++;
      // The parent's box sits on the stub's top; the bar is the stub's foot.
      worst = Math.max(worst, Math.abs(rect(parentBox).bottom - rect(kids).top));
      const kidEls = Array.from(kids.querySelectorAll<HTMLElement>(':scope > .occ__kid'));
      const xs: number[] = [];
      for (const kid of kidEls) {
        const box = kid.querySelector(':scope > .occ__br > am-org-chart-box')!;
        const up = stubX(kid, '::after', rtl);
        xs.push(up);
        worst = Math.max(worst, Math.abs(up - centre(box)));
        worst = Math.max(worst, Math.abs(rect(box).top - (rect(kid).top + CONNECTOR.stub)));
        checked++;
      }
      if (kidEls.length > 1) {
        // The bar runs between the outermost children's stubs, and the parent's stub lands on it.
        const bars = kidEls.map((k) => {
          const s = getComputedStyle(k, '::before');
          const r = rect(k);
          return { from: r.left + parseFloat(s.left), to: r.right - parseFloat(s.right) };
        });
        const from = Math.min(...bars.map((b) => b.from));
        const to = Math.max(...bars.map((b) => b.to));
        if (Math.abs(from - Math.min(...xs)) > 1 || Math.abs(to - Math.max(...xs)) > 1 || down < from - 1 || down > to + 1) barMisses++;
      }
    }
    return { worst: Math.round(worst * 100) / 100, checked, barMisses };
  }

  const EXPECT = {
    en: { 1: [210, 96], 2: [210, 96], 3: [180, 84], 4: [180, 84], tall: 118 },
    ar: { 1: [210, 112], 2: [210, 112], 3: [190, 96], 4: [190, 96], tall: 134 },
  } as const;

  for (const lang of ['en', 'ar'] as const) {
    for (const tall of [false, true]) {
      it(`${lang}, 988: box sizes per level${tall ? ' (level 4 tall)' : ''}, level rows, connectors within 1px`, async () => {
        const { frame } = await render(lang, 988, () => uneven(tall));
        const all = boxes(frame);
        // Non-vacuity: 15 boxes, laid out, at distinct positions.
        expect(all.length).toBe(15);
        const lefts = new Set(all.map((b) => Math.round(rect(b).left)));
        expect(lefts.size).toBeGreaterThan(8);
        expect(all.every((b) => rect(b).width > 100 && rect(b).height > 50)).toBeTrue();

        const byLevel = new Map<number, HTMLElement[]>();
        for (const b of all) byLevel.set(Number(b.dataset['level']), [...(byLevel.get(Number(b.dataset['level'])) ?? []), b]);
        expect([...byLevel.keys()].sort()).toEqual([1, 2, 3, 4]);
        for (const [level, list] of byLevel) {
          const [w, h] = EXPECT[lang][level as 1 | 2 | 3 | 4];
          const height = tall && level === 4 ? EXPECT[lang].tall : h;
          for (const b of list) {
            expect(Math.round(rect(b).width)).withContext(`${b.dataset['box']} width`).toBe(w);
            expect(Math.round(rect(b).height)).withContext(`${b.dataset['box']} height`).toBe(height);
          }
          const tops = list.map((b) => rect(b).top);
          expect(Math.max(...tops) - Math.min(...tops)).withContext(`level ${level} row`).toBeLessThanOrEqual(1);
        }
        if (tall) {
          expect(frame.querySelector('[data-box="c1x"] [data-testid="box-below"]')).not.toBeNull();
          expect(frame.querySelector('[data-box="c1y"] [data-testid="box-below"]')).toBeNull();
        }
        // Gaps: 20 between the root's children, 14 elsewhere.
        const [a, b] = [frame.querySelector('[data-box="a"]')!, frame.querySelector('[data-box="b"]')!];
        const gap = (x: Element, y: Element) => (lang === 'ar' ? rect(x).left - rect(y).right : rect(y).left - rect(x).right);
        expect(Math.round(gap(a, b))).toBeGreaterThanOrEqual(CONNECTOR.gapUnderRoot);
        const [c1w, c1x] = [frame.querySelector('[data-box="c1w"]')!, frame.querySelector('[data-box="c1x"]')!];
        expect(Math.round(gap(c1w, c1x))).toBe(CONNECTOR.gap);

        const c = connectorOffsets(frame, lang === 'ar');
        expect(c.checked).toBe(5 + 14); // five parents, fourteen children
        expect(c.barMisses).toBe(0);
        expect(c.worst).toBeLessThanOrEqual(1);
        // RTL mirrors: the first child is on the right.
        expect(lang === 'ar' ? rect(a).left > rect(b).left : rect(a).left < rect(b).left).toBeTrue();
        // A clamped name keeps its whole text in the accessible name.
        const name = frame.querySelector<HTMLElement>('[data-box="a1x"] [data-testid="box-name"]')!;
        expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
        expect(frame.querySelector('[data-box="a1x"]')!.getAttribute('aria-label')).toContain(lang === 'ar' ? 'صيدلية المرضى المنومين وسلامة الأدوية a1x' : 'Inpatient Pharmacy and Medication Safety a1x');
        measured.push(`  ${lang} 988 ${tall ? 'tall' : 'flat'}: ${[...byLevel].map(([l, list]) => `L${l} ${Math.round(rect(list[0]!).width)}x${Math.round(rect(list[0]!).height)}`).join(', ')}; ${c.checked} connectors, worst ${c.worst}px`);

        // The panel: 280 wide, at the inline end, outside the sideways-scroll area.
        const panel = frame.querySelector('[data-testid="chart-panel"]')!;
        const scroll = frame.querySelector('[data-testid="chart-scroll"]')!;
        expect(Math.round(rect(panel).width)).toBe(PANEL_WIDTH);
        expect(scroll.contains(panel)).toBeFalse();
        expect(lang === 'ar' ? rect(panel).right <= rect(scroll).left + 1 : rect(panel).left >= rect(scroll).right - 1).toBeTrue();
        expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth);
      });
    }

    for (const width of [358, 328]) {
      it(`${lang}, ${width} (phone): the panel drops below as a full-width sheet; the chart scrolls inside its area, the page does not`, async () => {
        const { frame } = await render(lang, width, () => uneven(true), { phone: true, url: '/organization?view=chart&sel=a' });
        expect(boxes(frame).length).toBe(15);
        const panel = frame.querySelector('[data-testid="chart-panel"]')!;
        const scroll = frame.querySelector<HTMLElement>('[data-testid="chart-scroll"]')!;
        expect(rect(panel).top).toBeGreaterThanOrEqual(rect(scroll).bottom - 1);
        expect(Math.round(rect(panel).width)).toBe(Math.round(rect(scroll).width)); // the chart area's full width
        expect(rect(panel).width).toBeGreaterThanOrEqual(width - 2); // inside the card's 1px border
        expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth); // a wide chart, scrolling in its own area
        expect(frame.scrollWidth).toBeLessThanOrEqual(frame.clientWidth); // and never the page
        for (const el of Array.from(frame.querySelectorAll<HTMLElement>('[data-testid="chart-toolbar"], [data-testid="chart-panel"]'))) {
          expect(el.scrollWidth).withContext(el.dataset['testid']!).toBeLessThanOrEqual(el.clientWidth + 1);
        }
        const c = connectorOffsets(frame, lang === 'ar');
        expect(c.worst).toBeLessThanOrEqual(1);
        measured.push(`  ${lang} ${width} phone: panel ${Math.round(rect(panel).width)} below; chart ${scroll.scrollWidth} in ${scroll.clientWidth}; page ${frame.scrollWidth}/${frame.clientWidth}; worst ${c.worst}px`);
      });
    }
  }

  it('150 boxes: first render and a re-root, timed (no gate unless over 1s)', async () => {
    const first = await render('en', 988, (id) => big(id ?? 'r'));
    expect(boxes(first.frame).length).toBe(150);
    const c = connectorOffsets(first.frame, false);
    expect(c.worst).toBeLessThanOrEqual(1);
    const t0 = performance.now();
    await harness.navigateByUrl('/organization?view=chart&root=s');
    await settle();
    const reroot = performance.now() - t0;
    expect(boxes(first.frame).length).toBe(150);
    expect(first.frame.querySelector('[data-box="s"]')!.getAttribute('aria-level')).toBe('1');
    measured.push(`  150 boxes: first render ${Math.round(first.ms)}ms, re-root ${Math.round(reroot)}ms, ${c.checked} connectors, worst ${c.worst}px`);
    expect(first.ms).toBeLessThan(1000);
    expect(reroot).toBeLessThan(1000);
  });
});
