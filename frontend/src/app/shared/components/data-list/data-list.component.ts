import {
  Component,
  TemplateRef,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { IListQuery } from '../../models/paginated-response';
import { DataListSource } from './data-list.source';
import {
  readPreferences,
  readUrlParams,
  urlParamsFor,
  writePreferences,
} from './data-list.persistence';

export interface DataListSortOption {
  // Column name. Server-backed lists must use a column the endpoint's sort
  // whitelist accepts — an unknown one is a 400, not a silent reorder.
  column: string;
  // Already-translated label. Not a key: a sort option may name tenant-editable
  // data, which SYSTEM-REFERENCE §9.3 requires be rendered by isArabic()
  // selection rather than `| translate`.
  label: string;
  dir?: 'asc' | 'desc';
}

export interface DataListScope {
  key: string;
  label: string;
  count?: number;
}

// ACC-78 — below this many rows the toolbar does not render.
//
// The reference says "~12". Named rather than inlined because it is a product
// rule, not a magic number: it is the point at which a reader stops scanning a
// list and starts searching it. Changing it is a deliberate act, and every
// table in the app moves together.
export const TOOLBAR_ROW_THRESHOLD = 12;

// The width at which a row may promote a field out of its second line into its
// own column. Consumers query it themselves — see the note on the body's
// @container below — so this exists to keep every table using the same
// breakpoint rather than each picking its own.
export const ROW_WIDE_BREAKPOINT_PX = 520;

// ACC-78 — the shared list. Built against
// frontend/design-reference/AccreditMe Users List.dc.html and
// .../AccreditMe Compact List Panel.dc.html.
//
// ONE component for the full page and the record-panel, not a page component
// with a stripped-down sibling. The compact reference is explicit about why
// that works: the controls respond to HOW MUCH DATA THERE IS, not to where the
// component is mounted. A panel holding 19 tasks gets search and sort; a page
// holding 9 rows would not. Set size is the variable, context is not — which
// makes a single component the honest implementation rather than a clever one.
// See TOOLBAR_ROW_THRESHOLD and the body @container for the two responses that
// implement it.
//
// ROWS ARE PROJECTED, NOT CONFIGURED. A column-config API would be a small
// framework, and the three proving tables have nothing structurally in common:
// Users is seven columns, Members is an avatar plus two lines, Workflow Stages
// is an expandable row containing two further tables. TemplateRef +
// ngTemplateOutlet is also the pattern ACC-29 proved safe here — content
// projection alone does NOT recreate a projected child, verified then against
// real TestBed behaviour rather than documentation.
@Component({
  selector: 'app-data-list',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
  ],
  template: `
    <div class="flex flex-col min-w-0">
      @if (showToolbar()) {
        <div
          class="flex items-center gap-1.5 px-2.5 py-2 border-b border-[var(--am-border)] bg-[var(--am-surface)]"
        >
          <div class="relative flex items-center flex-1 min-w-0">
            <i
              class="pi pi-search absolute text-xs text-[var(--am-text-secondary)] pointer-events-none"
              style="inset-inline-start: 8px"
            ></i>
            <input
              type="search"
              class="w-full text-xs rounded border border-[var(--am-border)] bg-[var(--am-card)] py-1.5 pe-2"
              style="padding-inline-start: 26px"
              [placeholder]="searchPlaceholder()"
              [value]="query().search ?? ''"
              (input)="onSearch($event)"
            />
          </div>

          @if (sortOptions().length > 0) {
            <!-- A sort MENU, not clickable column headers. The panel has no
                 header row to click, and two or three sensible keys beat
                 seven sortable columns most of which nobody sorts by. -->
            <p-button
              size="small"
              [outlined]="true"
              [label]="activeSortLabel()"
              icon="pi pi-chevron-down"
              iconPos="right"
              (onClick)="sortMenuOpen.set(!sortMenuOpen())"
            />
          }
        </div>

        @if (sortMenuOpen()) {
          <div class="flex flex-col border-b border-[var(--am-border)] bg-[var(--am-card)] p-1">
            @for (option of sortOptions(); track option.column) {
              <button
                type="button"
                class="text-start text-xs px-2 py-1.5 rounded hover:bg-[var(--am-surface)]"
                [class.font-semibold]="query().sortBy === option.column"
                (click)="onSort(option)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        }
      }

      @if (scopes().length > 0) {
        <div class="flex items-center gap-1 px-2.5 py-1.5 border-b border-[var(--am-border)]">
          @for (scope of scopes(); track scope.key) {
            <button
              type="button"
              class="rounded-full border px-2.5 py-0.5 text-[11.5px] whitespace-nowrap"
              [class.font-semibold]="activeScope() === scope.key"
              [style.border-color]="
                activeScope() === scope.key ? 'var(--am-blue-primary)' : 'var(--am-border)'
              "
              [style.color]="
                activeScope() === scope.key
                  ? 'var(--am-blue-primary)'
                  : 'var(--am-text-secondary)'
              "
              (click)="onScope(scope.key)"
            >
              {{ scope.label }}
              @if (scope.count !== undefined) {
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="text-[10.5px] opacity-70 ms-1"
                  >{{ scope.count }}</span
                >
              }
            </button>
          }
        </div>
      }

      @if (error()) {
        <div class="p-4"><p-message severity="error" [text]="error()! | translate" /></div>
      } @else if (loading()) {
        <div class="flex justify-center py-10">
          <p-progressSpinner styleClass="w-8 h-8" strokeWidth="4" />
        </div>
      } @else if (isFiltered() && rows().length === 0) {
        <!-- NO RESULTS — distinct from empty, and the distinction is the
             point. The filter is the cause, so the exit offered is undoing
             it. Never shown where the set is genuinely empty: telling someone
             to clear a search they did not make is worse than saying nothing. -->
        <div class="flex flex-col items-center justify-center text-center gap-1 px-6 py-8">
          <span class="text-[13px] font-semibold">{{ 'list.noResults' | translate }}</span>
          <span class="text-xs text-[var(--am-text-secondary)]">
            {{ 'list.noResultsBody' | translate }}
          </span>
          <p-button
            class="mt-2"
            size="small"
            [outlined]="true"
            [label]="'list.clearSearch' | translate"
            (onClick)="clearFilters()"
          />
        </div>
      } @else if (rows().length === 0) {
        <!-- NOTHING YET — an unpopulated relationship. Title, one explanatory
             line, no illustration and no apology. -->
        <div class="flex flex-col items-center justify-center text-center gap-1 px-6 py-8">
          <span
            class="w-[30px] h-[30px] rounded-lg border border-dashed border-[var(--am-border)] bg-[var(--am-surface)] mb-1"
          ></span>
          <span class="text-[13px] font-semibold">{{ emptyTitle() }}</span>
          @if (emptyMessage()) {
            <span class="text-xs text-[var(--am-text-secondary)] max-w-[34ch]">
              {{ emptyMessage() }}
            </span>
          }
        </div>
      } @else {
        <!-- ACC-78 — ROW ANATOMY RESPONDS TO WIDTH, and this is where that
             becomes possible.
             "@container/datalist" establishes a containment context (Tailwind
             v4 has container queries built in — no plugin, no ResizeObserver,
             no JS at all). A projected row is a DOM descendant of this div, so
             a row template can write @min-[520px]/datalist: variants and get
             the LIST's width rather than the viewport's.
             That distinction is the point: the same table is 352px wide in a
             record panel and full-width on its own page, at one and the same
             viewport size. A media query cannot tell those apart; a container
             query does not need to.
             The component deliberately does NOT dictate the anatomy — rows are
             projected, so only the consumer knows which field is worth
             promoting. It supplies the context and the shared breakpoint. -->
        <!-- The container class sits on its own wrapper rather than sharing an
             element with [class]="bodyClass()" — a [class] binding REPLACES
             static classes, so combining them would silently drop the
             containment context and every @min-* variant with it. -->
        <div class="@container/datalist">
          <div [class]="bodyClass()">
            @for (row of rows(); track trackBy()(row)) {
              <ng-container
                [ngTemplateOutlet]="rowTemplate()!"
                [ngTemplateOutletContext]="{ $implicit: row, index: $index }"
              />
            }
          </div>
        </div>
      }

      @if (showFooter()) {
        <!-- The footer appears when a FULLER DESTINATION EXISTS, not merely
             when the set is truncated. Members fits on one page and still
             links to its own list; Sub-committees fits and has nowhere to go,
             so it gets neither link nor range. A pagination bar that never
             paginates is noise. -->
        <div
          class="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--am-border)] bg-[var(--am-surface)]"
        >
          <span
            dir="ltr"
            style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
            class="text-[11.5px] text-[var(--am-text-secondary)]"
          >
            {{ rangeLabel() }}
          </span>
          <ng-content select="[listFooterAction]" />
        </div>
      }
    </div>
  `,
})
export class DataListComponent<T> {
  private readonly translate = inject(TranslateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly source = input.required<DataListSource<T>>();

  // Identity for @for tracking. Required rather than defaulted to the object
  // reference: a server-backed list gets NEW objects on every page load, so
  // reference tracking would rebuild every row on every keystroke.
  readonly trackBy = input.required<(row: T) => string>();

  readonly sortOptions = input<DataListSortOption[]>([]);
  readonly scopes = input<DataListScope[]>([]);
  readonly pageSize = input<number>(25);

  // Already-translated strings — a caller may be naming tenant-editable data.
  readonly searchPlaceholder = input<string>('');
  readonly emptyTitle = input<string>('');
  readonly emptyMessage = input<string>('');

  // The footer's link is projected; this decides whether the bar renders at
  // all. See the template comment on why truncation is not the rule.
  readonly hasDestination = input<boolean>(false);

  readonly bodyClass = input<string>('');

  // ACC-78 — persistence is OPT-IN, and off by default on purpose.
  //
  // A record page holds several lists at once, and a panel's momentary search
  // is not something anyone wants surviving a reload — nor is it meaningful to
  // share, since you would share the record's URL, not the panel's filter. So
  // panels pass nothing and get no persistence; the full-page lists opt in.
  //
  // The key namespaces both the storage entry and the URL params, which is what
  // lets three lists coexist on one page without reading each other's state.
  readonly persistKey = input<string | null>(null);

  // Requires persistKey. Separate because the two capabilities are separate:
  // a list may want to remember a sort order without claiming ownership of the
  // page's query string.
  readonly urlSync = input<boolean>(false);

  readonly rowTemplate = contentChild.required<TemplateRef<unknown>>('listRow');

  readonly rows = signal<T[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sortMenuOpen = signal(false);
  readonly activeScope = signal<string | null>(null);

  readonly query = signal<IListQuery>({ page: 1 });

  // The size of the set BEFORE the user narrowed it. Tracked separately from
  // total() because the toolbar threshold depends on it — see showToolbar.
  private readonly unfilteredTotal = signal(0);

  constructor() {
    this.restore();

    // Writes state out whenever it changes. Separate from the load effect so a
    // failing write can never stop rows rendering.
    effect(() => {
      const key = this.persistKey();
      if (!key) return;

      const query = this.query();
      const scope = this.activeScope();

      // Preferences only — see PersistedListPreferences on why search and page
      // are excluded.
      writePreferences(key, {
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        pageSize: query.pageSize,
        scope,
      });

      if (this.urlSync()) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: urlParamsFor(key, query, scope),
          queryParamsHandling: 'merge',
          // replaceUrl so typing in the search box does not push a history
          // entry per keystroke — the back button would otherwise walk
          // character by character out of a search rather than leaving the page.
          replaceUrl: true,
        });
      }
    });

