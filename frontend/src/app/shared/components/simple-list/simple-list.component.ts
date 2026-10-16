import {
  Component,
  DestroyRef,
  TemplateRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { Observable, Subscription } from 'rxjs';
import { FormatService } from '../../../core/formatting';
import { OverlaySelectComponent } from '../overlay-select/overlay-select.component';

/** Below this window width the rows are cards (the phone sheet). */
export const SIMPLE_LIST_PHONE_BELOW_PX = 760;
const PAGE = 50;
const SEARCH_DELAY_MS = 250;

export interface SimpleListQuery {
  q?: string;
  sort: string;
  dir: 'asc' | 'desc';
  take: number;
  skip: number;
}

export interface SimpleListPage<T> {
  items: T[];
  /** Every row there is, before the search. */
  total: number;
  /** The rows the search matches. */
  matching: number;
}

export interface SimpleListColumn {
  /** Already translated; empty for an actions column (named for screen readers by `srLabel`). */
  label: string;
  srLabel?: string;
}

/**
 * `am-simple-list` — a plain searchable list for an `am-list-dialog` (ACC-230:
 * All members, All sub-committees). Search and one sort, both on the server;
 * Load more by 50; a polite live count. Nothing is remembered: it opens on
 * its defaults every time (the dialog rebuilds it).
 *
 * The caller gives the read (`load`), the columns (`columns` + `grid`, a CSS
 * grid-template-columns) and each row's cells (`row`, a template whose cells
 * are its direct children). Only the list scrolls; below 760px the rows are
 * cards and the column header goes.
 */
@Component({
  selector: 'am-simple-list',
  standalone: true,
  imports: [FormsModule, NgTemplateOutlet, TranslatePipe, OverlaySelectComponent],
  template: `
    <div class="am-sl" data-testid="simple-list">
      <div class="am-sl__toolbar" role="search">
        <span class="am-sl__search">
          <i class="pi pi-search" aria-hidden="true"></i>
          <input
            type="search"
            [value]="qInput()"
            (input)="onSearch(searchBox.value)"
            #searchBox
            [attr.aria-label]="searchLabel()"
            [placeholder]="searchPlaceholder()"
            data-testid="simple-list-search"
          />
        </span>
        <app-overlay-select
          class="am-sl__sort"
          [options]="sortOptions()"
          [ngModel]="sortValue()"
          (ngModelChange)="sortValue.set($event ?? defaultSort())"
          [ariaLabel]="'record.sortLabel' | translate"
          data-testid="simple-list-sort"
        />
        <span class="am-sl__live" aria-live="polite" data-testid="simple-list-live">{{ liveText() }}</span>
      </div>

      <div class="am-sl__scroll" data-testid="simple-list-scroll" [attr.aria-busy]="phase() === 'loading'">
        @if (!phone()) {
          <div class="am-sl__row am-sl__head" role="row" [style.grid-template-columns]="grid()" data-testid="simple-list-head">
            @for (c of columns(); track $index) {
              <span role="columnheader">
                @if (c.label) {
                  {{ c.label }}
                } @else if (c.srLabel) {
                  <span class="sr-only">{{ c.srLabel }}</span>
                }
              </span>
            }
          </div>
        }
        @switch (phase()) {
          @case ('loading') {
            @for (i of skeleton; track i) {
              <div class="am-sl__row" aria-hidden="true"><span class="am-sl__bone"></span></div>
            }
          }
          @case ('error') {
            <div class="am-sl__state" role="alert" data-testid="simple-list-error">
              <p class="m-0">{{ 'record.listError' | translate }}</p>
              <button type="button" class="am-sl__btn" (click)="reload()">{{ 'list.retry' | translate }}</button>
            </div>
          }
          @default {
            @if (items().length === 0) {
              <div class="am-sl__state" data-testid="simple-list-empty">
                @if (q()) {
                  <p class="m-0 font-semibold">{{ noMatchText() }}</p>
                  <button type="button" class="am-sl__btn" (click)="clearSearch()">{{ 'record.clearSearch' | translate }}</button>
                } @else {
                  <p class="m-0">{{ emptyText() }}</p>
                }
              </div>
            }
            @if (selectable()) {
              <!-- Opt-in (ACC-120 slice 4, Add member's person picker): each row
                   is ONE button that picks it. A row disabled with a reason stays
                   in the list, focusable and announced as unavailable
                   (aria-disabled, not disabled), with the reason as its last
                   cell, so a searcher is never left wondering where someone went. -->
              <ul class="am-sl__list" role="list">
                @for (item of items(); track trackId(item)) {
                  <li class="am-sl__pickitem" data-testid="simple-list-row">
                    <button
                      type="button"
                      class="am-sl__row am-sl__item am-sl__pick"
                      [class.am-sl__item--card]="phone()"
                      [class.am-sl__pick--off]="!!reasonFor(item)"
                      [style.grid-template-columns]="phone() ? null : grid()"
                      [attr.aria-disabled]="reasonFor(item) ? 'true' : null"
                      data-testid="simple-list-pick"
                      (click)="pick(item)"
                    >
                      <ng-container [ngTemplateOutlet]="row()" [ngTemplateOutletContext]="{ $implicit: item, phone: phone() }" />
                      @if (rowDisabled()) {
                        <span class="am-sl__reason" data-testid="simple-list-reason">{{ reasonFor(item) }}</span>
                      }
                    </button>
                  </li>
                }
              </ul>
            } @else {
            <ul class="am-sl__list" role="list">
              @for (item of items(); track trackId(item)) {
                <li
                  class="am-sl__row am-sl__item"
                  [class.am-sl__item--card]="phone()"
                  [style.grid-template-columns]="phone() ? null : grid()"
                  data-testid="simple-list-row"
                >
                  <ng-container [ngTemplateOutlet]="row()" [ngTemplateOutletContext]="{ $implicit: item, phone: phone() }" />
                </li>
              }
            </ul>
            }
          }
        }
      </div>

      <div class="am-sl__foot" data-testid="simple-list-foot">
        @if (phase() === 'ready') {
          <span>{{ footText() }}</span>
          <span class="flex-1"></span>
          @if (more() === 'failed') {
            <span class="text-[var(--am-danger-ink)]" role="alert">{{ 'record.loadMoreFailed' | translate }}</span>
            <button type="button" class="am-sl__btn" (click)="loadMore()">{{ 'list.retry' | translate }}</button>
          } @else if (items().length < matching()) {
            <button type="button" class="am-sl__btn" [disabled]="more() === 'loading'" (click)="loadMore()" data-testid="simple-list-more">
              {{ (more() === 'loading' ? 'record.loadingMore' : 'record.loadMore') | translate }}
            </button>
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0}
      .am-sl{display:flex;flex-direction:column;flex:1 1 auto;min-block-size:0;font-size:13px}
      .am-sl__toolbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 16px;border-block-end:1px solid var(--am-border)}
      .am-sl__search{flex:1 1 200px;display:flex;align-items:center;gap:6px;block-size:32px;padding:0 10px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-control)}
      .am-sl__search input{flex:1;min-inline-size:0;border:0;outline:0;font:inherit;background:none}
      .am-sl__search:focus-within{outline:var(--am-focus-ring-width) solid var(--am-focus-ring)}
      .am-sl__sort{inline-size:200px}
      .am-sl__live{font-size:12px;color:var(--am-ink-700)}
      .am-sl__scroll{flex:1 1 auto;min-block-size:0;overflow:auto}
      .am-sl__list{list-style:none;margin:0;padding:0}
      .am-sl__row{display:grid;gap:10px;align-items:center;min-block-size:44px;box-sizing:border-box;padding:4px 16px;border-block-end:1px solid var(--am-border)}
      .am-sl__head{position:sticky;inset-block-start:0;z-index:1;min-block-size:30px;padding-block:0;background:var(--am-surface);font-size:11.5px;font-weight:600;color:var(--am-ink-700)}
      .am-sl__item--card{display:flex;flex-wrap:wrap;gap:2px 8px;min-block-size:60px;padding-block:8px}
      .am-sl__item--card>:first-child{flex:1 1 100%;min-inline-size:0}
      .am-sl__bone{grid-column:1/-1;block-size:12px;border-radius:4px;background:var(--am-surface)}
      .am-sl__state{display:flex;flex-direction:column;align-items:flex-start;gap:8px;padding:24px 16px}
      .am-sl__btn{font:inherit;font-size:12.5px;block-size:30px;padding:0 11px;border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);background:var(--am-surface-raised);color:var(--am-ink-900);cursor:pointer}
      .am-sl__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-sl__foot{flex:none;display:flex;align-items:center;gap:8px;block-size:44px;padding:0 16px;border-block-start:1px solid var(--am-border);color:var(--am-ink-700);font-size:12.5px}
      .am-sl__pickitem{display:block}
      .am-sl__pick{inline-size:100%;margin:0;border-inline:0;border-block-start:0;background:none;font:inherit;color:inherit;text-align:start;cursor:pointer}
      .am-sl__pick:hover{background:var(--am-surface)}
      .am-sl__pick:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:calc(-1 * var(--am-focus-ring-width))}
      .am-sl__pick--off{cursor:default;color:var(--am-ink-700)}
      .am-sl__pick--off:hover{background:none}
      .am-sl__reason{font-size:12px;color:var(--am-ink-700)}
      :host-context([dir=rtl]) .am-sl__foot{block-size:48px}
      :host-context([dir=rtl]) .am-sl__item--card{min-block-size:64px}
    `,
  ],
})
export class SimpleListComponent<T extends { id: string }> {
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly document = inject(DOCUMENT);

