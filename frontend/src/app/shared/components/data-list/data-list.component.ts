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
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ProgressSpinnerModule } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';
import { IListQuery } from '../../models/paginated-response';
import { DataListSource } from './data-list.source';

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
// (The size and width responses themselves land in the next commit.)
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
        <div [class]="bodyClass()">
          @for (row of rows(); track trackBy()(row)) {
            <ng-container
              [ngTemplateOutlet]="rowTemplate()!"
              [ngTemplateOutletContext]="{ $implicit: row, index: $index }"
            />
          }
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

  // Overridden by the next commit's size threshold; always on for now.
  readonly showToolbar = input<boolean>(true);

  readonly rowTemplate = contentChild.required<TemplateRef<unknown>>('listRow');

  readonly rows = signal<T[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly sortMenuOpen = signal(false);
  readonly activeScope = signal<string | null>(null);

  readonly query = signal<IListQuery>({ page: 1 });

  constructor() {
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
