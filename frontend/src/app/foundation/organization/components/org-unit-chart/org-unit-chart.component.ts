import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  NgZone,
  afterNextRender,
  computed,
  effect,
  inject,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { TranslatePipe } from '@ngx-translate/core';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ADMIN_ACCESS } from '../../../../core/navigation/admin-access';
import { SHELL_PHONE_BELOW_PX } from '../../../../layout/app-shell/app-shell.component';
import { OrgChartResponseDto, OrgUnitService } from '../../services/org-unit.service';
import { OrgChartBoxComponent } from './org-chart-box.component';
import { OrgChartPanelComponent } from './org-chart-panel.component';
import { OrgChartToolbarComponent } from './org-chart-toolbar.component';
import { BOX, CHART_LEVELS, CONNECTOR, ChartBox, ChartKey, allBoxes, boxSize, buildChart, moveFocus } from './org-chart-model';

/** Zoom steps and limits; Fit never zooms in past 100%. */
export const CHART_ZOOM = { min: 0.3, max: 1.5, step: 0.1 } as const;

/** The docked side panel's width on desktop (OS L174). */
export const PANEL_WIDTH = 280;

/** Per-viewer preferences (D9): kept in this browser only, keyed by user. */
export const CHART_PREFS_PREFIX = 'am.orgChart.';

const KEYS: ReadonlySet<string> = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

type LoadState = 'loading' | 'error' | 'notFound' | 'ready';

/**
 * ACC-120 slice 11, PR E — `/organization?view=chart`, the chart (OS §2,
 * L161-233, L560-605). Our own component (D3, from the CC-136 test of
 * p-organizationChart, whose table layout put stubs up to 16px off a box's
 * centre and whose nested tables broke the ARIA tree).
 *
 * ## Structure
 *
 * A recursive flex tree. Each child's own wrapper draws its connectors with
 * logical properties: a half-width bar on the first and last child, a full
 * bar between, and a stub down to the box from the wrapper's centre — which IS
 * the box's centre, because the box is centred in its branch. So connectors
 * meet each box by construction, and mirror in Arabic with the row.
 *
 * ## The window
 *
 * Four levels from the root (the API caps it). The root is in the URL
 * (`?view=chart&root=<id>`), and the selection (`&sel=<id>`), so a reload or a
 * shared link shows the same window. Re-rooting is the level-4 button,
 * Shift+Enter, a "Showing from" link, or Show chart from here.
 *
 * ## Inside the scroll area
 *
 * No menus or popups (OS L571, artboard 7): the docked panel, outside it,
 * carries every action. Zoom is a CSS scale inside a wrapper sized to the
 * scaled chart, so the scroll area always measures what is drawn.
 */