  /** Reads one page. */
  readonly load = input.required<(query: SimpleListQuery) => Observable<SimpleListPage<T>>>();
  readonly columns = input.required<SimpleListColumn[]>();
  /** The grid's columns, as CSS grid-template-columns. */
  readonly grid = input.required<string>();
  /** One row's cells: its direct children are the grid cells. Context: `$implicit` the row, `phone`. */
  readonly row = input.required<TemplateRef<{ $implicit: T; phone: boolean }>>();
  readonly sortOptions = input.required<{ value: string; label: string }[]>();
  /** The first sort, as `key:dir`. */
  readonly defaultSort = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly searchPlaceholder = input('');
  readonly emptyText = input('');
  /** "Nothing matches “…”", already translated around the search. */
  readonly noMatchText = input('');
  /** The live count: (n, whether a search is on) → text, already translated. */
  readonly countText = input.required<(n: number, searching: boolean) => string>();
  /**
   * Opt-in, off by default (ACC-120 slice 4): each row is a button, and
   * pressing it emits `picked`. Off, the rows are exactly ACC-230's.
   */
  readonly selectable = input(false);
  /**
   * Opt-in, with `selectable`: a row's reason it can't be picked, or null.
   * Given, every row gets one more cell for the reason (empty when none), so
   * `columns` and `grid` carry one more track for it.
   */
  readonly rowDisabled = input<((row: T) => string | null) | null>(null);
  /** A pickable row was pressed (never one with a reason). */
  readonly picked = output<T>();

