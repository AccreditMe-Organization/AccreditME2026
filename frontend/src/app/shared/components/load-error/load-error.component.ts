import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

/**
 * `am-load-error` — A PANEL'S READ FAILED: the record panel's error block (artboard
 * 8), as ONE shared piece. The message, the error id when the server sent one, and
 * the small outlined "Retry" / «إعادة المحاولة» (common.retry), which asks again.
 *
 * Used by `app-record-panel` and `am-capped-panel` (CC-331), so every record panel
 * and every capped panel — the Tasks, Members, Sub-committees and Signed-in devices
 * panels — fails the same way. Never copy this block into a panel.
 */
@Component({
  selector: 'am-load-error',
  standalone: true,
  imports: [TranslatePipe, ButtonModule, MessageModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col items-start gap-2 p-4" role="alert" data-panel-error>
      <p-message severity="error" [text]="message()" />
      @if (errorId(); as id) {
        <span
          dir="ltr"
          class="text-xs text-[var(--am-ink-500)] [unicode-bidi:isolate]"
          [attr.data-testid]="testIdPrefix() ? testIdPrefix() + '-error-id' : null"
        >
          {{ 'recordPanel.errorId' | translate: { id } }}
        </span>
      }
      <p-button size="small" [outlined]="true" [label]="'common.retry' | translate" (onClick)="retry.emit()" />
    </div>
  `,
})
export class LoadErrorComponent {
  /** What failed, already translated. */
  readonly message = input.required<string>();
  /** The id support can act on, when the server sent one. */
  readonly errorId = input<string | null | undefined>(null);
  /** Names the error id `{prefix}-error-id`, for a panel's own test hooks. */
  readonly testIdPrefix = input<string | null>(null);
  readonly retry = output<void>();
}
