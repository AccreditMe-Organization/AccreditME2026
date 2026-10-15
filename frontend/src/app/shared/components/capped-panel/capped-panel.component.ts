import { ChangeDetectionStrategy, Component, ViewEncapsulation, inject, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { FormatService } from '../../../core/formatting';

/** The panel shows at most this many rows; "See all" is the only full view. */
export const CAPPED_PANEL_ROWS = 5;

export type CappedPanelState = 'loading' | 'error' | 'ready';

/**
 * `am-capped-panel` — a record page's list panel, CAPPED (ACC-230, from the
 * record Tasks panel of ACC-229; the drawing's "Compact List Panel").
 *
 * - **A body of FIXED height** — 294px English, 328px Arabic, footer included —
 *   that never grows and never scrolls, so panels in a row stay equal. Five
 *   rows of 52 / 58 fit it exactly; with fewer the space below is quiet.
 * - **The header count is the total**, never the rows shown.
 * - **"Showing 5 of 16 · See all"** only when there are more than it shows.
 * - Loading is five skeleton rows; an error sits in the body only, with Retry.
 *
 * The rows are the caller's (default content), as `li.am-cp-row` with an
 * `am-cp-l1` and an `am-cp-l2` line, so every panel's rows share one height.
 * Header actions go in `[amPanelActions]`. Not encapsulated, so those classes
 * reach the caller's rows; every class is prefixed `am-cp`.
 *
 * `testIdPrefix` names the parts (`{prefix}-head`, `-body`, `-count`, `-foot`,
 * `-see-all`, `-error`, `-empty`), so each panel keeps its own test hooks.
 */
@Component({
  selector: 'am-capped-panel',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="am-cp" [attr.aria-labelledby]="headingId" [attr.data-testid]="testIdPrefix() + '-panel'">
      <header class="am-cp__head" [attr.data-testid]="testIdPrefix() + '-head'">
        <h2 class="am-cp__title" [id]="headingId">{{ heading() }}</h2>
        <span class="am-cp__count" [attr.data-testid]="testIdPrefix() + '-count'">{{ state() === 'ready' ? format.number(total()) : '—' }}</span>
        <span class="flex-1"></span>
        <ng-content select="[amPanelActions]" />
      </header>

      <div class="am-cp__body" [attr.data-testid]="testIdPrefix() + '-body'" [attr.aria-busy]="state() === 'loading'">
        @switch (state()) {
          @case ('loading') {
            <span class="sr-only" aria-live="polite">{{ loadingText() }}</span>
            @for (i of skeleton; track i) {
              <div class="am-cp-row am-cp__skeleton" aria-hidden="true"><span></span><span></span></div>
            }
          }
          @case ('error') {
            <div class="am-cp__state" role="alert" [attr.data-testid]="testIdPrefix() + '-error'">
              <p class="m-0">{{ errorText() }}</p>
              <button type="button" class="am-cp__link" (click)="retry.emit()">{{ 'list.retry' | translate }}</button>
            </div>
          }
          @default {
            @if (shown() === 0) {
              <p class="am-cp__state" [attr.data-testid]="testIdPrefix() + '-empty'">{{ emptyText() }}</p>
            } @else {
              <ul class="am-cp__list" role="list"><ng-content /></ul>
            }
            @if (total() > shown()) {
              <div class="am-cp__foot" [attr.data-testid]="testIdPrefix() + '-foot'">
                <span>{{ 'record.showing' | translate: { shown: format.number(shown()), total: format.number(total()) } }}</span>
                <span aria-hidden="true">·</span>
                <button type="button" class="am-cp__link" (click)="seeAll.emit()" [attr.data-testid]="testIdPrefix() + '-see-all'">
                  {{ 'record.seeAll' | translate }}
                </button>
              </div>
            }
          }
        }
      </div>
    </section>
  `,
  styles: [
    `
      am-capped-panel{display:block;min-inline-size:0}
      .am-cp{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);overflow:hidden}
      .am-cp__head{display:flex;align-items:center;gap:8px;block-size:42px;box-sizing:border-box;padding:0 12px 0 16px;border-block-end:1px solid var(--am-border)}
      .am-cp__title{margin:0;font-size:14px;line-height:20px;font-weight:600;color:var(--am-ink-900);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .am-cp__count{flex:none;font-size:12px;font-weight:600;color:var(--am-ink-700);background:var(--am-surface);border:1px solid var(--am-border);border-radius:var(--am-radius-pill);padding:0 8px}
      .am-cp__body{display:flex;flex-direction:column;block-size:294px;box-sizing:border-box;overflow:hidden}
      .am-cp__list{list-style:none;margin:0;padding:0}
      .am-cp-row{display:flex;flex-direction:column;justify-content:center;block-size:52px;box-sizing:border-box;padding:4px 12px 4px 16px;border-block-end:1px solid var(--am-border);min-inline-size:0}
      .am-cp-row--sought{background:var(--am-primary-50);box-shadow:inset 3px 0 0 var(--am-primary-600)}
      .am-cp-row:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:-2px}
      .am-cp-l1{display:flex;align-items:center;gap:6px;block-size:26px;min-inline-size:0;font-size:13px}
      .am-cp-l2{display:flex;align-items:center;block-size:18px;line-height:18px;min-inline-size:0;font-size:11.5px;color:var(--am-ink-500)}
      .am-cp-cut{min-inline-size:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .am-cp__foot{margin-block-start:auto;display:flex;align-items:center;gap:6px;block-size:34px;flex:none;padding:0 16px;border-block-start:1px solid var(--am-border);font-size:12px;color:var(--am-ink-700)}
      .am-cp__link{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .am-cp__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-cp__state{margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;font-size:13px;color:var(--am-ink-700)}
      .am-cp__skeleton span{display:block;block-size:10px;border-radius:4px;background:var(--am-surface)}.am-cp__skeleton span+span{margin-block-start:8px;inline-size:60%}
      [dir=rtl] .am-cp__head{block-size:46px;padding:0 16px 0 12px}
      [dir=rtl] .am-cp__body{block-size:328px}
      [dir=rtl] .am-cp-row{block-size:58px;padding:4px 16px 4px 12px}
      [dir=rtl] .am-cp-l2{block-size:22px;line-height:22px;font-size:12px}
      [dir=rtl] .am-cp__foot{block-size:38px}
    `,
  ],
  encapsulation: ViewEncapsulation.None,
})
export class CappedPanelComponent {
  protected readonly format = inject(FormatService);

  /** The panel's title, already translated. */
  readonly heading = input.required<string>();
  readonly state = input.required<CappedPanelState>();
  /** Every row there is — the header count, and the footer's "of N". */
  readonly total = input(0);
  /** How many rows the caller is showing (at most five). */
  readonly shown = input(0);
  /** Said by a screen reader while loading, already translated. */
  readonly loadingText = input('');
  /** The body's error line, already translated. */
  readonly errorText = input('');
  /** The body's line when there is nothing, already translated. */
  readonly emptyText = input('');
  readonly testIdPrefix = input('capped');
  readonly retry = output<void>();
  readonly seeAll = output<void>();

  private static nextId = 0;
  protected readonly headingId = `am-cp-heading-${++CappedPanelComponent.nextId}`;
  protected readonly skeleton = Array.from({ length: CAPPED_PANEL_ROWS }, (_, i) => i);
}
