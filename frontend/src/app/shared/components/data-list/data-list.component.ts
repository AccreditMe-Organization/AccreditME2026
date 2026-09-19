import {
  Component,
  ElementRef,
  Injector,
  OnInit,
  TemplateRef,
  ViewChild,
  afterNextRender,
  computed,
  contentChild,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { map, tap } from 'rxjs';
import { ListFocusService } from './list-focus.service';
import {
  RequestOutcome,
  createRequestOutcome,
  isRefreshing,
  isSkeleton,
  isStale,
} from '../../../core/request-outcome/request-outcome';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { PaginatorModule } from 'primeng/paginator';
import { TooltipModule } from 'primeng/tooltip';
import { IListQuery } from '../../models/paginated-response';
import { DataListSource } from './data-list.source';
import {
  readPreferences,
  readUrlFilters,
  readUrlParams,
  urlParamsFor,
  writePreferences,
} from './data-list.persistence';
import { PaginatorLatinDigits } from '../../../core/formatting/latin-digits';

export interface DataListColumn {
  // Stable identity: the persisted hidden-column set and the header/row
  // templates all key off this, so it must not change when a label does.
  key: string;
  label: string;
  // The backend column to sort by. Omitted means the column is not sortable —
  // which is the honest default, since a column has to be on the endpoint's
  // sort whitelist or the request is a 400.
  sortBy?: string;
  // Whether the column chooser may hide it. A table's identifying column
  // should not be hideable: a user list with Name hidden is a list of nothing.
  alwaysVisible?: boolean;
  // This column's grid track. The COMPONENT builds --am-list-cols from the
  // VISIBLE columns' widths, so hiding a column closes its gap instead of
  // leaving an empty track — and the caller never has to recompute a grid
  // string in step with a chooser it does not own.
  width?: string;
}

export interface DataListScope {
  key: string;
  label: string;
  count?: number;
}

// ACC-78 — below this many rows a PANEL does not render its toolbar.
//
// Applies to panel mode ONLY, and that boundary is the correction this rebuild
// exists for. The rule itself is right where it applies: a panel holding six
// tasks has nothing to search. Generalised to full pages it was wrong: it
// shipped a Roles page with no search at all, because that tenant has seven
// roles.
//
// Be precise about what the threshold did and did not cause, because the
// first diagnosis got this wrong. Users has 25 rows and WAS above it, so that
// page did have a search box. What every page lacked — headers, click-to-sort
// and a pager — was never gated on anything; it simply had not been built.
// The threshold explains the missing search on small lists and nothing else.
//
// A page is a destination; its controls are part of what it IS, and they do
// not appear and vanish with the size of the data.
export const PANEL_TOOLBAR_ROW_THRESHOLD = 12;

// ACC-78 — the shared list, rebuilt. Built against
// frontend/design-reference/AccreditMe Users List.dc.html (page mode) and
// .../AccreditMe Compact List Panel.dc.html (panel mode).
//
// TWO MODES, NAMED BY THE CALLER — `variant: 'page' | 'panel'`.
//
// The first attempt had one mode and derived its controls from row count,
// reasoning that set size is the honest variable and context is not. That is
// wrong, and worth stating plainly so it is not re-derived: a full page is a
// destination someone navigated to. Its header row, sort and pager are part of
// what the page is, not a response to how much data arrived. A panel embedded
// in a record page is the opposite — it borrows its frame from the record, and
// controls it does not need are noise. Same component, two genuinely different
// jobs, so the caller says which.
//
// PAGE MODE: a real table. Projected header row, click-to-sort, a paginator
// with rows-per-page, a filter bar and a column chooser.
// PANEL MODE: the compact list. No header, no pager; a toolbar only once the
// set is big enough to need one, which is where the size rule still belongs.
//
// HEADER AND ROWS ARE BOTH PROJECTED, and alignment between them is the one
// real cost of that. A column-config API would own the layout and keep them
// aligned for free, but it would be a small framework describing three tables
// that share no structure — Users is seven columns, Members is an avatar and
// two lines, Workflow Stages is an expandable row containing an editor. So the
// consumer declares each column's width ONCE on its DataListColumn, the
// component builds --am-list-cols from the VISIBLE ones, and both templates
// consume that variable. One definition, two users of it, no framework — and
// because the component owns it, hiding a column closes its track rather than
// leaving a gap the caller would have to recompute around.
@Component({
  selector: 'app-data-list',
  standalone: true,
  // ACC-78 - the host is a custom element and therefore `display: inline` by
  // default, which makes every flex/height rule inside it inert. It has to be
  // a shrinkable flex column for the body's scroll region to work at all.
  //
  // min-height: 0 is the load-bearing half. A flex item's default
  // `min-height: auto` refuses to shrink below its content, so a tall table
  // pushes its own container past the available height instead of scrolling
  // inside it - which is exactly the bug this fixes.
  host: { class: 'flex flex-col min-h-0' },
  imports: [
    NgTemplateOutlet,
    TranslatePipe,
    ProgressSpinnerModule,
    MessageModule,
    ButtonModule,
    PaginatorModule,
    PaginatorLatinDigits,
    TooltipModule,
  ],
  template: `
    <div
      class="flex flex-col min-w-0 flex-1 min-h-0"
      [style]="'--am-list-cols: ' + gridTemplate()"
    >
      <!-- ── toolbar ─────────────────────────────────────────────────────── -->
      @if (showToolbar()) {
        <div
          class="flex items-center gap-2 px-2.5 py-2 border-b border-[var(--am-border)] bg-[var(--am-surface)]"
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

          <!-- Filters are projected: only the caller knows that this list
               filters by org unit and that the picker is a hierarchy. -->
          <ng-content select="[listFilters]" />

          @if (isPage() && hideableColumns().length > 0) {
            <p-button
              size="small"
              [text]="true"
              icon="pi pi-table"
              [pTooltip]="'list.columns' | translate"
              (onClick)="columnMenuOpen.set(!columnMenuOpen())"
            />
          }

          <!-- Panel mode has no header row to click, so sorting needs a menu.
               Page mode sorts from the headers and shows none. -->
          @if (!isPage() && sortableColumns().length > 0) {
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
            @for (column of sortableColumns(); track column.key) {
              <button
                type="button"
                class="text-start text-xs px-2 py-1.5 rounded hover:bg-[var(--am-surface)]"
                [class.font-semibold]="query().sortBy === column.sortBy"
                (click)="onSortColumn(column)"
              >
                {{ column.label }}
              </button>
            }
          </div>
        }

        @if (columnMenuOpen()) {
          <div class="flex flex-col border-b border-[var(--am-border)] bg-[var(--am-card)] p-1">
            @for (column of hideableColumns(); track column.key) {
              <button
                type="button"
                class="flex items-center gap-2 text-start text-xs px-2 py-1.5 rounded hover:bg-[var(--am-surface)]"
                (click)="toggleColumn(column.key)"
              >
                <i
                  class="pi text-[10px]"
                  [class.pi-check-square]="isColumnVisible(column.key)"
                  [class.pi-stop]="!isColumnVisible(column.key)"
                ></i>
                {{ column.label }}
              </button>
            }
          </div>
        }
      }

      <!-- ── scope chips ─────────────────────────────────────────────────── -->
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

      <!-- ── header row ──────────────────────────────────────────────────── -->
      <!-- Page mode only, and only once there is something to head. Rendering
           headers above an empty state labels columns that hold nothing. -->
      @if (isPage() && headerTemplate() && rows().length > 0) {
        <div
          class="grid items-center gap-3 px-3 py-2 border-b-2 border-[var(--am-border)] bg-[var(--am-surface)] text-[11px] font-semibold uppercase tracking-wide text-[var(--am-text-secondary)]"
          style="grid-template-columns: var(--am-list-cols)"
        >
          <ng-container
            [ngTemplateOutlet]="headerTemplate()!"
            [ngTemplateOutletContext]="{
              $implicit: {
                sortBy: appliedQuery().sortBy,
                sortDir: appliedQuery().sortDir,
                sort: sortByColumnKey,
                visible: isColumnVisible,
              },
            }"
          />
        </div>
      }

      <!-- ── body ────────────────────────────────────────────────────────── -->
      <!-- THE SCROLL REGION, and it is deliberately only this. The toolbar,
           scope chips, header row and pager sit outside it, so they stay put
           while rows scroll underneath - a pager that scrolls away is a pager
           the reader has to go looking for.
           This replaces what p-table's scrollable scrollHeight="flex" did
           before the migration. Losing it is what made the last row render
           cut off and put the pager 730px below the viewport with no way to
           reach it: the card clipped its overflow rather than scrolling, so
           the shell's own scrollable <main> never had anything to scroll.
           When the parent does NOT constrain height, flex-1 simply grows to
           content and no scrollbar appears - so this is safe in panel mode
           too, and does not need a per-variant branch. -->
      <!-- A REFETCH FAILED and these rows answer the PREVIOUS request. The
           sort arrow and pager already reverted with them; this says it in
           words, because artboard 8 requires an error to state whether
           anything changed. -->
      @if (isStale()) {
        <div
          class="flex items-center justify-between gap-3 px-3 py-2 border-b text-xs"
          style="background: var(--am-warning-bg); border-color: var(--am-warning-border); color: var(--am-warning-ink)"
          role="status"
        >
          <span>{{ 'list.staleAfterError' | translate }}</span>
          <p-button size="small" [text]="true" [label]="'list.retry' | translate" (onClick)="retry()" />
        </div>
      }

      <div class="flex-1 min-h-0 overflow-y-auto">
      @if (outcome().status === 'error') {
        <!-- Nothing to show: the request failed on a FIRST load. -->
        <div class="p-4 flex flex-col items-center gap-2">
          <p-message severity="error" [text]="'list.errorLoad' | translate" />
          <p-button size="small" [label]="'list.retry' | translate" (onClick)="retry()" />
        </div>
      } @else if (outcome().status === 'denied') {
        <div class="p-4">
          <p-message severity="warn" [text]="'list.denied' | translate" />
        </div>
      } @else if (isSkeleton()) {
        <!-- A FIRST load: skeleton rows shaped like the rows to come, at the
             last page size, so nothing reflows when data lands. A refetch
             never reaches here — it keeps its rows and shows a spinner. -->
        <div class="flex flex-col" aria-hidden="true">
          @for (n of skeletonRows(); track n) {
            <div
              class="grid items-center gap-3 px-3 py-2 border-b border-[var(--am-row-rule)]"
              style="grid-template-columns: var(--am-list-cols)"
            >
              <span class="am-skeleton-bar"></span>
              <span class="am-skeleton-bar"></span>
              <span class="am-skeleton-bar"></span>
            </div>
          }
        </div>
      } @else if (isEmptyFiltered()) {
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
            [label]="'list.clearFilters' | translate"
            (onClick)="clearFilters()"
          />
        </div>
      } @else if (isEmptyUnfiltered()) {
        <!-- NOTHING YET — an unpopulated relationship. Title, one explanatory
             line, no illustration and no apology. The dashed mark belongs to
             THIS empty only: the filtered one above offers a way out instead. -->
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
        <!-- The container class sits on its own wrapper rather than sharing an
             element with [class]="bodyClass()" — a [class] binding REPLACES
             static classes, so combining them would silently drop the
             containment context and every @min-* variant with it. -->
        <div class="@container/datalist" [class.opacity-60]="isRefreshing()">
          <!-- tabindex -1 so focus has somewhere to land when a filter empties
               the list — otherwise it falls to <body> (ACC-111). -->
          <div #rowsBody [class]="bodyClass()" tabindex="-1" role="rowgroup">
            @for (row of rows(); track trackBy()(row)) {
              <ng-container
                [ngTemplateOutlet]="rowTemplate()!"
                [ngTemplateOutletContext]="{
                  $implicit: row,
                  index: $index,
                  visible: isColumnVisible,
                }"
              />
            }
          </div>
        </div>
      }
      </div>

      <!-- Focus moved under the reader, so say so. A silent jump is its own
           defect: nothing else tells a screen-reader user the list changed. -->
      <div class="sr-only" role="status" aria-live="polite">{{ listFocus.announcement() }}</div>

      <!-- ── pager ───────────────────────────────────────────────────────── -->
      <!-- Page mode only. PrimeNG's paginator rather than a hand-rolled one:
           it handles RTL, keyboard and ARIA, and the first attempt hand-rolled
           a range label and then shipped no way to reach page 2 at all. -->
      @if (isPage() && showPager() && total() > 0) {
        <p-paginator
          [first]="firstRecord()"
          [rows]="effectivePageSize()"
          [totalRecords]="total()"
          [rowsPerPageOptions]="rowsPerPageOptions()"
          [showCurrentPageReport]="true"
          [currentPageReportTemplate]="'list.range' | translate"
          (onPageChange)="onPageChange($event)"
          styleClass="border-t border-[var(--am-border)] text-xs"
        />
      }

      @if (persistKey()) {
        <!-- ACC-78 — says PER BROWSER, because localStorage is what was built.
             The design reference's "per user per list" would promise
             cross-device persistence that needs a user-preferences table and
             does not exist. A footer claiming it would be a promise the
             product does not keep. -->
        <div
          class="px-3 py-1.5 text-[11px] text-[var(--am-text-secondary)] border-t border-[var(--am-border)]"
        >
          {{ 'list.preferencesNote' | translate }}
        </div>
      }

      @if (showPanelFooter()) {
        <!-- Panel mode's footer link — appears when a FULLER DESTINATION
             EXISTS, not merely when the set is truncated. -->
        <div
          class="flex items-center justify-between gap-2 px-3 py-2 border-t border-[var(--am-border)] bg-[var(--am-surface)]"
        >
          <span
            dir="ltr"
            style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
            class="text-[11.5px] text-[var(--am-text-secondary)]"
          >
            {{ panelRangeLabel() }}
          </span>
          <ng-content select="[listFooterAction]" />
        </div>
      }
    </div>
  `,
})
export class DataListComponent<T> implements OnInit {
  /** The rows container, for ListFocusService to restore focus into. */
  @ViewChild('rowsBody') private readonly rowsBody?: ElementRef<HTMLElement>;

  private readonly translate = inject(TranslateService);
  /** Not private: the template reads its live-region announcement. */
  protected readonly listFocus = inject(ListFocusService);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly source = input.required<DataListSource<T>>();

  // Identity for @for tracking. Required rather than defaulted to the object
  // reference: a server-backed list gets NEW objects on every page load, so
  // reference tracking would rebuild every row on every keystroke.
  readonly trackBy = input.required<(row: T) => string>();

  // See the class comment. The caller decides; nothing infers it.
  readonly variant = input<'page' | 'panel'>('page');

  readonly columns = input<DataListColumn[]>([]);
  readonly scopes = input<DataListScope[]>([]);
  readonly pageSize = input<number>(25);
  readonly rowsPerPageOptions = input<number[]>([10, 25, 50, 100]);

  // Appended after the column tracks — the row-actions cell. Set to '' for a
  // list whose rows have no trailing action.
  readonly gridSuffix = input<string>('auto');

  // Names of the filters this list offers. Declared so a crafted URL cannot
  // introduce filter keys the list never had — see readUrlFilters.
  readonly filterNames = input<readonly string[]>([]);

  // Already-translated strings — a caller may be naming tenant-editable data.
  readonly searchPlaceholder = input<string>('');
  readonly emptyTitle = input<string>('');
  readonly emptyMessage = input<string>('');

  // Page mode renders a pager; a list that is inherently COMPLETE turns it
  // off. This is an explicit caller decision, not a row-count rule — Workflow
  // Stages is client-side and manually ordered, so there is never a second
  // page and a "1-6 of 6" bar is pure noise. Deliberately not inferred from
  // total <= pageSize: that would hide the rows-per-page control on any list
  // that happens to fit today, which is the same over-generalisation this
  // rebuild exists to undo.
  readonly showPager = input<boolean>(true);

  readonly hasDestination = input<boolean>(false);
  readonly bodyClass = input<string>('');

  // ACC-78 — persistence is OPT-IN. A record page holds several lists at once,
  // and a panel's momentary search is not something anyone wants surviving a
  // reload. The key namespaces both the storage entry and the URL params.
  readonly persistKey = input<string | null>(null);
  readonly urlSync = input<boolean>(false);

  readonly rowTemplate = contentChild.required<TemplateRef<unknown>>('listRow');
  readonly headerTemplate = contentChild<TemplateRef<unknown>>('listHeader');

  readonly rows = computed<T[]>(() => {
    const outcome = this.outcome();
    return outcome.status === 'rows' ? [...outcome.data] : [];
  });
  readonly total = signal(0);
  /**
   * The request's outcome, as the ONE state machine (ACC-111). Replaces the
   * loading/error pair: a flag beside an array can be half-read, which is how
   * an empty state reached a tenant with 312 users. `rows` is derived from it,
   * so a failed REFETCH keeps what is on screen instead of blanking the list.
   */
  private readonly outcomeHandle = signal<{
    outcome: () => RequestOutcome<T>;
    retry: () => void;
    destroy: () => void;
  } | null>(null);

  protected readonly outcome = computed<RequestOutcome<T>>(
    () => this.outcomeHandle()?.outcome() ?? { status: 'idle' },
  );

  protected readonly isSkeleton = computed(() => isSkeleton(this.outcome()));
  protected readonly isRefreshing = computed(() => isRefreshing(this.outcome()));
  protected readonly isStale = computed(() => isStale(this.outcome()));

  /**
   * The two empties artboard 8 requires, as separate reads — a template cannot
   * narrow a union inside a condition, and conflating them is what tells
   * someone to clear a search they never made.
   */
  protected readonly isEmptyFiltered = computed(() => {
    const outcome = this.outcome();
    return outcome.status === 'empty' && outcome.filtered;
  });

  protected readonly isEmptyUnfiltered = computed(() => {
    const outcome = this.outcome();
    return outcome.status === 'empty' && !outcome.filtered;
  });

  /** Retry for the error state and the stale notice. */
  protected readonly retry = (): void => this.outcomeHandle()?.retry();

  /** The query the next run should issue. See the effect that builds the machine. */
  private pendingQuery: IListQuery = {};

  /**
   * Skeleton placeholders: the SAME COUNT as the last page size, so the list
   * does not reflow when the rows land (artboard 8). Capped, because a page
   * size of 100 would render 100 grey bars on a first paint.
   */
  protected readonly skeletonRows = computed(() =>
    Array.from({ length: Math.min(this.effectivePageSize(), 8) }, (_, i) => i),
  );
  readonly sortMenuOpen = signal(false);
  readonly columnMenuOpen = signal(false);
  readonly activeScope = signal<string | null>(null);
  readonly hiddenCols = signal<string[]>([]);

  readonly query = signal<IListQuery>({ page: 1 });

  private readonly unfilteredTotal = signal(0);
  private readonly reloadToken = signal(0);

  /**
   * The query that PRODUCED the rows currently on screen, as opposed to the
   * one last requested (ACC-111).
   *
   * They differ only when a refetch fails: the rows stay, because blanking
   * the list loses the reader's place, and then the header must not claim a
   * sort those rows are not in. The stale notice says it in words; the sort
   * arrow and the pager say it at a glance, and a reader glances. So the
   * indicator reverts with the rows, and the pending sort appears only once
   * it succeeds.
   */
  protected readonly appliedQuery = signal<IListQuery>({});

  // The write-effect must not run before ngOnInit has read the URL, or it
  // writes the empty default query over the very params it is about to
  // restore. This is what made the address bar lose its own parameters.
  private readonly restored = signal(false);

  readonly isPage = computed(() => this.variant() === 'page');

  // The single grid definition both the header row and every data row read,
  // published as --am-list-cols. Built here rather than by the caller because
  // the component owns which columns are hidden.
  readonly gridTemplate = computed(() => {
    const visible = this.columns().filter((c) => this.isColumnVisible(c.key));
    const tracks = visible.map((c) => c.width ?? '1fr');
    const suffix = this.gridSuffix();
    return [...tracks, ...(suffix ? [suffix] : [])].join(' ') || '1fr';
  });

  // RESTORE RUNS HERE, NOT IN THE CONSTRUCTOR, and the distinction is not
  // stylistic. Signal inputs still hold their DEFAULTS while the constructor
  // runs — persistKey() was null, so restore() returned immediately and no URL
  // state was ever read. Worse than unsupported: the write-effect then
  // overwrote the address bar with the empty query, so a shared link visibly
  // dropped its own parameters on arrival.
  //
  // ngOnInit runs after inputs are set and before the load effect first
  // flushes, so the restored query is what the first fetch uses. Verified in a
  // browser, which is the only place the original failure was visible at all.
  ngOnInit(): void {
    this.restore();
  }

  constructor() {
    effect(() => {
      const key = this.persistKey();
      if (!key || !this.restored()) return;

      const query = this.query();
      const scope = this.activeScope();

      writePreferences(key, {
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        pageSize: query.pageSize,
        scope,
        hiddenCols: this.hiddenCols(),
      });

      if (this.urlSync()) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: urlParamsFor(key, query, scope),
          queryParamsHandling: 'merge',
          // replaceUrl so typing in the search box does not push a history
          // entry per keystroke.
          replaceUrl: true,
        });
      }
    });

    // ONE machine per list, re-run whenever the query changes. The source
    // closure reads the CURRENT query, so a retry re-runs the same request the
    // user is looking at rather than the one that first created the machine.
    effect(() => {
      const source = this.source();
      const query: IListQuery = {
        ...this.query(),
        pageSize: this.query().pageSize ?? this.pageSize(),
        scope: this.activeScope(),
      };
      this.reloadToken();

      this.pendingQuery = query;
      const existing = this.outcomeHandle();
      if (existing) {
        existing.retry();
        return;
      }

      const handle = createRequestOutcome<T>(
        () =>
          source(this.pendingQuery).pipe(
            tap((page) => {
              // Recorded on the way through, because the machine only carries
              // rows: the total and the query that produced them belong to the
              // list, and the pager and sort arrow read the APPLIED one.
              this.appliedQuery.set(this.pendingQuery);
              this.total.set(page.total);
              if (!this.isFiltered()) this.unfilteredTotal.set(page.total);
            }),
            map((page) => page.data),
          ),
        {
          // Described when the REQUEST goes out, so a debounced search quotes
          // the term that produced the answer rather than the one now typed.
          describeEmpty: () => ({
            reason: this.isFiltered() ? 'list.noResultsBody' : this.emptyMessage() || 'list.empty',
            filtered: this.isFiltered(),
          }),
        },
      );
      this.outcomeHandle.set(handle);
    });

    // Focus follows the new rows once they are in the DOM, never before.
    effect(() => {
      this.outcome();
      afterNextRender(
        { read: () => this.listFocus.restore(this.rowsBody?.nativeElement ?? null) },
        { injector: this.injector },
      );
    });
  }

  // A filter is active if the user narrowed the set themselves. This is what
  // separates the two empty states, so it must mean "the user did something".
  readonly isFiltered = computed(() => {
    const filters = this.query().filters ?? {};
    return (
      !!this.query().search?.trim() ||
      this.activeScope() !== null ||
      Object.values(filters).some((v) => v !== null && v !== undefined && v !== '')
    );
  });

  // Page mode always shows its toolbar; the page IS its controls. Panel mode
  // keeps the size rule — see PANEL_TOOLBAR_ROW_THRESHOLD.
  readonly showToolbar = computed(
    () =>
      this.isPage() ||
      this.unfilteredTotal() >= PANEL_TOOLBAR_ROW_THRESHOLD ||
      this.isFiltered(),
  );

  readonly sortableColumns = computed(() => this.columns().filter((c) => !!c.sortBy));
  readonly hideableColumns = computed(() => this.columns().filter((c) => !c.alwaysVisible));

  readonly activeSortLabel = computed(() => {
    const current = this.query().sortBy;
    const match = this.sortableColumns().find((c) => c.sortBy === current);
    return match?.label ?? this.sortableColumns()[0]?.label ?? '';
  });

  readonly effectivePageSize = computed(
    () => this.appliedQuery().pageSize ?? this.query().pageSize ?? this.pageSize(),
  );
  readonly firstRecord = computed(
    () => ((this.appliedQuery().page ?? 1) - 1) * this.effectivePageSize(),
  );

  readonly showPanelFooter = computed(
    () => !this.isPage() && this.hasDestination() && this.total() > 0,
  );

  readonly panelRangeLabel = computed(() => {
    const shown = this.rows().length;
    if (shown === 0) return '';
    const first = this.firstRecord() + 1;
    // instant() is a plain call, not a signal read — currentLang() is read
    // explicitly so this re-evaluates on a language switch (ACC-55).
    this.translate.currentLang();
    // A SEPARATE KEY from list.range, and the two are not interchangeable:
    // list.range is consumed by PrimeNG's paginator, which substitutes its own
    // {first}/{last}/{totalRecords} placeholders. This one goes through
    // ngx-translate, which substitutes {{first}}. Passing either string to the
    // other renders the braces literally on screen.
    return this.translate.instant('list.panelRange', {
      first,
      last: first + shown - 1,
      total: this.total(),
    });
  });

  // Passed into the header template so a consumer can ask "is this the sorted
  // column, and which way" without reaching into the component.
  readonly isColumnVisible = (key: string): boolean => !this.hiddenCols().includes(key);

  readonly sortByColumnKey = (key: string): void => {
    const column = this.columns().find((c) => c.key === key);
    if (column?.sortBy) this.onSortColumn(column);
  };

  private restore(): void {
    const key = this.persistKey();
    if (!key) {
      this.restored.set(true);
      return;
    }

    const prefs = readPreferences(key);
    let query: IListQuery = {
      page: 1,
      sortBy: prefs.sortBy,
      sortDir: prefs.sortDir,
      pageSize: prefs.pageSize,
    };
    let scope = prefs.scope ?? null;
    this.hiddenCols.set(prefs.hiddenCols ?? []);

    // THE URL MUST WIN. A shared link has to show the recipient what the
    // sharer was looking at — if the recipient's own saved sort quietly
    // overrode it, the link would show a different list from the one sent.
    if (this.urlSync()) {
      const fromUrl = readUrlParams(key, this.route.snapshot.queryParams);
      query = {
        ...query,
        ...Object.fromEntries(
          Object.entries(fromUrl.query).filter(([, value]) => value !== undefined),
        ),
      };
      if (this.route.snapshot.queryParams[`${key}.scope`] !== undefined) scope = fromUrl.scope;

      const filters = readUrlFilters(key, this.filterNames(), this.route.snapshot.queryParams);
      if (Object.values(filters).some((v) => v !== null)) query = { ...query, filters };
    }

    this.query.set(query);
    this.activeScope.set(scope);
    this.restored.set(true);
  }

  // Reloads without changing the query. The parent needs this after a write —
  // inviting a user, deactivating one — and nothing in the query changes, so
  // the load effect would not fire on its own.
  reload(): void {
    this.reloadToken.update((n) => n + 1);
  }

  onSearch(event: Event): void {
    const search = (event.target as HTMLInputElement).value;
    // Back to page 1: staying on page 4 of a narrower result set shows an
    // empty page and reads as "the search found nothing".
    this.query.update((q) => ({ ...q, search, page: 1 }));
  }

  onSortColumn(column: DataListColumn): void {
    if (!column.sortBy) return;
    this.sortMenuOpen.set(false);
    this.query.update((q) => ({
      ...q,
      sortBy: column.sortBy,
      // Clicking the already-sorted column reverses it, which is what a header
      // is expected to do. A different column starts ascending.
      sortDir: q.sortBy === column.sortBy && q.sortDir === 'asc' ? 'desc' : 'asc',
      page: 1,
    }));
    this.setReplaced('list.announceSorted');
  }


  /**
   * A sort, page, filter, search or scope change REPLACES the set, so a
   * keyboard user goes to the first row rather than to whatever now occupies
   * the index they were on — row 7 of a new sort is an unrelated record.
   * ListFocusService holds the decision; this only says which happened.
   */
  private setReplaced(announcement: string): void {
    this.listFocus.noteSetReplaced();
    this.listFocus.announce(this.translate.instant(announcement));
  }

  onScope(key: string): void {
    // Re-clicking the active scope clears it, so a chip is not a trap.
    this.activeScope.set(this.activeScope() === key ? null : key);
    this.query.update((q) => ({ ...q, page: 1 }));
    this.setReplaced('list.announceFiltered');
  }

  setFilter(name: string, value: string | null): void {
    this.query.update((q) => ({
      ...q,
      filters: { ...(q.filters ?? {}), [name]: value },
      page: 1,
    }));
    this.setReplaced('list.announceFiltered');
  }

  filterValue(name: string): string | null {
    return this.query().filters?.[name] ?? null;
  }

  toggleColumn(key: string): void {
    this.hiddenCols.update((cols) =>
      cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key],
    );
  }

  onPageChange(event: { first?: number; rows?: number }): void {
    const rows = event.rows ?? this.effectivePageSize();
    this.query.update((q) => ({
      ...q,
      pageSize: rows,
      page: Math.floor((event.first ?? 0) / rows) + 1,
    }));
    this.setReplaced('list.announcePaged');
  }

  clearFilters(): void {
    this.activeScope.set(null);
    this.query.update((q) => ({ ...q, search: '', filters: {}, page: 1 }));
  }
}
