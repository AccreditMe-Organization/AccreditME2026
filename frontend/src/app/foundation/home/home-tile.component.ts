import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

export type HomeTileState = 'loading' | 'failed' | 'ready';
export type HomeTileTone = 'danger' | 'warning' | null;

/**
 * ACC-279 — one of Home's count tiles, from the App Shell design: a label, a
 * number and an optional meta line.
 *
 * A count that has not loaded shows a skeleton; one that FAILED says so with
 * Try again, and never shows 0 (plan §4). The meta line has its own state for
 * the one tile whose meta is a second read (Open tasks' overdue count).
 *
 * The number is the tile's link when it has one, so the tile is one tab stop.
 */
@Component({
  selector: 'am-home-tile',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="am-tile" [attr.data-testid]="testId()" [attr.aria-busy]="state() === 'loading'">
      <div class="am-tile__label">{{ label() }}</div>
      @switch (state()) {
        @case ('loading') {
          <div class="am-tile__skeleton" aria-hidden="true"></div>
          <span class="sr-only">{{ 'common.loading' | translate }}</span>
        }
        @case ('failed') {
          <div class="am-tile__failed" role="alert" [attr.data-testid]="testId() + '-failed'">
            <span>{{ 'home.tile.failed' | translate }}</span>
            <button type="button" class="am-tile__retry" (click)="retry.emit()" [attr.data-testid]="testId() + '-retry'">
              {{ 'list.retry' | translate }}
            </button>
          </div>
        }
        @default {
          <div class="am-tile__row">
            @if (link(); as to) {
              <a class="am-tile__value am-tile__value--link" [routerLink]="to" [attr.aria-label]="label() + ': ' + value()" [attr.data-testid]="testId() + '-value'">{{ value() }}</a>
            } @else {
              <span class="am-tile__value" [attr.data-testid]="testId() + '-value'">{{ value() }}</span>
            }
            @switch (metaState()) {
              @case ('failed') {
                <span class="am-tile__meta am-tile__meta--failed" role="alert" [attr.data-testid]="testId() + '-meta-failed'">
                  {{ metaFailedText() }}
                  <button type="button" class="am-tile__retry" (click)="metaRetry.emit()" [attr.data-testid]="testId() + '-meta-retry'">
                    {{ 'list.retry' | translate }}
                  </button>
                </span>
              }
              @case ('ready') {
                @if (meta()) {
                  <span class="am-tile__meta" [class.am-tile__meta--danger]="tone() === 'danger'" [class.am-tile__meta--warning]="tone() === 'warning'" [attr.data-testid]="testId() + '-meta'">{{ meta() }}</span>
                }
              }
            }
          </div>
        }
      }
    </div>
  `,
  styles: [
    `
      am-home-tile{display:block;min-inline-size:0}
      .am-tile{background:var(--am-surface-raised);border:1px solid var(--am-border);border-radius:var(--am-radius-card);padding:11px 14px;box-sizing:border-box;block-size:100%;min-inline-size:0}
      .am-tile__label{font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.05em;text-transform:uppercase;color:var(--am-ink-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      [dir=rtl] .am-tile__label{letter-spacing:0;text-transform:none;font-size:12px}
      .am-tile__row{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 7px;margin-block-start:4px;min-inline-size:0}
      .am-tile__value{font-size:25px;line-height:32px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--am-ink-900);text-decoration:none}
      .am-tile__value--link:hover{text-decoration:underline}
      .am-tile__value--link:focus-visible,.am-tile__retry:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .am-tile__meta{font-size:12px;line-height:16px;color:var(--am-ink-500);min-inline-size:0;overflow-wrap:anywhere}
      .am-tile__meta--danger{color:var(--am-danger-ink);font-weight:600}
      .am-tile__meta--warning{color:var(--am-warning-ink);font-weight:600}
      .am-tile__meta--failed{color:var(--am-ink-700)}
      .am-tile__skeleton{block-size:24px;inline-size:56px;margin-block:8px 4px;border-radius:4px;background:var(--am-surface)}
      .am-tile__failed{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin-block-start:8px;font-size:13px;line-height:20px;color:var(--am-ink-700)}
      .am-tile__retry{font:inherit;font-size:12px;font-weight:600;color:var(--am-primary-700);background:none;border:0;padding:0;cursor:pointer;text-decoration:underline}
    `,
  ],
})
export class HomeTileComponent {
  readonly label = input.required<string>();
  readonly state = input.required<HomeTileState>();
  /** The number, already formatted (Latin digits, by the formatting layer). */
  readonly value = input('');
  readonly meta = input<string | null>(null);
  readonly tone = input<HomeTileTone>(null);
  readonly metaState = input<HomeTileState>('ready');
  readonly metaFailedText = input('');
  readonly link = input<string[] | null>(null);
  readonly testId = input('home-tile');
  readonly retry = output<void>();
  readonly metaRetry = output<void>();
}
