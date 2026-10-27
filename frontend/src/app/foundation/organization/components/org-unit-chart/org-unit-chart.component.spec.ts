import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';
import { providePrimeNG } from 'primeng/config';
import { Observable, of, throwError } from 'rxjs';
import en from '../../../../../assets/i18n/en.json';
import ar from '../../../../../assets/i18n/ar.json';
import { loadTranslationsForTest, provideFormatTesting } from '../../../../core/formatting/testing';
import { AuthService } from '../../../../core/services/auth.service';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { preserveDocumentLanguage } from '../../../../../testing/document-language';
import { OrgChartResponseDto, OrgUnitService, OrgUnitSummaryDto } from '../../services/org-unit.service';
import { CHART_PREFS_PREFIX, OrgUnitChartComponent } from './org-unit-chart.component';
import { chartFixture, chartNode } from './org-chart-model.spec';

// ACC-120 slice 11, PR E — the chart as each viewer sees it: the keyboard in
// both directions, selection, re-rooting three ways (the level-4 button,
// Shift+Enter, a path link), the depth-6 fixture's heights, D7 inside the
// boxes and the panel, and the empty cases.

@Component({ standalone: true, imports: [OrgUnitChartComponent], template: '<am-org-unit-chart />' })
class HostComponent {}

const USER = 'u-hessa';
const ALL = ['org:view', 'org:manage', 'users:view', 'committees:view', 'setup:view', 'admin:access'];

function summaryFor(id: string): OrgUnitSummaryDto {
  return {
    unit: { ...chartNode(id, null, 0), description: null, createdAt: '', updatedAt: '' },
    path: [],
    children: [],
    positions: [{ positionId: 'p1', nameEn: 'Director', nameAr: 'مدير', grade: 10, isUnitHeadPosition: true, count: 1 }],
    people: [],
    committees: { count: 1, items: [{ id: 'cm', nameEn: 'P&T', nameAr: null, stageNameEn: 'Active', stageNameAr: null }] },
    asOf: '',
  };
}

/** The depth-6 tree behind the window: the API cuts it at four levels from whatever root. */
function windowFrom(rootId: string | undefined): OrgChartResponseDto {
  const f = chartFixture();
  if (!rootId || rootId === 'root') return f;
  if (rootId === 'a1x') {
    return {
      root: { id: 'a1x', path: [...f.root.path, { id: 'a', nameEn: 'a', nameAr: null }, { id: 'a1', nameEn: 'a1', nameAr: null }, { id: 'a1x', nameEn: 'a1x', nameAr: null }] },
      depth: 4,
      asOf: '',
      nodes: [chartNode('a1x', 'a1', 0, { childCount: 3 }), chartNode('d1', 'a1x', 1), chartNode('d2', 'a1x', 1), chartNode('d3', 'a1x', 1)],
    };
  }
  const box = f.nodes.find((n) => n.id === rootId)!;
  return { root: { id: rootId, path: [...f.root.path, { id: rootId, nameEn: rootId, nameAr: null }] }, depth: 4, asOf: '', nodes: [{ ...box, depth: 0 }] };
}