@Component({
  selector: 'am-org-unit-chart',
  standalone: true,
  imports: [NgTemplateOutlet, RouterLink, TranslatePipe, OrgChartBoxComponent, OrgChartPanelComponent, OrgChartToolbarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block min-w-0', '[style]': 'cssVars()' },
  template: `
    <div class="block min-w-0 border border-rule rounded-card bg-surface-raised overflow-hidden" data-testid="chart">
      <am-org-chart-toolbar
        [path]="response()?.root?.path ?? []"
        [committeesAvailable]="canSeeCommittees()"
        [showCommittees]="showCommittees()"
        [canZoomIn]="zoom() < zoomMax"
        [canZoomOut]="zoom() > zoomMin"
        (reroot)="reroot($event)"
        (showCommitteesChange)="setShowCommittees($event)"
        (zoomIn)="setZoom(zoom() + zoomStep)"
        (zoomOut)="setZoom(zoom() - zoomStep)"
        (fit)="fit()"
      />

      @if (nobodyAssigned()) {
        <p class="m-0 px-3 py-2 border-b border-rule bg-surface text-meta text-ink-700" role="status" data-testid="chart-nobody">
          {{ 'organization.chart.nobodyAssigned' | translate }}
          @if (canOpenUsers()) {
            <a class="text-primary-700 font-semibold" routerLink="/users">{{ 'organization.record.openUsers' | translate }}</a>
          }
        </p>
      }

      <div class="occ__layout" [class.occ__layout--phone]="phone()" data-testid="chart-layout">
        <div class="occ__scroll" #scroll data-testid="chart-scroll">
          @switch (state()) {
            @case ('loading') {
              <p class="m-0 p-4 text-meta text-ink-500" role="status">{{ 'organization.chart.loading' | translate }}</p>
            }
            @case ('error') {
              <div class="p-4 text-meta" role="alert" data-testid="chart-error">
                <p class="m-0 text-ink-900">{{ 'organization.chart.loadFailed' | translate }}</p>
                <button type="button" class="occ__link" (click)="load()">{{ 'list.retry' | translate }}</button>
              </div>
            }
            @case ('notFound') {
              <div class="p-4 text-meta" role="alert" data-testid="chart-not-found">
                <p class="m-0 text-ink-900">{{ 'organization.chart.notFound' | translate }}</p>
                <button type="button" class="occ__link" (click)="reroot(null)">{{ 'organization.chart.showFromTop' | translate }}</button>
              </div>
            }
            @default {
              @if (model().root; as root) {
                <div class="occ__sizer" [style.width.px]="natural().w * zoom()" [style.height.px]="natural().h * zoom()">
                  <div
                    class="occ__zoom"
                    #zoomer
                    role="tree"
                    [attr.aria-label]="'organization.chart.treeLabel' | translate"
                    [style.transform]="'scale(' + zoom() + ')'"
                    (keydown)="onKey($event)"
                    data-testid="chart-tree"
                  >
                    <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: root }" />
                  </div>
                </div>
                @if (onlyRoot()) {
                  <p class="m-0 mt-3 text-meta text-ink-700 text-center" data-testid="chart-only-root">
                    @if (canManage()) {
                      <button type="button" class="occ__link" (click)="addUnder.emit(root.node.id)">
                        {{ 'organization.chart.addFirst' | translate: { unit: rootName() } }}
                      </button>
                    } @else {
                      {{ 'organization.chart.noUnitsYet' | translate: { unit: rootName() } }}
                    }
                  </p>
                }
              }
            }
          }
        </div>
        <am-org-chart-panel
          class="occ__panel"
          [node]="selectedBox()?.node ?? null"
          [showCommittees]="showCommittees()"
          (showFromHere)="reroot($event)"
          (findInTree)="findInTree($event)"
          data-testid="chart-panel"
        />
      </div>
    </div>

    <ng-template #branch let-b>
      <div class="occ__br">
        <am-org-chart-box
          [box]="b"
          [width]="size(b).width"
          [height]="size(b).height"
          [selected]="selectedId() === b.node.id"
          [focusable]="focusId() === b.node.id"
          [showCommittees]="showCommittees() && model().committeeLevels.has(b.level)"
          (click)="select(b.node.id)"
          (focusin)="focusId.set(b.node.id)"
          (reroot)="reroot(b.node.id)"
        />
        @if (b.children.length) {
          <div class="occ__kids" [class.occ__kids--root]="b.level === 1" role="group">
            @for (c of b.children; track c.node.id; let first = $first; let last = $last) {
              <div class="occ__kid" [class.occ__kid--first]="first" [class.occ__kid--last]="last" [class.occ__kid--only]="first && last">
                <ng-container [ngTemplateOutlet]="branch" [ngTemplateOutletContext]="{ $implicit: c }" />
              </div>
            }
          </div>
        }
      </div>
    </ng-template>
  `,
  styles: [
    `
      .occ__layout{display:grid;grid-template-columns:minmax(0,1fr) var(--occ-panel)}
      .occ__layout--phone{grid-template-columns:minmax(0,1fr)}
      .occ__scroll{min-inline-size:0;overflow-x:auto;overflow-y:hidden;padding:var(--am-space-16) var(--am-space-16) var(--am-space-20);background:var(--am-surface)}
      .occ__panel{border-inline-start:1px solid var(--am-border)}
      .occ__layout--phone .occ__panel{border-inline-start:0;border-block-start:1px solid var(--am-border)}
      .occ__sizer{margin-inline:auto}
      .occ__zoom{inline-size:max-content;transform-origin:top left}
      :host-context([dir=rtl]) .occ__zoom{transform-origin:top right}
      .occ__br{display:flex;flex-direction:column;align-items:center}
      .occ__kids{position:relative;display:flex;align-items:flex-start;justify-content:center;padding-block-start:var(--occ-stub)}
      .occ__kids::before,.occ__kid::after{content:'';position:absolute;inset-block-start:0;inset-inline-start:calc(50% - 0.5px);inline-size:1px;block-size:var(--occ-stub);background:var(--am-ink-300)}
      .occ__kid{position:relative;padding-block-start:var(--occ-stub);padding-inline:calc(var(--occ-gap) / 2)}
      .occ__kids--root>.occ__kid{padding-inline:calc(var(--occ-gap-root) / 2)}
      .occ__kid::before{content:'';position:absolute;inset-block-start:0;inset-inline:0;block-size:1px;background:var(--am-ink-300)}
      .occ__kid--first::before{inset-inline-start:50%}
      .occ__kid--last::before{inset-inline-end:50%}
      .occ__kid--only::before{display:none}
      .occ__link{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .occ__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class OrgUnitChartComponent implements AfterViewInit {
  private readonly orgUnits = inject(OrgUnitService);
  private readonly language = inject(LanguageService);
  private readonly access = inject(NavigationAccessService);
  private readonly auth = inject(AuthService, { optional: true });
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly zone = inject(NgZone);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);

  /** "Add the first unit under …" (OS L574): the page owns the Add dialog. */
  readonly addUnder = output<string>();

  readonly scroll = viewChild<ElementRef<HTMLElement>>('scroll');
  readonly zoomer = viewChild<ElementRef<HTMLElement>>('zoomer');

  protected readonly zoomMin = CHART_ZOOM.min;
  protected readonly zoomMax = CHART_ZOOM.max;
  protected readonly zoomStep = CHART_ZOOM.step;

  private readonly params = toSignal(this.route.queryParamMap.pipe(map((p) => ({ root: p.get('root'), sel: p.get('sel') }))), {
    initialValue: { root: this.route.snapshot.queryParamMap.get('root'), sel: this.route.snapshot.queryParamMap.get('sel') },
  });
  readonly rootParam = computed(() => this.params().root);

  readonly response = signal<OrgChartResponseDto | null>(null);
  readonly state = signal<LoadState>('loading');
  readonly model = computed(() => (this.response() ? buildChart(this.response()!) : buildChart({ root: { id: '', path: [] }, depth: CHART_LEVELS, nodes: [], asOf: '' })));
  readonly selectedId = computed(() => this.params().sel);
  readonly selectedBox = computed(() => {
    const id = this.selectedId();
    return id ? (this.model().byId.get(id) ?? null) : null;
  });
  readonly focusId = signal<string | null>(null);
  readonly zoom = signal(1);
  readonly natural = signal({ w: 0, h: 0 });
  readonly phone = signal(false);
  private readonly committeesPref = signal(false);

  readonly isRtl = computed(() => this.language.isRtl());
  readonly canManage = computed(() => this.access.hasPermission('org:manage'));
  readonly canOpenUsers = computed(() => this.access.hasPermission(ADMIN_ACCESS) && this.access.hasPermission('users:view'));
  /** D7: committees only with committees:view, so the switch is absent without it. */
  readonly canSeeCommittees = computed(() => this.access.hasPermission('committees:view'));
  readonly showCommittees = computed(() => this.canSeeCommittees() && this.committeesPref());

  readonly cssVars = computed(() => ({
    '--occ-stub': `${CONNECTOR.stub}px`,
    '--occ-gap': `${CONNECTOR.gap}px`,
    '--occ-gap-root': `${CONNECTOR.gapUnderRoot}px`,
    '--occ-panel': `${PANEL_WIDTH}px`,
    '--ocb-below': `${BOX.belowButton + (this.isRtl() ? BOX.arPerLine : 0)}px`,
    '--ocb-below-gap': `${BOX.belowGap}px`,
  }));

  readonly rootName = computed(() => {
    const r = this.model().root?.node;
    return r ? this.language.bilingual(r.nameEn, r.nameAr) : '';
  });

  /** The tenant's top unit is the root (the path is just itself). */
  private readonly atTop = computed(() => (this.response()?.root.path.length ?? 0) === 1);
  /** OS L574: a tenant that has assigned no one. */
  readonly nobodyAssigned = computed(() => this.state() === 'ready' && this.atTop() && allBoxes(this.model()).every((b) => b.node.headcount === 0));
  /** OS L574: a tenant with only its root. */
  readonly onlyRoot = computed(() => {
    const r = this.model().root;
    return !!r && this.atTop() && r.children.length === 0 && r.node.childCount === 0;
  });

  constructor() {
    this.restorePrefs();
    effect(() => {
      this.rootParam();
      untracked(() => this.load());
    });
    // A new window, a zoom or a language switch: keep the root in view (in
    // Arabic the scroll origin is the right edge, so a scaled chart would
    // otherwise sit out of sight).
    effect(() => {
      this.zoom();
      this.isRtl();
      this.natural();
      if (this.state() === 'ready') untracked(() => afterNextRender(() => this.revealRoot(), { injector: this.injector }));
    });
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent) => this.zone.run(() => this.phone.set(e.matches));
      media.addEventListener('change', onChange);
      this.destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  ngAfterViewInit(): void {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => this.zone.run(() => this.measure()));
    // The tree's element is recreated with each window; observe whichever is current.
    effect(
      () => {
        const el = this.zoomer()?.nativeElement;
        observer.disconnect();
        if (el) {
          observer.observe(el);
          this.measure();
        }
      },
      { injector: this.injector },
    );
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private measure(): void {
    const el = this.zoomer()?.nativeElement;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w !== this.natural().w || h !== this.natural().h) this.natural.set({ w, h });
  }

  load(): void {
    const rootId = this.rootParam() ?? undefined;
    this.state.set('loading');
    this.orgUnits.getChart({ rootId, depth: CHART_LEVELS }).subscribe({
      next: (res) => {
        if ((this.rootParam() ?? undefined) !== rootId) return;
        this.response.set(res);
        this.state.set('ready');
        const sel = this.selectedId();
        this.focusId.set(sel && this.model().byId.has(sel) ? sel : res.root.id);
      },
      error: (err: unknown) => {
        if ((this.rootParam() ?? undefined) !== rootId) return;
        this.state.set(err instanceof HttpErrorResponse && err.status === 404 && rootId ? 'notFound' : 'error');
      },
    });
  }

  size(b: ChartBox): { width: number; height: number } {
    const m = this.model();
    return boxSize(b.level, this.isRtl(), {
      tall: m.tallLevels.has(b.level),
      committees: this.showCommittees() && m.committeeLevels.has(b.level),
    });
  }

  /** Selecting the selected box keeps it selected: a click never deselects. */
  select(id: string): void {
    this.focusId.set(id);
    if (this.selectedId() === id) return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { sel: id }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** A new root; null is the tenant's top unit. History keeps each window. */
  reroot(id: string | null): void {
    if (id && id === this.response()?.root.id && this.state() === 'ready') return;
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'chart', root: id }, queryParamsHandling: 'merge' });
  }

  findInTree(id: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { view: 'tree', show: id }, queryParamsHandling: 'merge' });
  }

  onKey(e: KeyboardEvent): void {
    const from = this.focusId() ?? this.model().root?.node.id;
    if (!from) return;
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      this.reroot(from);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      this.select(from);
      return;
    }
    if (!KEYS.has(e.key)) return;
    e.preventDefault();
    const next = moveFocus(this.model(), from, e.key as ChartKey, this.isRtl());
    if (!next) return;
    this.focusId.set(next);
    afterNextRender(() => this.boxEl(next)?.focus(), { injector: this.injector });
  }

  setZoom(z: number): void {
    const next = Math.min(CHART_ZOOM.max, Math.max(CHART_ZOOM.min, Math.round(z * 100) / 100));
    this.zoom.set(next);
    this.savePrefs();
  }

  /** The whole chart in the area's width, never above 100%. */
  fit(): void {
    const area = this.scroll()?.nativeElement;
    const w = this.natural().w;
    if (!area || !w) return;
    const style = getComputedStyle(area);
    const inner = area.clientWidth - parseFloat(style.paddingInlineStart || '0') - parseFloat(style.paddingInlineEnd || '0');
    this.setZoom(Math.floor(Math.min(1, inner / w) * 100) / 100);
  }

  setShowCommittees(on: boolean): void {
    this.committeesPref.set(on);
    this.savePrefs();
  }

  private boxEl(id: string): HTMLElement | null {
    return this.zoomer()?.nativeElement.querySelector<HTMLElement>(`[data-box="${CSS.escape(id)}"]`) ?? null;
  }

  /** Scroll the area so the root box is centred (or as near as the content allows). */
  private revealRoot(): void {
    const area = this.scroll()?.nativeElement;
    const rootId = this.model().root?.node.id;
    const box = rootId ? this.boxEl(rootId) : null;
    if (!area || !box) return;
    const a = area.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    area.scrollBy({ left: b.left + b.width / 2 - (a.left + a.width / 2) });
  }

  // ── preferences, per viewer (D9) ──────────────────────────────────────────

  private prefsKey(): string | null {
    const id = this.auth?.currentUser()?.id;
    return id ? `${CHART_PREFS_PREFIX}${id}` : null;
  }

  private restorePrefs(): void {
    const key = this.prefsKey();
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const p = JSON.parse(raw) as { zoom?: unknown; committees?: unknown };
      if (typeof p.zoom === 'number') this.zoom.set(Math.min(CHART_ZOOM.max, Math.max(CHART_ZOOM.min, p.zoom)));
      if (typeof p.committees === 'boolean') this.committeesPref.set(p.committees);
    } catch {
      // No storage, or a value we cannot read: the defaults.
    }
  }

  private savePrefs(): void {
    const key = this.prefsKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify({ zoom: this.zoom(), committees: this.committeesPref() }));
    } catch {
      // Storage refused: the preference lasts this visit.
    }
  }
}
