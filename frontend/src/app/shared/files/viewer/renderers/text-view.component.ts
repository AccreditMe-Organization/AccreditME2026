import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * ACC-189 — a text file as text. Monospace, wrapped, never scrolling sideways,
 * and EACH LINE TAKES ITS OWN DIRECTION (`dir="auto"`): an Arabic line starts
 * from the right and a Latin one from the left, in either interface language.
 * Lines are bound with text interpolation, never innerHTML, so `<script>` is
 * five characters and a word. Selectable and copyable.
 */
@Component({
  selector: 'am-file-text-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-ftext">
      @for (line of lines(); track $index) {
        <div class="am-ftext__line" dir="auto">
          @if (line) {
            {{ line }}
          } @else {
            &nbsp;
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: var(--am-space-24) var(--am-space-20);
      }
      .am-ftext {
        max-inline-size: 860px;
        margin-inline: auto;
        box-sizing: border-box;
        padding: var(--am-space-16) var(--am-space-20);
        background: var(--am-surface-raised);
        border: 1px solid var(--am-border);
        border-radius: var(--am-radius-button);
        font-family: var(--am-font-mono);
        font-size: var(--am-type-value-size);
        line-height: var(--am-type-body-line);
        color: var(--am-ink-900);
        user-select: text;
      }
      .am-ftext__line {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        unicode-bidi: plaintext;
        text-align: start;
      }
    `,
  ],
})
export class FileTextViewComponent {
  readonly lines = input.required<readonly string[]>();
}
