// The New Task step strip, rendered in the DIALOG HEADER (ACC-96).
//
// Template 3 draws it there — inside the same header block as the title, the
// context line and the ✕, with the body starting after it. Two consequences,
// both of them the point:
//
//   - THE HEADER DOES NOT CHANGE between step 1's fields and its date view.
//     That is what tells a user they have not moved to another step, and it is
//     why the strip cannot live in the body, which the date view replaces.
//   - It costs NOTHING against the 420px body cap. In the body it cost 37px
//     with its gap, which is why the date view had to hide it — a deviation
//     this removes rather than works around.
//
// Same instance-passing shape as TaskFormFooterComponent, and for the same
// reason: p-dialog collects pTemplate children at content init, so the host's
// header template must exist from the start and the form instance travels
// outward to fill it.
import { Component, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { TaskFormComponent } from './task-form.component';

@Component({
  selector: 'app-task-form-steps',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (form(); as f) {
      <ol class="am-steps" [attr.aria-label]="'task.steps' | translate">
        @for (s of f.steps; track s.n) {
          <li
            class="am-steps__item"
            [class.am-steps__item--on]="f.step() === s.n"
            [attr.aria-current]="f.step() === s.n ? 'step' : null"
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
export class TaskFormStepsComponent {
  readonly form = input<TaskFormComponent | null>(null);
}