describe('OrgUnitChartComponent (ACC-120 slice 11, PR E)', () => {
  preserveDocumentLanguage();

  let permissions: string[];
  let chartCalls: Array<string | undefined>;
  let chart: (rootId: string | undefined) => Observable<OrgChartResponseDto>;

  async function render(opts: { perms?: string[]; lang?: 'en' | 'ar'; url?: string; chart?: (rootId: string | undefined) => Observable<OrgChartResponseDto> } = {}) {
    permissions = opts.perms ?? ALL;
    chartCalls = [];
    chart = opts.chart ?? ((id) => of(windowFrom(id)));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'organization', component: HostComponent },
          { path: '**', component: HostComponent },
        ]),
        provideNoopAnimations(),
        provideTranslateService({ lang: 'en' }),
        provideFormatTesting(),
        providePrimeNG({}),
        { provide: NavigationAccessService, useValue: { hasPermission: (p: string) => permissions.includes(p) } },
        { provide: AuthService, useValue: { currentUser: () => ({ id: USER, email: 'h@x', name: 'Hessa' }) } },
        {
          provide: OrgUnitService,
          useValue: {
            getChart: (o: { rootId?: string }) => {
              chartCalls.push(o.rootId);
              return chart(o.rootId);
            },
            getSummary: (id: string) => of(summaryFor(id)),
          },
        },
      ],
    });
    loadTranslationsForTest({ en, ar });
    TestBed.inject(TranslateService).use(opts.lang ?? 'en');
    TestBed.inject(LanguageService).use(opts.lang ?? 'en');
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(opts.url ?? '/organization?view=chart');
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    return { harness, el: harness.routeNativeElement as HTMLElement };
  }

  beforeEach(() => {
    try {
      localStorage.removeItem(`${CHART_PREFS_PREFIX}${USER}`);
    } catch {
      /* no storage */
    }
  });
  afterEach(() => TestBed.resetTestingModule());

  const box = (el: HTMLElement, id: string) => el.querySelector<HTMLElement>(`[data-box="${id}"]`)!;
  const url = () => TestBed.inject(Router).url;
  const settle = async (h: RouterTestingHarness) => {
    await h.fixture.whenStable();
    h.detectChanges();
    await h.fixture.whenStable();
    h.detectChanges();
  };
  const key = async (h: RouterTestingHarness, el: HTMLElement, k: string, shift = false) => {
    el.querySelector('[role="tree"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true }));
    await settle(h);
  };
  const focused = () => (document.activeElement as HTMLElement | null)?.getAttribute('data-box');

  it('the window: a tree of treeitems, one tab stop, the root path in the toolbar', async () => {
    const { el } = await render();
    expect(el.querySelector('[role="tree"]')).not.toBeNull();
    expect(el.querySelectorAll('[role="treeitem"]').length).toBe(8);
    expect(el.querySelectorAll('[role="treeitem"][tabindex="0"]').length).toBe(1);
    expect(box(el, 'root').getAttribute('tabindex')).toBe('0');
    expect(el.querySelectorAll('[role="group"]').length).toBe(4);
    expect(el.querySelector('[data-testid="chart-path-current"]')!.textContent!.trim()).toBe('Root');
    expect(el.querySelectorAll('[data-testid="chart-path"] button[data-path]').length).toBe(1);
    // A slash, never a chevron: it reads the right way in both directions.
    expect(Array.from(el.querySelectorAll('[data-testid="chart-path-sep"]')).map((s) => s.textContent!.trim())).toEqual(['/']);
    expect(box(el, 'a1x').getAttribute('aria-level')).toBe('4');
    expect(box(el, 'b').getAttribute('aria-posinset')).toBe('2');
    expect(box(el, 'b').getAttribute('aria-setsize')).toBe('3');
  });

  it('keyboard, LTR: arrows in visual direction; Enter selects; Enter again keeps it selected', async () => {
    const { harness, el } = await render();
    box(el, 'root').focus();
    await key(harness, el, 'ArrowDown');
    expect(focused()).toBe('a');
    await key(harness, el, 'ArrowRight');
    expect(focused()).toBe('b');
    await key(harness, el, 'ArrowRight');
    expect(focused()).toBe('c');
    await key(harness, el, 'ArrowRight');
    expect(focused()).toBe('c');
    await key(harness, el, 'ArrowLeft');
    expect(focused()).toBe('b');
    await key(harness, el, 'ArrowUp');
    expect(focused()).toBe('root');
    expect(el.querySelectorAll('[role="treeitem"][tabindex="0"]').length).toBe(1);
    await key(harness, el, 'ArrowDown');
    await key(harness, el, 'Enter');
    expect(url()).toContain('sel=a');
    expect(box(el, 'a').getAttribute('aria-selected')).toBe('true');
    expect(el.querySelector('[data-testid="panel-name"]')!.textContent!.trim()).toBe('a');
    await key(harness, el, 'Enter');
    expect(box(el, 'a').getAttribute('aria-selected')).toBe('true');
  });

  it('keyboard, RTL: Right is the previous sibling, Left the next', async () => {
    const { harness, el } = await render({ lang: 'ar' });
    box(el, 'root').focus();
    await key(harness, el, 'ArrowDown');
    await key(harness, el, 'ArrowLeft');
    expect(focused()).toBe('b');
    await key(harness, el, 'ArrowLeft');
    expect(focused()).toBe('c');
    await key(harness, el, 'ArrowRight');
    expect(focused()).toBe('b');
    await key(harness, el, 'ArrowRight');
    expect(focused()).toBe('a');
  });

  it('a click selects; a click on the selected box keeps it selected', async () => {
    const { harness, el } = await render();
    box(el, 'b').click();
    await settle(harness);
    expect(url()).toContain('sel=b');
    box(el, 'b').click();
    await settle(harness);
    expect(url()).toContain('sel=b');
    expect(box(el, 'b').classList).toContain('ocb--selected');
  });

  it('re-root by the level-4 button: the window, the URL and the path follow', async () => {
    const { harness, el } = await render();
    const button = box(el, 'a1x').querySelector<HTMLButtonElement>('[data-testid="box-below"]')!;
    expect(button.textContent!.trim()).toBe('3 sub-units below · show from here');
    expect(button.getAttribute('tabindex')).toBe('-1');
    button.click();
    await settle(harness);
    expect(url()).toContain('root=a1x');
    expect(chartCalls.at(-1)).toBe('a1x');
    expect(box(el, 'a1x').getAttribute('aria-level')).toBe('1');
    expect(el.querySelectorAll('[data-testid="chart-path"] button[data-path]').length).toBe(4);
    expect(el.querySelector('[data-testid="chart-path-current"]')!.textContent!.trim()).toBe('a1x');
  });

  it('re-root by Shift+Enter on the focused box, and back by a path link', async () => {
    const { harness, el } = await render();
    box(el, 'root').focus();
    await key(harness, el, 'ArrowDown');
    await key(harness, el, 'ArrowDown');
    await key(harness, el, 'ArrowDown');
    expect(focused()).toBe('a1x');
    await key(harness, el, 'Enter', true);
    expect(url()).toContain('root=a1x');
    const link = el.querySelector<HTMLButtonElement>('[data-testid="chart-path"] button[data-path="root"]')!;
    link.click();
    await settle(harness);
    expect(url()).toContain('root=root');
    expect(box(el, 'root').getAttribute('aria-level')).toBe('1');
  });

  it('a shared link opens the same window and selection', async () => {
    const { el } = await render({ url: '/organization?view=chart&root=a1x&sel=d2' });
    expect(chartCalls).toEqual(['a1x']);
    expect(box(el, 'd2').getAttribute('aria-selected')).toBe('true');
    expect(box(el, 'd2').getAttribute('tabindex')).toBe('0');
  });

  it('the depth-6 fixture: a tall level is 118 for every box on it; a level without the button is 84', async () => {
    const { el } = await render();
    const h = (id: string) => box(el, id).style.height;
    expect(h('a1x')).toBe('118px'); // level 4, with the button
    expect(h('c1')).toBe('118px'); // level 3, with the button
    expect(h('a1')).toBe('118px'); // level 3, no button: the row takes the tallest
    expect(h('a2')).toBe('118px');
    expect(h('a')).toBe('96px');
    expect(box(el, 'a1').querySelector('[data-testid="box-below"]')).toBeNull();
    TestBed.resetTestingModule();
    const flat = await render({ chart: () => of({ ...chartFixture(), nodes: chartFixture().nodes.map((n) => ({ ...n, childCount: n.id === 'a1x' || n.id === 'c1' ? 0 : n.childCount })) }) });
    expect(box(flat.el, 'a1x').style.height).toBe('84px');
  });

  describe('D7', () => {
    it('without users:view: the position title stands in, no initials, no person link in the panel', async () => {
      const res = chartFixture();
      res.nodes[0] = { ...res.nodes[0]!, heads: [{ userId: 'h', name: null, positionId: 'p', positionNameEn: 'Director', positionNameAr: 'مدير', role: 'substantive', countedHere: true }] };
      const { harness, el } = await render({ perms: ['org:view'], chart: () => of(res) });
      expect(box(el, 'root').querySelector('[data-testid="box-head"]')!.textContent!.trim()).toBe('Director');
      expect(box(el, 'root').querySelector('.ocb__av')!.textContent!.trim()).toBe('');
      box(el, 'root').click();
      await settle(harness);
      expect(el.querySelector('[data-testid="panel-head"] a')).toBeNull();
    });

    it('a named head links to the person only with admin:access AND users:view', async () => {
      const res = chartFixture();
      res.nodes[0] = { ...res.nodes[0]!, heads: [{ userId: 'h', name: 'Dr. Fahad', positionId: 'p', positionNameEn: 'Director', positionNameAr: null, role: 'substantive', countedHere: true }] };
      const both = await render({ chart: () => of(res), url: '/organization?view=chart&sel=root' });
      expect(both.el.querySelector('[data-testid="panel-head"] a')!.getAttribute('href')).toBe('/users/h');
      expect(box(both.el, 'root').querySelector('.ocb__av')!.textContent!.trim()).toBe('F'); // titles skipped
      TestBed.resetTestingModule();
      const noAdmin = await render({ perms: ['org:view', 'users:view'], chart: () => of(res), url: '/organization?view=chart&sel=root' });
      expect(noAdmin.el.querySelector('[data-testid="panel-head"]')!.textContent).toContain('Dr. Fahad');
      expect(noAdmin.el.querySelector('[data-testid="panel-head"] a')).toBeNull();
    });

    it('without committees:view: no "Show committees" switch, and no committees line — even with it saved as on', async () => {
      localStorage.setItem(`${CHART_PREFS_PREFIX}${USER}`, JSON.stringify({ zoom: 1, committees: true }));
      const { el } = await render({ perms: ['org:view', 'users:view'] });
      expect(el.querySelector('[data-testid="chart-committees"]')).toBeNull();
      expect(el.querySelector('[data-testid="box-committees"]')).toBeNull();
    });

    it('with it: the switch shows "◇ N committees" on the owning box, raises its level, and is remembered per user', async () => {
      const { harness, el } = await render();
      const input = el.querySelector<HTMLInputElement>('[data-testid="chart-committees"] input')!;
      input.click();
      await settle(harness);
      expect(box(el, 'b').querySelector('[data-testid="box-committees"]')!.textContent!.trim()).toBe('◇ 2 committees');
      expect(box(el, 'b').style.height).toBe('125px');
      expect(box(el, 'a').style.height).toBe('125px');
      expect(JSON.parse(localStorage.getItem(`${CHART_PREFS_PREFIX}${USER}`)!).committees).toBe(true);
    });

    it('without setup:view: no attention chip (the API omits it)', async () => {
      const res = chartFixture();
      res.nodes[1] = { ...res.nodes[1]!, attention: { code: 'ORG_UNIT_WITHOUT_HEAD', severity: 'AT_RISK', since: '2026-10-01T09:00:00.000Z', openCount: 1 } };
      const withIt = await render({ chart: () => of(res) });
      expect(box(withIt.el, 'a').querySelector('[data-testid="box-chip"]')!.textContent!.trim()).toBe('▲ No head');
      TestBed.resetTestingModule();
      const without = await render({ perms: ['org:view', 'users:view'] });
      expect(without.el.querySelector('[data-testid="box-chip"]')).toBeNull();
    });
  });

  describe('the empty cases (OS L574)', () => {
    it('no head: a dashed avatar and "No head"; no people: "No one assigned"', async () => {
      const res = chartFixture();
      res.nodes[5] = { ...res.nodes[5]!, headcount: 0 };
      const { el } = await render({ chart: () => of(res) });
      expect(box(el, 'b').querySelector('.ocb__av--none')).not.toBeNull();
      expect(box(el, 'b').querySelector('[data-testid="box-head"]')!.textContent!.trim()).toBe('No head');
      expect(box(el, 'b').querySelector('[data-testid="box-people"]')!.textContent!.trim()).toBe('No one assigned');
    });

    it('nobody assigned anywhere: one strip above the chart, with a link to Users', async () => {
      const res = chartFixture();
      res.root.path = [{ id: 'root', nameEn: 'Root', nameAr: null }];
      res.nodes = res.nodes.map((n) => ({ ...n, headcount: 0 }));
      const { el } = await render({ chart: () => of(res) });
      expect(el.querySelector('[data-testid="chart-nobody"]')!.textContent).toContain('Nobody is assigned to a unit yet.');
      expect(el.querySelector('[data-testid="chart-nobody"] a')!.getAttribute('href')).toBe('/users');
    });

    it('only the root: "Add the first unit under …" for a manager, a sentence for anyone else', async () => {
      const only = (): Observable<OrgChartResponseDto> => of({ root: { id: 'root', path: [{ id: 'root', nameEn: 'Root', nameAr: null }] }, depth: 4, asOf: '', nodes: [chartNode('root', null, 0)] });
      const m = await render({ chart: only });
      expect(m.el.querySelector('[data-testid="chart-only-root"] button')!.textContent!.trim()).toBe('Add the first unit under root');
      TestBed.resetTestingModule();
      const r = await render({ perms: ['org:view'], chart: only });
      expect(r.el.querySelector('[data-testid="chart-only-root"]')!.textContent!.trim()).toBe('No units under root yet.');
    });

    it('a root that is not on the chart (deactivated): the message, and Show from the top', async () => {
      const { harness, el } = await render({ url: '/organization?view=chart&root=gone', chart: (id) => (id === 'gone' ? throwError(() => new HttpErrorResponse({ status: 404 })) : of(windowFrom(id))) });
      expect(el.querySelector('[data-testid="chart-not-found"]')).not.toBeNull();
      el.querySelector<HTMLButtonElement>('[data-testid="chart-not-found"] button')!.click();
      await settle(harness);
      expect(url()).not.toContain('root=');
      expect(box(el, 'root')).not.toBeNull();
    });
  });

  it('the panel: names, head, positions from the summary, Open unit, Show chart from here, Find in tree', async () => {
    const { harness, el } = await render();
    expect(el.querySelector('[data-testid="panel-empty"]')).not.toBeNull();
    box(el, 'c').click();
    await settle(harness);
    expect(el.querySelector('[data-testid="panel-name"]')!.textContent!.trim()).toBe('c');
    expect(el.querySelectorAll('[data-testid="panel-position"]').length).toBe(1);
    expect(el.querySelector('[data-testid="panel-open"]')!.getAttribute('href')).toBe('/organization/units/c');
    el.querySelector<HTMLButtonElement>('[data-testid="panel-show-from-here"]')!.click();
    await settle(harness);
    expect(url()).toContain('root=c');
    el.querySelector<HTMLButtonElement>('[data-testid="panel-find-in-tree"]')!.click();
    await settle(harness);
    expect(url()).toContain('view=tree');
    expect(url()).toContain('show=c');
  });

  it('zoom: the buttons scale the chart inside a sized wrapper, and the zoom is remembered per user', async () => {
    const { harness, el } = await render();
    el.querySelector<HTMLButtonElement>('[data-testid="chart-zoom-out"]')!.click();
    await settle(harness);
    expect(el.querySelector<HTMLElement>('[data-testid="chart-tree"]')!.style.transform).toBe('scale(0.9)');
    expect(JSON.parse(localStorage.getItem(`${CHART_PREFS_PREFIX}${USER}`)!).zoom).toBe(0.9);
  });
});
