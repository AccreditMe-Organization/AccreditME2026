import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Zoom out · Fit · Zoom in, for a scaled picture (shared/utils/zoom.ts). The
 * org chart's toolbar drew these first (ACC-120 slice 11); the workflow strip
 * uses the same three (ACC-271 PR 5b). − and + are named for a screen reader;
 * each is disabled at its limit.
 *
 * `testIdPrefix` keeps each picture's own test ids: "chart" gives chart-zoom-out,
 * chart-fit and chart-zoom-in.
 */
@Component({
  selector: 'am-zoom-controls',
  standalone: true,
  imports: [TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex items-center gap-1.5' },
  template: `
    <button type="button" class="azc__btn" [attr.aria-label]="'zoom.out' | translate" [disabled]="!canZoomOut()" (click)="zoomOut.emit()" [attr.data-testid]="testIdPrefix() + '-zoom-out'">−</button>
    <button type="button" class="azc__btn azc__btn--text" (click)="fit.emit()" [attr.data-testid]="testIdPrefix() + '-fit'">{{ 'zoom.fit' | translate }}</button>
    <button type="button" class="azc__btn" [attr.aria-label]="'zoom.in' | translate" [disabled]="!canZoomIn()" (click)="zoomIn.emit()" [attr.data-testid]="testIdPrefix() + '-zoom-in'">+</button>
  `,
  styles: [
    `
      .azc__btn{min-inline-size:var(--am-space-32);block-size:var(--am-space-32);padding:0 var(--am-space-8);font:inherit;color:var(--am-ink-900);background:var(--am-control-bg);border:1px solid var(--am-ink-500);border-radius:var(--am-radius-button);cursor:pointer}
      .azc__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .azc__btn:disabled{opacity:.5;cursor:default}
      .azc__btn--text{padding-inline:var(--am-space-12)}
    `,
  ],
})
export class ZoomControlsComponent {
  readonly canZoomIn = input(true);
  readonly canZoomOut = input(true);
  readonly testIdPrefix = input.required<string>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();
}
