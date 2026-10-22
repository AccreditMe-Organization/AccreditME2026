import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { CheckboxModule } from 'primeng/checkbox';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { CHART_LEVELS } from './org-chart-model';
import { OrgUnitPathItemDto } from '../../services/org-unit.service';

/**
 * ACC-120 slice 11, PR E — the chart's toolbar (OS L161-172): "Showing from"
 * the root's path, every ancestor a link that re-roots the chart; the levels
 * note; "Show committees" (only with committees:view, D7); Zoom out / Fit /
 * Zoom in. Print is a later ticket (D14).
 */
@Component({
  selector: 'am-org-chart-toolbar',
  standalone: true,
  imports: [TranslatePipe, FormsModule, CheckboxModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-wrap items-center gap-2 px-3 py-2 bg-surface border-b border-rule text-meta" data-testid="chart-toolbar">
      <nav class="flex flex-wrap items-baseline gap-x-1 min-w-0" [attr.aria-label]="'organization.chart.showingFrom' | translate" data-testid="chart-path">
        <span class="text-ink-700">{{ 'organization.chart.showingFrom' | translate }}</span>
        @for (p of path(); track p.id; let last = $last) {
          @if (!last) {
            <button type="button" class="oct__link" (click)="reroot.emit(p.id)" [attr.data-path]="p.id">{{ name(p) }}</button>
            <span class="text-ink-500" aria-hidden="true">›</span>
          } @else {
            <span class="font-semibold text-ink-900" aria-current="location" data-testid="chart-path-current">{{ name(p) }}</span>
          }
        }
        <span class="text-ink-500">{{ 'organization.chart.levelsNote' | translate: { levels: levels } }}</span>
      </nav>
      @if (committeesAvailable()) {
        <label class="inline-flex items-center gap-1.5 text-ink-900">
          <p-checkbox
            [binary]="true"
            [ngModel]="showCommittees()"
            (ngModelChange)="showCommitteesChange.emit($event)"
            inputId="org-chart-committees"
            data-testid="chart-committees"
          />
          <span>{{ 'organization.chart.showCommittees' | translate }}</span>
        </label>
      }
      <span class="ms-auto flex items-center gap-1.5">
        <button type="button" class="oct__btn" [attr.aria-label]="'organization.chart.zoomOut' | translate" [disabled]="!canZoomOut()" (click)="zoomOut.emit()" data-testid="chart-zoom-out">−</button>
        <button type="button" class="oct__btn oct__btn--text" (click)="fit.emit()" data-testid="chart-fit">{{ 'organization.chart.fit' | translate }}</button>
        <button type="button" class="oct__btn" [attr.aria-label]="'organization.chart.zoomIn' | translate" [disabled]="!canZoomIn()" (click)="zoomIn.emit()" data-testid="chart-zoom-in">+</button>
      </span>
    </div>
  `,
  styles: [
    `
      .oct__link{font:inherit;padding:0;border:0;background:none;color:var(--am-primary-700);font-weight:600;cursor:pointer}
      .oct__link:hover{text-decoration:underline}
      .oct__link:focus-visible,.oct__btn:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
      .oct__btn{min-inline-size:var(--am-space-32);block-size:var(--am-space-32);padding:0 var(--am-space-8);font:inherit;color:var(--am-ink-900);background:var(--am-control-bg);border:1px solid var(--am-ink-500);border-radius:var(--am-radius-button);cursor:pointer}
      .oct__btn:disabled{opacity:.5;cursor:default}
      .oct__btn--text{padding-inline:var(--am-space-12)}
    `,
  ],
})
export class OrgChartToolbarComponent {
  private readonly language = inject(LanguageService);
  private readonly format = inject(FormatService);

  /** "4 levels", a plural object (ACC-94). */
  get levels(): string {
    return this.format.count('organization.levels', CHART_LEVELS);
  }

  readonly path = input.required<OrgUnitPathItemDto[]>();
  readonly committeesAvailable = input(false);
  readonly showCommittees = input(false);
  readonly canZoomIn = input(true);
  readonly canZoomOut = input(true);
  readonly reroot = output<string>();
  readonly showCommitteesChange = output<boolean>();
  readonly zoomIn = output<void>();
  readonly zoomOut = output<void>();
  readonly fit = output<void>();

  name(p: OrgUnitPathItemDto): string {
    return this.language.bilingual(p.nameEn, p.nameAr);
  }
}