    // Reloads whenever the query changes OR the source itself does — a parent
    // whose underlying array changed hands in a new source function, and that
    // must refetch rather than leave a stale page rendered.
    effect(() => {
      const source = this.source();
      const query = { ...this.query(), pageSize: this.query().pageSize ?? this.pageSize() };

      this.loading.set(true);
      source(query).subscribe({
        next: (page) => {
          this.rows.set(page.data);
          this.total.set(page.total);
          // Only an UNFILTERED load tells us how big the set really is. A
          // filtered one reports what survived the filter, which is not the
          // question showToolbar asks.
          if (!this.isFiltered()) this.unfilteredTotal.set(page.total);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('list.errorLoad');
          this.loading.set(false);
        },
      });
    });
  }

  // A filter is active if the user narrowed the set themselves. This is what
  // separates the two empty states, so it must mean "the user did something",
  // not "the list is showing fewer rows than it could".
  readonly isFiltered = computed(
    () => !!this.query().search?.trim() || this.activeScope() !== null,
  );

  // ACC-78 — CONTROLS RESPOND TO SET SIZE, NOT TO CONTEXT.
  //
  // This is what makes one component serve both the full page and a record
  // panel without an "embedded" mode. A panel holding 19 tasks gets search and
  // sort; a page holding 9 rows does not. Under the threshold there is nothing
  // to search and nothing worth reordering, so the toolbar is not rendered at
  // all rather than rendered and ignored.
  //
  // Measured against the UNFILTERED total, and that is the whole subtlety. If
  // it read the current total, searching 19 rows down to 2 would drop the set
  // below the threshold and REMOVE THE SEARCH BOX THE USER IS TYPING IN —
  // stranding them with a filter and no way to clear it. `|| isFiltered()` is
  // belt and braces for the first render after a filter, before an unfiltered
  // load has ever happened.
  //
  // No input overrides this. An escape hatch would be a per-call-site decision
  // and the rule is precisely that there is no per-call-site decision.
  readonly showToolbar = computed(
    () => this.unfilteredTotal() >= TOOLBAR_ROW_THRESHOLD || this.isFiltered(),
  );

  readonly activeSortLabel = computed(() => {
    const current = this.query().sortBy;
    const match = this.sortOptions().find((o) => o.column === current);
    return match?.label ?? this.sortOptions()[0]?.label ?? '';
  });

  readonly showFooter = computed(() => this.hasDestination() && this.total() > 0);

  readonly rangeLabel = computed(() => {
    const shown = this.rows().length;
    if (shown === 0) return '';
    const page = this.query().page ?? 1;
    const size = this.query().pageSize ?? this.pageSize();
    const first = (page - 1) * size + 1;
    // instant() is a plain call, not a signal read — currentLang() is read
    // explicitly so this re-evaluates on a language switch (ACC-55).
    this.translate.currentLang();
    return this.translate.instant('list.range', {
      first,
      last: first + shown - 1,
      total: this.total(),
    });
  });

  // Runs once, before the first load. Order is the decision here: stored
  // preferences first, then URL params ON TOP.
  //
  // THE URL MUST WIN. A shared link has to show the recipient what the sharer
  // was looking at — if the recipient's own saved sort quietly overrode it,
  // the link would show them a different list from the one they were sent, and
  // neither person would be able to tell.
  private restore(): void {
    const key = this.persistKey();
    if (!key) return;

    const prefs = readPreferences(key);
    let query: IListQuery = {
      page: 1,
      sortBy: prefs.sortBy,
      sortDir: prefs.sortDir,
      pageSize: prefs.pageSize,
    };
    let scope = prefs.scope ?? null;

    if (this.urlSync()) {
      const fromUrl = readUrlParams(key, this.route.snapshot.queryParams);
      // Only params actually present override — a link that pins a search but
      // says nothing about sorting should leave the reader's own sort alone.
      query = {
        ...query,
        ...Object.fromEntries(
          Object.entries(fromUrl.query).filter(([, value]) => value !== undefined),
        ),
      };
      if (this.route.snapshot.queryParams[`${key}.scope`] !== undefined) scope = fromUrl.scope;
    }

    this.query.set(query);
    this.activeScope.set(scope);
  }

  onSearch(event: Event): void {
    const search = (event.target as HTMLInputElement).value;
    // Back to page 1: staying on page 4 of a narrower result set shows an
    // empty page and reads as "the search found nothing".
    this.query.update((q) => ({ ...q, search, page: 1 }));
  }

  onSort(option: DataListSortOption): void {
    this.sortMenuOpen.set(false);
    this.query.update((q) => ({
      ...q,
      sortBy: option.column,
      sortDir: option.dir ?? 'asc',
      page: 1,
    }));
  }

  onScope(key: string): void {
    // Re-clicking the active scope clears it, so a chip is not a trap the user
    // needs a separate control to escape.
    this.activeScope.set(this.activeScope() === key ? null : key);
    this.query.update((q) => ({ ...q, page: 1 }));
  }

  clearFilters(): void {
    this.activeScope.set(null);
    this.query.update((q) => ({ ...q, search: '', page: 1 }));
  }
}
