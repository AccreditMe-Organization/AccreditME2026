import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

export interface StepStripItem {
  /** The step's number, as shown. */
  n: number;
  /** A translation key, not a label — the strip translates it. */
  key: string;
}

/**
 * The step strip for a stepped dialog, rendered in the dialog HEADER.
 *
 * ## Why it is in the header and not the body
 *
 * Template 3 draws it there, inside the same header block as the title and the
 * ✕, and two things follow — both of them the point:
 *
 *   - THE HEADER DOES NOT CHANGE between steps, which is what tells a reader
 *     they are still in the same dialog.
 *   - It costs NOTHING against the 420px body cap. In the body it measured 37px
 *     with its gap, which is why task-form's date view had to hide it.
 *
 * ## Why it is shared, extracted on the SECOND use
 *
 * ACC-96 put this markup and its CSS inside `TaskFormStepsComponent`, where the
 * styles are component-scoped. ACC-120 slice 6 needed the same strip for the
 * lookup value form, and copying the CSS is how two strips drift into looking
 * like two different things. So it is extracted here and takes plain data
 * rather than a form instance — a presentational component that knows nothing
 * about whose steps these are.
 *
 * Renders NOTHING for fewer than two steps. A one-step form has no steps to
 * show, and a caller should not have to remember to hide the strip itself: the
 * lookup value form has a second step only when its category defines
 * attributes, so "how many steps" is data, not a layout decision.
 */
@Component({
  selector: 'am-step-strip',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (steps().length > 1) {
      <ol class="am-steps" [attr.aria-label]="ariaLabel()">
        @for (s of steps(); track s.n) {
          <li
            class="am-steps__item"
            [class.am-steps__item--on]="current() === s.n"
            [attr.aria-current]="current() === s.n ? 'step' : null"
          >
            <span class="am-steps__n">{{ s.n }}</span>
            <span>{{ s.key | translate }}</span>
          </li>
        }
      </ol>
    }
  `,
  styles: [
    `
      .am-steps {
        display: flex;
        gap: 1.25rem;
        margin: 9px 0 0;
        padding: 0;
        list-style: none;
      }

      .am-steps__item {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        font-size: 12px;
        font-weight: 400;
        color: var(--am-ink-500);
      }

      .am-steps__item--on {
        color: var(--am-primary-700);
        font-weight: 600;
      }

      .am-steps__n {
        display: flex;
        align-items: center;
        justify-content: center;
        inline-size: 18px;
        block-size: 18px;
        border-radius: 999px;
        border: 1px solid currentColor;
        font-size: 11px;
      }
    `,
  ],
})
export class StepStripComponent {
  readonly steps = input<readonly StepStripItem[]>([]);
  readonly current = input<number>(1);
  /** Already translated by the caller — this is an attribute, not content. */
  readonly ariaLabel = input<string>('');
}
