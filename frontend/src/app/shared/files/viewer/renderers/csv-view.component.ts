import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/**
 * ACC-189 — a CSV file as a table. The file's first row is the header,
 * sticky; a "#" column numbers the data rows. Cut at 500 data rows, with the
 * sentence above the table (the host passes it, already translated). Each cell
 * takes its own direction, truncates with its full text as a tooltip, and is
 * bound as text, never HTML. Selectable and copyable.
 */
@Component({
  selector: 'am-file-csv-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (note()) {
      <p class="am-fcsv__note" role="note"><i class="pi pi-info-circle" aria-hidden="true"></i> {{ note() }}</p>
    }
    <div class="am-fcsv__frame">
      <table class="am-fcsv">
        <thead>
          <tr>
            <th scope="col" class="am-fcsv__num">#</th>
            @for (cell of paddedHeader(); track $index) {
              <th scope="col" dir="auto" [attr.title]="cell || null">{{ cell }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of paddedRows(); track $index; let i = $index) {
            <tr>
              <td class="am-fcsv__num">{{ rowNumbers()[i] }}</td>
              @for (cell of row; track $index) {
                <td dir="auto" [attr.title]="cell || null">{{ cell }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--am-space-16) var(--am-space-20);
      }
      .am-fcsv__note {
        display: flex;
        align-items: center;
        gap: var(--am-space-6);
        margin: 0 0 var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        background: var(--am-info-bg);
        border: 1px solid var(--am-info-border);
        border-radius: var(--am-radius-button);
        font-size: var(--am-type-value-size);
        font-weight: 600;
        color: var(--am-info-ink);
      }
      .am-fcsv__frame {
        overflow: auto;
        max-block-size: 100%;
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-button);
      }
      .am-fcsv {
        border-collapse: separate;
        border-spacing: 0;
        min-inline-size: 100%;
        font-size: var(--am-type-value-size);
        user-select: text;
      }
      .am-fcsv th,
      .am-fcsv td {
        max-inline-size: 320px;
        padding: var(--am-space-6) var(--am-space-12);
        border-block-end: 1px solid var(--am-row-rule);
        border-inline-start: 1px solid var(--am-row-rule);
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        unicode-bidi: plaintext;
      }
      .am-fcsv th {
        position: sticky;
        inset-block-start: 0;
        background: var(--am-surface);
        border-block-end-color: var(--am-border);
        font-size: var(--am-type-micro-size);
        font-weight: 700;
        letter-spacing: var(--am-type-micro-tracking);
        text-transform: var(--am-type-micro-transform);
        color: var(--am-ink-500);
      }
      .am-fcsv .am-fcsv__num {
        border-inline-start: none;
        color: var(--am-ink-300);
        font-variant-numeric: tabular-nums;
      }
    `,
  ],
})
export class FileCsvViewComponent {
  /** The file's first row. */
  readonly header = input.required<readonly string[]>();
  /** The data rows shown (at most 500). */
  readonly rows = input.required<readonly (readonly string[])[]>();
  /** "1", "2", … through the formatting layer — the host formats, so digits stay Latin. */
  readonly rowNumbers = input.required<readonly string[]>();
  /** The cut sentence, or null when nothing was cut. */
  readonly note = input<string | null>(null);

  private readonly width = computed(() => Math.max(this.header().length, ...this.rows().map((r) => r.length)));
  /** Every row, and the header, as wide as the widest, so ragged rows still line up. */
  readonly paddedHeader = computed(() => pad(this.header(), this.width()));
  readonly paddedRows = computed(() => this.rows().map((r) => pad(r, this.width())));
}

function pad(row: readonly string[], width: number): readonly string[] {
  return row.length >= width ? row : [...row, ...new Array<string>(width - row.length).fill('')];
}
