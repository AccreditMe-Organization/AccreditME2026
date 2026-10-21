import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';
import { FormatService } from '../../../../core/formatting';
import { CappedPanelComponent, CappedPanelState, CAPPED_PANEL_ROWS } from '../../../../shared/components/capped-panel/capped-panel.component';
import { ListDialogComponent } from '../../../../shared/components/list-dialog/list-dialog.component';
import {
  SimpleListColumn,
  SimpleListComponent,
  SimpleListPage,
  SimpleListQuery,
} from '../../../../shared/components/simple-list/simple-list.component';

/** One row, already in the reader's language. */
export interface UnitPanelItem {
  id: string;
  /** Line 1: the name, or what stands in for a hidden one. */
  primary: string;
  /** The row's own page, only when the viewer may open it. */
  link: readonly unknown[] | null;
  /** Line 1 shown muted: a hidden name, or nothing named. */
  muted?: boolean;
  /** Line 2. */
  secondary: string;
  /** A count at the row's end (headcount, holders). */
  trailing?: string;
  /** The popup's cells after the first, which is `primary`. */
  cells: string[];
  /** What the popup's search matches, lower case. */
  search: string;
  /** The popup's sort values, by column sort key. */
  sort: Record<string, number | string>;
}

/**
 * ACC-120 slice 11, PR D — a list panel on the org unit record: capped at five
 * in `am-capped-panel` (D10), with "See all" opening `am-list-dialog` +
 * `am-simple-list`.
 *
 * The rows come from the unit summary the page already holds, so the popup
 * searches and sorts them in memory (ACC-230's shape for a small list read
 * once). The caller decides the five shown: they are `items` in the caller's
 * order.
 */
@Component({
  selector: 'am-unit-list-panel',
  standalone: true,
  imports: [RouterLink, CappedPanelComponent, ListDialogComponent, SimpleListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <am-capped-panel
      [heading]="heading()"
      [state]="state()"
      [total]="total() ?? items().length"
      [shown]="shown().length"
      [offersSeeAll]="offersSeeAll()"
      [loadingText]="loadingText()"
      [errorText]="errorText()"
      [emptyText]="emptyText()"
      [testIdPrefix]="testIdPrefix()"
      (retry)="retry.emit()"
      (seeAll)="popupOpen.set(true)"
    >
      <ng-container ngProjectAs="[amPanelActions]"><ng-content select="[amPanelActions]" /></ng-container>
      @for (item of shown(); track item.id) {
        <li class="am-cp-row" [attr.data-row]="item.id">
          <span class="am-cp-l1">
            @if (item.link) {
              <a class="am-ulp__name am-cp-cut" [routerLink]="item.link" [attr.title]="item.primary">{{ item.primary }}</a>
            } @else {
              <span class="am-cp-cut" [class.am-ulp__muted]="item.muted" [attr.title]="item.primary">{{ item.primary }}</span>
            }
            @if (item.trailing) {
              <span class="am-ulp__count">{{ item.trailing }}</span>
            }
          </span>
          <span class="am-cp-l2"><span class="am-cp-cut" [attr.title]="item.secondary">{{ item.secondary }}</span></span>
        </li>
      }
    </am-capped-panel>

    <ng-template #cells let-item>
      @if (item.link) {
        <a class="am-ulp__name am-cp-cut" [routerLink]="item.link">{{ item.primary }}</a>
      } @else {
        <span class="am-cp-cut" [class.am-ulp__muted]="item.muted">{{ item.primary }}</span>
      }
      @for (cell of item.cells; track $index) {
        <span class="am-cp-cut text-ink-700">{{ cell }}</span>
      }
    </ng-template>
    <ng-template #popupBody>
      <am-simple-list
        [load]="loadPage"
        [columns]="columns()"
        [grid]="grid()"
        [row]="cells"
        [defaultSort]="defaultSort()"
        [searchLabel]="searchLabel()"
        [searchPlaceholder]="searchLabel()"
        [emptyText]="emptyText()"
        [noMatchText]="noMatchText()"
        [countText]="countText()"
      />
    </ng-template>
    <am-list-dialog
      size="compact"
      [visible]="popupOpen()"
      [heading]="popupHeading()"
      [count]="format.number(items().length)"
      [closeLabel]="closeLabel()"
      [body]="popupBody"
      (closeRequested)="popupOpen.set(false)"
    />
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-ulp__name{font-weight:500;color:var(--am-primary-700);text-decoration:none}
      .am-ulp__name:hover{text-decoration:underline}
      .am-ulp__name:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-ulp__muted{color:var(--am-ink-500)}
      .am-ulp__count{flex:none;margin-inline-start:auto;font-size:12px;color:var(--am-ink-700);font-variant-numeric:tabular-nums}
    `,
  ],
})
export class UnitListPanelComponent {
  protected readonly format = inject(FormatService);

  readonly heading = input.required<string>();
  readonly testIdPrefix = input.required<string>();
  readonly state = input<CappedPanelState>('ready');
  /** Every row, in the order the panel shows its first five. */
  readonly items = input.required<UnitPanelItem[]>();
  /** The header count when it is not the rows held (a count without names, D7). */
  readonly total = input<number | null>(null);
  readonly offersSeeAll = input(true);
  readonly loadingText = input('');
  readonly errorText = input('');
  readonly emptyText = input.required<string>();
  readonly popupHeading = input.required<string>();
  readonly closeLabel = input.required<string>();
  readonly columns = input.required<SimpleListColumn[]>();
  readonly grid = input.required<string>();
  readonly defaultSort = input.required<string>();
  readonly searchLabel = input.required<string>();
  readonly noMatchText = input('');
  readonly countText = input.required<(n: number, searching: boolean) => string>();
  readonly retry = output<void>();

  readonly popupOpen = signal(false);

  protected shown(): UnitPanelItem[] {
    return this.items().slice(0, CAPPED_PANEL_ROWS);
  }

  /** The popup's read: the rows in memory, searched, sorted and paged. */
  readonly loadPage = (query: SimpleListQuery): Observable<SimpleListPage<UnitPanelItem>> => {
    const all = this.items();
    const q = (query.q ?? '').trim().toLowerCase();
    const matching = q ? all.filter((i) => i.search.includes(q)) : all;
    const dir = query.dir === 'desc' ? -1 : 1;
    const sorted = [...matching].sort((a, b) => {
      const x = a.sort[query.sort];
      const y = b.sort[query.sort];
      const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''));
      return cmp * dir || a.primary.localeCompare(b.primary);
    });
    return of({ items: sorted.slice(query.skip, query.skip + query.take), total: all.length, matching: matching.length });
  };
}
