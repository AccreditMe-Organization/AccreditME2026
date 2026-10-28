import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { FormatService } from '../../../core/formatting';
import { StepState, TestView } from './storage-setup';

const GLYPH: Record<StepState, string> = { done: '✓', fail: '✕', wait: '○', skip: '–' };

/**
 * ACC-260, PR B — the connection test box (design L575–593, L618–636): a head
 * line, the button, and the steps with ✓ ✕ ○ – AND words, so no state rests on
 * colour. A failed step says what to check in the screen's own words; the
 * server's message is never shown (it can name a host).
 */
@Component({
  selector: 'am-storage-test-box',
  standalone: true,
  imports: [TranslatePipe, ButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="am-tb"
      [class.am-tb--run]="view().tone === 'run'"
      [class.am-tb--pass]="view().tone === 'pass'"
      [class.am-tb--fail]="view().tone === 'fail'"
      [class.am-tb--stale]="view().tone === 'stale'"
      [attr.aria-busy]="view().tone === 'run' ? 'true' : null"
      data-testid="test-box"
      [attr.data-tone]="view().tone"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="am-tb__head" role="status" data-testid="test-head">{{ head() }}</span>
        <p-button
          type="button"
          size="small"
          [outlined]="true"
          [label]="view().buttonKey | translate"
          [disabled]="view().tone === 'run'"
          (onClick)="run.emit()"
          data-testid="test-run"
        />
      </div>
      @if (view().found; as found) {
        <!-- ACC-260 PR C: what a passing SharePoint test reached, before Confirm.
             The customer's own names, isolated left to right (rule 6). -->
        <p class="am-tb__found" data-testid="test-found">
          {{ 'storage.test.found' | translate }}: <bdi dir="ltr" data-testid="test-found-value">{{ found }}</bdi>
        </p>
      }
      @if (view().steps; as steps) {
        <ol class="am-tb__steps" [attr.aria-label]="'storage.test.stepsLabel' | translate">
          @for (s of steps; track s.step) {
            <li class="am-tb__step" [attr.data-step]="s.step" [attr.data-state]="s.state">
              <span class="am-tb__glyph" [class.am-tb__glyph--done]="s.state === 'done'" [class.am-tb__glyph--fail]="s.state === 'fail'" aria-hidden="true">{{ glyph(s.state) }}</span>
              <span class="min-w-0">
                <span class="am-tb__name" [class.am-tb__name--fail]="s.state === 'fail'" [class.am-tb__name--quiet]="s.state === 'wait' || s.state === 'skip'">
                  {{ 'storage.test.step.' + s.step | translate }}<span class="sr-only"> · {{ 'storage.test.state.' + s.state | translate }}</span>
                </span>
                @if (s.detailKey) {
                  <span class="am-tb__detail" data-testid="test-detail">{{ s.detailKey | translate }}</span>
                }
              </span>
            </li>
          }
        </ol>
      }
      @if (view().noteKey; as note) {
        <p class="am-tb__note" data-testid="test-note">{{ note | translate }}</p>
      }
    </section>
  `,
  styles: [
    `
      .am-tb{border-radius:var(--am-radius-card);padding:var(--am-space-8) var(--am-space-12);background:var(--am-surface);border:1px solid var(--am-border)}
      .am-tb--run{background:var(--am-info-bg);border-color:var(--am-info-border)}
      .am-tb--pass{background:var(--am-success-bg);border-color:var(--am-success-border)}
      .am-tb--fail{background:var(--am-danger-bg);border-color:var(--am-danger-border)}
      .am-tb--stale{background:var(--am-warning-bg);border-color:var(--am-warning-border)}
      .am-tb__head{font-size:var(--am-type-body-size);line-height:var(--am-type-body-line);font-weight:600;color:var(--am-ink-900)}
      .am-tb--run .am-tb__head{color:var(--am-info-ink)}
      .am-tb--pass .am-tb__head{color:var(--am-success-ink)}
      .am-tb--fail .am-tb__head{color:var(--am-danger-ink)}
      .am-tb--stale .am-tb__head{color:var(--am-warning-ink)}
      .am-tb__steps{list-style:none;margin:var(--am-space-8) 0 0;padding:0;display:flex;flex-direction:column;gap:var(--am-space-4)}
      .am-tb__step{display:grid;grid-template-columns:var(--am-space-16) minmax(0,1fr);gap:var(--am-space-8);align-items:start}
      .am-tb__glyph{font-size:var(--am-type-meta-size);line-height:var(--am-type-value-line);font-weight:700;text-align:center;color:var(--am-ink-500)}
      .am-tb__glyph--done{color:var(--am-success-ink)}
      .am-tb__glyph--fail{color:var(--am-danger-ink)}
      .am-tb__name{display:block;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);color:var(--am-ink-900)}
      .am-tb__name--fail{font-weight:600;color:var(--am-danger-ink)}
      .am-tb__name--quiet{color:var(--am-ink-500)}
      .am-tb__detail{display:block;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-900)}
      .am-tb__found{margin:var(--am-space-4) 0 0;font-size:var(--am-type-value-size);line-height:var(--am-type-value-line);font-weight:500;color:var(--am-ink-900);overflow-wrap:anywhere}
      .am-tb__note{margin:var(--am-space-6) 0 0;font-size:var(--am-type-meta-size);line-height:var(--am-type-meta-line);color:var(--am-ink-700)}
    `,
  ],
})
export class StorageTestBoxComponent {
  private readonly format = inject(FormatService);

  readonly view = input.required<TestView>();
  /** The pass line, e.g. "✓ New key works · tested {{time}}" while replacing keys. */
  readonly passHeadKey = input('storage.test.passed');
  readonly run = output<void>();

  glyph(state: StepState): string {
    return GLYPH[state];
  }

  // Not a pipe chain: the pass line needs the time through the formatting layer.
  protected head(): string {
    const v = this.view();
    return v.tone === 'pass' && v.at ? this.translate(this.passHeadKey(), { time: this.format.timeOfDay(v.at) }) : this.translate(v.headKey);
  }

  private readonly translateService = inject(TranslateService);
  private translate(key: string, params?: Record<string, unknown>): string {
    return this.translateService.instant(key, params);
  }
}
