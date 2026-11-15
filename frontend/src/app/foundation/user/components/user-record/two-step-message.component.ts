import { Component, input } from '@angular/core';

/**
 * The message about no field in the two two-step dialogs — ACC-164, the
 * design's "banner": red for a failure (locked, refused, unreachable), blue for
 * news that is not a failure (already off). Said as an alert or a status, so a
 * screen reader hears it without moving focus.
 */
@Component({
  selector: 'am-two-step-message',
  standalone: true,
  template: `<p
    class="am-two-step-message"
    [class.am-two-step-message--info]="tone() === 'info'"
    [attr.role]="tone() === 'info' ? 'status' : 'alert'"
  >{{ text() }}</p>`,
  styles: [
    `
      :host {
        display: block;
      }
      .am-two-step-message {
        margin: 0;
        padding: var(--am-space-8) 10px;
        border-radius: var(--am-radius-button);
        border: 1px solid var(--am-danger-border);
        background: var(--am-danger-bg);
        color: var(--am-danger-ink);
        font-size: var(--am-type-meta-size);
        line-height: var(--am-type-meta-line);
        font-weight: 500;
      }
      .am-two-step-message--info {
        border-color: var(--am-info-border);
        background: var(--am-info-bg);
        color: var(--am-info-ink);
      }
    `,
  ],
})
export class TwoStepMessageComponent {
  readonly tone = input<'danger' | 'info'>('danger');
  readonly text = input.required<string>();
}
