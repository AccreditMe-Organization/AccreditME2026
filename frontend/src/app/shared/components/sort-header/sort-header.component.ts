import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export type SortDir = 'asc' | 'desc';

/** A list's sort: the server's column key and its direction. */
export interface SortState {
  key: string;
  dir: SortDir;
}

/**
 * ACC-234 — what pressing a column header does, written once: the first press
 * on a column sorts it ascending, pressing the sorted column flips it, and so
 * on. Every list that sorts by header (`app-data-list`, `am-simple-list`, the
 * All tasks list) asks this.
 */
export function nextSort(current: SortState | null, key: string): SortState {
  return { key, dir: current?.key === key && current.dir === 'asc' ? 'desc' : 'asc' };
}

/**
 * `am-sort-header` — ONE column header a list can be sorted by (ACC-234,
 * Ahmad 17 Oct: lists sort by clicking column headers, never by a toolbar sort
 * dropdown, except on phone cards).
 *
 * The host IS the header cell (`role="columnheader"`), so it is the grid item
 * and carries `aria-sort` while its column is the sorted one. Inside it a real
 * button, so the keyboard works for free, whose accessible name says what it
 * does ("Sort by Due") and still begins with the visible label (WCAG 2.5.3).
 * The arrow (▲ ascending, ▼ descending) follows the label in reading order,
 * so in Arabic it sits to the label's left; it is hidden from screen readers,
 * which hear `aria-sort` instead.
 *
 * A column the server cannot sort by is NOT this component: it stays plain
 * text in a `role="columnheader"` cell.
 */
@Component({
  selector: 'am-sort-header',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'columnheader',
    class: 'am-sh',
    '[attr.aria-sort]': 'ariaSort()',
    '[attr.data-sort-key]': 'key()',
  },
  template: `
    <button
      type="button"
      class="am-sh__btn"
      [attr.aria-label]="'list.sortBy' | translate: { column: label() }"
      [attr.title]="label()"
      (click)="sort.emit(key())"
    >
      <span class="am-sh__label">{{ label() }}</span>
      @if (dir(); as d) {
        <span class="am-sh__arrow" aria-hidden="true" data-testid="sort-arrow">{{ d === 'asc' ? '▲' : '▼' }}</span>
      }
    </button>
  `,
  styles: [
    `
      :host{display:flex;align-items:center;min-inline-size:0}
      .am-sh__btn{display:inline-flex;align-items:center;gap:4px;max-inline-size:100%;min-inline-size:0;margin:0;padding:0;border:0;background:none;font:inherit;color:inherit;text-transform:inherit;letter-spacing:inherit;text-align:start;cursor:pointer}
      .am-sh__btn:hover,:host([aria-sort]) .am-sh__btn{color:var(--am-primary-700)}
      .am-sh__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset);border-radius:2px}
      .am-sh__label{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-sh__arrow{flex:none;font-size:9px;line-height:1}
    `,
  ],
})
export class SortHeaderComponent {
  /** The server's sort key for this column. */
  readonly key = input.required<string>();
  /** The column's visible label, already translated. */
  readonly label = input.required<string>();
  /** The list's current sort; this header shows an arrow only when it is the sorted column. */
  readonly current = input<SortState | null>(null);
  /** Pressed: the column's key. The list decides the next sort with `nextSort()`. */
  readonly sort = output<string>();

  readonly dir = computed<SortDir | null>(() => {
    const c = this.current();
    return c && c.key === this.key() ? c.dir : null;
  });
  readonly ariaSort = computed(() => (this.dir() === 'asc' ? 'ascending' : this.dir() === 'desc' ? 'descending' : null));
}