  readonly qInput = signal('');
  readonly q = signal('');
  readonly sortValue = signal('');
  readonly phase = signal<'loading' | 'ready' | 'error'>('loading');
  readonly more = signal<'idle' | 'loading' | 'failed'>('idle');
  readonly items = signal<T[]>([]);
  readonly total = signal(0);
  readonly matching = signal(0);
  readonly phone = signal(false);
  protected readonly skeleton = Array.from({ length: 8 }, (_, i) => i);

  private request: Subscription | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  readonly query = computed(() => {
    const [sort, dir] = (this.sortValue() || this.defaultSort()).split(':') as [string, 'asc' | 'desc'];
    return { q: this.q() || undefined, sort, dir: dir ?? 'asc' };
  });

  readonly liveText = computed(() => {
    this.translate.currentLang();
    if (this.phase() === 'loading') return this.translate.instant('record.loading');
    if (this.phase() === 'error') return '';
    return this.countText()(this.q() ? this.matching() : this.total(), !!this.q());
  });

  readonly footText = computed(() => {
    this.translate.currentLang();
    const n = (v: number) => this.format.number(v);
    if (this.q()) return this.translate.instant('record.footMatchOf', { matching: n(this.matching()), total: n(this.total()) });
    if (this.items().length >= this.total()) return this.translate.instant('record.footAll', { total: n(this.total()) });
    return this.translate.instant('record.footShowing', { shown: n(this.items().length), total: n(this.total()) });
  });

  constructor() {
    const destroyRef = inject(DestroyRef);
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SIMPLE_LIST_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      destroyRef.onDestroy(() => media.removeEventListener('change', onChange));
    }
    destroyRef.onDestroy(() => {
      this.request?.unsubscribe();
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    // Every change of search or sort starts again from the first page.
    effect(() => {
      this.query();
      untracked(() => this.reload());
    });
  }

  trackId(item: T): string {
    return item.id;
  }

  reasonFor(item: T): string | null {
    return this.rowDisabled()?.(item) ?? null;
  }

  pick(item: T): void {
    if (this.reasonFor(item)) return;
    this.picked.emit(item);
  }

  onSearch(value: string): void {
    this.qInput.set(value);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(value.trim()), SEARCH_DELAY_MS);
  }

  clearSearch(): void {
    this.qInput.set('');
    this.q.set('');
  }

  /** From the first page, keeping the search and the sort (after an action on a row). */
  reload(): void {
    this.request?.unsubscribe();
    this.phase.set('loading');
    this.more.set('idle');
    this.request = this.load()({ ...this.query(), take: PAGE, skip: 0 }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.phase.set('ready');
      },
      error: () => this.phase.set('error'),
    });
  }

  loadMore(): void {
    if (this.more() === 'loading') return;
    this.more.set('loading');
    this.request?.unsubscribe();
    this.request = this.load()({ ...this.query(), take: PAGE, skip: this.items().length }).subscribe({
      next: (page) => {
        this.items.update((rows) => [...rows, ...page.items.filter((r) => !rows.some((x) => x.id === r.id))]);
        this.total.set(page.total);
        this.matching.set(page.matching);
        this.more.set('idle');
      },
      error: () => this.more.set('failed'),
    });
  }
}
