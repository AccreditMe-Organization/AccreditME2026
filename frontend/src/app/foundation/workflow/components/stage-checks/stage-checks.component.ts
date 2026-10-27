import { Component, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';

/** One row of a stage editor section: a record action or a stage meaning. */
export interface StageCheckRow {
  key: string;
  /** Already translated. */
  title: string;
  /** Already translated; '' for none. */
  description: string;
  /** The row's aside, already translated: "Also needs: …" or the cardinality. */
  aside: string;
  checked: boolean;
  /** Changed since the stage was loaded or last saved: tinted, title in blue. */
  changed: boolean;
  /** A refusal about this row, already translated, in the row's own slot; '' for none. */
  error: string;
}

/**
 * ACC-255 PR 4b — the stage editor's two new sections (Workflow Setup,
 * sections 2 and 3) are lists of these rows. Presentational: the panel builds
 * the rows from the template's registries and the stage's stored keys, and
 * this knows no rule. Editable rows are checkboxes labelled by their title;
 * read-only rows (a protected workflow) show ✓ or – with no box to press.
 */
@Component({
  selector: 'am-stage-checks',
  standalone: true,
  imports: [FormsModule, CheckboxModule],
  template: `
    <ul class="am-checks" [attr.aria-label]="label()">
      @for (row of rows(); track row.key) {
        <li
          class="am-checks__row"
          [class.am-checks__row--changed]="row.changed"
          [class.am-checks__row--error]="!!row.error"
          [attr.data-check-row]="row.key"
        >
          @if (readonly()) {
            <span class="am-checks__mark" [class.am-checks__mark--on]="row.checked" aria-hidden="true">{{ row.checked ? '✓' : '–' }}</span>
            <span class="am-checks__text">
              <span class="am-checks__title" [attr.id]="idPrefix() + row.key">{{ row.title }}</span>
              <span class="am-checks__sr">{{ row.checked ? onLabel() : offLabel() }}</span>
              @if (row.description) {
                <span class="am-checks__desc">{{ row.description }}</span>
              }
              @if (row.error) {
                <span class="am-checks__error" role="alert" data-check-error>{{ row.error }}</span>
              }
            </span>
          } @else {
            <p-checkbox
              class="am-checks__box"
              [binary]="true"
              [inputId]="idPrefix() + row.key + '-box'"
              [ngModel]="row.checked"
              (ngModelChange)="toggled.emit({ key: row.key, checked: $event })"
              [invalid]="!!row.error"
              data-check-box
            />
            <span class="am-checks__text">
              <label class="am-checks__title" [attr.for]="idPrefix() + row.key + '-box'">{{ row.title }}</label>
              <span [attr.id]="idPrefix() + row.key + '-desc'">
                @if (row.description) {
                  <span class="am-checks__desc">{{ row.description }}</span>
                }
                @if (row.error) {
                  <span class="am-checks__error" role="alert" data-check-error>{{ row.error }}</span>
                }
              </span>
            </span>
          }
          @if (row.aside) {
            <span class="am-checks__aside" data-check-aside>{{ row.aside }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: [
    `
      .am-checks {
        margin: 0;
        padding: 0;
        list-style: none;
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-control);
        background: var(--am-card);
      }
      .am-checks__row {
        display: flex;
        align-items: flex-start;
        gap: var(--am-space-12);
        padding: var(--am-space-8) var(--am-space-12);
        border-block-end: 1px solid var(--am-border);
      }
      .am-checks__row:last-child {
        border-block-end: 0;
      }
      .am-checks__row--changed {
        background: var(--am-info-bg);
      }
      .am-checks__row--error {
        background: var(--am-danger-bg);
      }
      .am-checks__box {
        flex: none;
        margin-block-start: 1px;
      }
      .am-checks__mark {
        flex: none;
        inline-size: 18px;
        margin-block-start: 1px;
        font-weight: 700;
        text-align: center;
        color: var(--am-text-secondary);
      }
      .am-checks__mark--on {
        color: var(--am-success-ink);
      }
      .am-checks__text {
        display: flex;
        flex-direction: column;
        gap: var(--am-space-2);
        flex: 1 1 0;
        min-inline-size: 0;
      }
      .am-checks__title {
        font-size: var(--am-type-body-size);
        font-weight: 500;
        cursor: pointer;
      }
      .am-checks__row--changed .am-checks__title {
        color: var(--am-primary-700);
      }
      .am-checks__desc {
        display: block;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-text-secondary);
      }
      .am-checks__error {
        display: block;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
        color: var(--am-danger-ink);
      }
      .am-checks__aside {
        flex: none;
        max-inline-size: 42%;
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        color: var(--am-ink-700);
        text-align: end;
      }
      .am-checks__sr {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
      }
      @media (max-width: 559.98px) {
        .am-checks__row {
          flex-wrap: wrap;
        }
        .am-checks__aside {
          max-inline-size: none;
          flex-basis: 100%;
          padding-inline-start: calc(16px + var(--am-space-12));
          text-align: start;
        }
      }
    `,
  ],
})
export class StageChecksComponent {
  readonly rows = input.required<StageCheckRow[]>();
  readonly readonly = input(false);
  /** The list's accessible name: the section's heading. */
  readonly label = input.required<string>();
  /** Keeps the two sections' ids apart. */
  readonly idPrefix = input.required<string>();
  /** Read-only rows: what ✓ and – mean, for a screen reader. */
  readonly onLabel = input('');
  readonly offLabel = input('');
  readonly toggled = output<{ key: string; checked: boolean }>();
}
