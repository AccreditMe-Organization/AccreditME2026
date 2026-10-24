import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ChangeField } from './change-request.service';

export interface ChangeRow {
  field: ChangeField;
  label: string;
  current: string;
  /** The value from before, struck through (an applied request). */
  struck: boolean;
  proposed: string;
  /** The live value has moved since the request was submitted. */
  drift: boolean;
  /** Long text: two lines, then an ellipsis, the whole value in a tooltip. */
  long: boolean;
}

/**
 * ACC-240 — the request page's "What changes" table (plan §3.3, D5): Field,
 * Current and Proposed, changed fields only. The page decides each row; this
 * draws it. On a phone a row is one column: the field, then Current, then
 * Proposed, each named for a screen reader by the same headers.
 */
@Component({
  selector: 'am-change-request-changes',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    <div class="am-crc" role="table" aria-labelledby="crp-h-changes">
      <div class="am-crc__tr am-crc__th" role="row" [class.sr-only]="phone()">
        <span role="columnheader">{{ 'committee.changeRequest.page.col.field' | translate }}</span>
        <span role="columnheader">{{ 'committee.changeRequest.page.col.current' | translate }}</span>
        <span role="columnheader">{{ 'committee.changeRequest.page.col.proposed' | translate }}</span>
      </div>
      @for (row of rows(); track row.field) {
        <div class="am-crc__tr" [class.am-crc__tr--phone]="phone()" role="row" [attr.data-crp-row]="row.field">
          <span role="cell" class="am-crc__field">{{ row.label }}</span>
          <span role="cell" class="am-crc__current">
            <span class="am-crc__v" [class.am-crc__v--struck]="row.struck" [class.am-crc__v--long]="row.long" [attr.title]="row.long ? row.current : null" data-testid="crp-current">{{
              row.current
            }}</span>
            @if (row.drift) {
              <span class="am-crc__drift" data-testid="crp-drift">{{ 'committee.changeRequest.page.driftMark' | translate }}</span>
            }
          </span>
          <span role="cell" class="am-crc__proposed">
            @if (phone()) {
              <span class="am-crc__arrow" aria-hidden="true">→</span>
            }
            <span class="am-crc__v" [class.am-crc__v--long]="row.long" [attr.title]="row.long ? row.proposed : null" data-testid="crp-proposed">{{ row.proposed }}</span>
          </span>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0}
      .am-crc{display:flex;flex-direction:column}
      .am-crc__tr{display:grid;grid-template-columns:minmax(0,180px) minmax(0,1fr) minmax(0,1fr);gap:var(--am-space-12);padding:8px 0;border-block-start:1px solid var(--am-border);font-size:13px}
      .am-crc__tr > *{min-inline-size:0}
      .am-crc__th{border-block-start:0;padding-block-start:0;font-size:12px;font-weight:600;color:var(--am-ink-500)}
      .am-crc__tr--phone{grid-template-columns:minmax(0,1fr);gap:var(--am-space-2)}
      .am-crc__field{font-weight:600;color:var(--am-ink-900)}
      .am-crc__current{display:flex;flex-direction:column;gap:var(--am-space-2);color:var(--am-ink-700)}
      .am-crc__proposed{display:flex;gap:var(--am-space-4);color:var(--am-ink-900);font-weight:500}
      .am-crc__arrow{flex:none;color:var(--am-ink-500)}
      [dir=rtl] .am-crc__arrow{transform:scaleX(-1)}
      .am-crc__v{overflow-wrap:anywhere;min-inline-size:0}
      .am-crc__v--struck{text-decoration:line-through}
      .am-crc__v--long{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden}
      .am-crc__drift{font-size:11.5px;font-weight:600;color:var(--am-warning-ink)}
    `,
  ],
})
export class ChangeRequestChangesComponent {
  readonly rows = input.required<readonly ChangeRow[]>();
  readonly phone = input(false);
}
