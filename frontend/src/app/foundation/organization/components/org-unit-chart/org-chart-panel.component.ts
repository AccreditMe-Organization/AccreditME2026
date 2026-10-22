import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { FormatService } from '../../../../core/formatting';
import { LanguageService } from '../../../../core/services/language.service';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';
import { ADMIN_ACCESS } from '../../../../core/navigation/admin-access';
import { OrgChartNodeDto, OrgUnitService, OrgUnitSummaryDto } from '../../services/org-unit.service';
import { headSubject } from './org-chart-model';

/**
 * ACC-120 slice 11, PR E — the docked side panel (OS L218-233), OUTSIDE the
 * chart's sideways-scroll area: a box has no menu (OS L571), so its actions
 * live here. Names and head come from the chart node at once; the position
 * rows (and committees, when shown) are read lazily from `GET …/:id/summary`.
 */
@Component({
  selector: 'am-org-chart-panel',
  standalone: true,
  imports: [TranslatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ocp__label">{{ 'organization.chart.selectedUnit' | translate }}</div>
    @if (node(); as n) {
      <div class="ocp__name" data-testid="panel-name">{{ name() }}</div>
      @if (otherName(); as other) {
        <div class="ocp__other" [attr.dir]="isArabic() ? 'ltr' : 'rtl'" [attr.lang]="isArabic() ? 'en' : 'ar'" data-testid="panel-other-name">{{ other }}</div>
      }

      <div class="ocp__label ocp__gap">{{ 'headship.head.label' | translate }}</div>
      <div class="ocp__head" data-testid="panel-head">
        @if (head(); as h) {
          @if (h.name && h.userId && canOpenUsers()) {
            <a class="ocp__link" [routerLink]="['/users', h.userId]">{{ h.text }}</a>
          } @else {
            <span>{{ h.text }}</span>
          }
          @if (h.position) {
            <span class="text-ink-700"> · {{ h.position }}</span>
          }
        } @else {
          <span class="text-ink-500">{{ 'headship.head.none' | translate }}</span>
        }
      </div>

      <div class="ocp__label ocp__gap" data-testid="panel-positions-label">{{ 'organization.chart.positionsHeader' | translate: { people: people() } }}</div>
      @switch (state()) {
        @case ('loading') {
          <p class="ocp__note" role="status">{{ 'organization.chart.panelLoading' | translate }}</p>
        }
        @case ('error') {
          <p class="ocp__note" role="alert">{{ 'organization.chart.panelFailed' | translate }}</p>
        }
        @default {
          @for (p of positions(); track p.id) {
            <div class="ocp__row" data-testid="panel-position"><span class="min-w-0">{{ p.name }}</span><span dir="ltr">{{ p.count }}</span></div>
          } @empty {
            <p class="ocp__note">{{ 'organization.record.noPositions' | translate }}</p>
          }
          @if (showCommittees() && committees(); as list) {
            <div class="ocp__label ocp__gap">{{ 'organization.record.committees' | translate }}</div>
            @for (c of list; track c.id) {
              <div class="ocp__row" data-testid="panel-committee"><span class="min-w-0">{{ c.name }}</span><span class="text-ink-500">{{ c.stage }}</span></div>
            } @empty {
              <p class="ocp__note">{{ 'organization.record.noCommittees' | translate }}</p>
            }
          }
        }
      }

      <div class="ocp__actions">
        <a class="ocp__btn ocp__btn--primary" [routerLink]="['/organization/units', n.id]" data-testid="panel-open">{{ 'organization.tree.menu.openUnit' | translate }}</a>
        <button type="button" class="ocp__btn" (click)="showFromHere.emit(n.id)" data-testid="panel-show-from-here">{{ 'organization.chart.showFromHere' | translate }}</button>
        <button type="button" class="ocp__btn" (click)="findInTree.emit(n.id)" data-testid="panel-find-in-tree">{{ 'organization.chart.findInTree' | translate }}</button>
      </div>
    } @else {
      <p class="ocp__note" data-testid="panel-empty">{{ 'organization.chart.noSelection' | translate }}</p>
    }
  `,
  styles: [
    `
      :host{display:block;min-inline-size:0;padding:var(--am-space-12) var(--am-space-16);background:var(--am-surface-raised)}
      .ocp__label{font-size:var(--am-type-micro-size);font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--am-ink-500)}
      .ocp__gap{margin-block-start:var(--am-space-12)}
      .ocp__name{margin-block-start:var(--am-space-2);font-size:var(--am-type-heading-size);line-height:var(--am-type-heading-line);font-weight:600;color:var(--am-ink-900);overflow-wrap:anywhere}
      .ocp__other{font-size:var(--am-type-value-size);color:var(--am-ink-500);text-align:start;unicode-bidi:isolate;overflow-wrap:anywhere}
      .ocp__head{font-size:var(--am-type-value-size);overflow-wrap:anywhere}
      .ocp__link{color:var(--am-primary-700);font-weight:500;text-decoration:none}
      .ocp__link:hover{text-decoration:underline}
      .ocp__row{display:flex;justify-content:space-between;gap:var(--am-space-8);padding-block:var(--am-space-4);border-block-end:1px solid var(--am-border);font-size:var(--am-type-meta-size);color:var(--am-ink-900);font-variant-numeric:tabular-nums}
      .ocp__note{margin:var(--am-space-4) 0 0;font-size:var(--am-type-meta-size);color:var(--am-ink-500)}
      .ocp__actions{display:flex;flex-direction:column;gap:var(--am-space-8);margin-block-start:var(--am-space-16)}
      .ocp__btn{display:block;padding:var(--am-space-6) var(--am-space-12);font:inherit;font-size:var(--am-type-meta-size);font-weight:600;text-align:center;text-decoration:none;color:var(--am-primary-700);background:var(--am-control-bg);border:1px solid var(--am-control-border);border-radius:var(--am-radius-button);cursor:pointer}
      .ocp__btn--primary{color:var(--am-surface-raised);background:var(--am-primary-600);border-color:var(--am-primary-600)}
      .ocp__btn:focus-visible,.ocp__link:focus-visible{outline:var(--am-focus-ring-width) solid var(--am-focus-ring);outline-offset:var(--am-focus-ring-offset)}
    `,
  ],
})
export class OrgChartPanelComponent {
  private readonly orgUnits = inject(OrgUnitService);
  private readonly language = inject(LanguageService);
  private readonly translate = inject(TranslateService);
  private readonly format = inject(FormatService);
  private readonly access = inject(NavigationAccessService);

  readonly node = input<OrgChartNodeDto | null>(null);
  readonly showCommittees = input(false);
  readonly showFromHere = output<string>();
  readonly findInTree = output<string>();

  readonly summary = signal<OrgUnitSummaryDto | null>(null);
  readonly state = signal<'loading' | 'error' | 'ready'>('loading');
  readonly isArabic = computed(() => this.language.isArabic());
  readonly canOpenUsers = computed(() => this.access.hasPermission(ADMIN_ACCESS) && this.access.hasPermission('users:view'));

  constructor() {
    effect(() => {
      const id = this.node()?.id;
      untracked(() => this.load(id));
    });
  }

  private load(id: string | undefined): void {
    this.summary.set(null);
    if (!id) return;
    this.state.set('loading');
    this.orgUnits.getSummary(id).subscribe({
      next: (s) => {
        if (this.node()?.id !== id) return;
        this.summary.set(s);
        this.state.set('ready');
      },
      error: () => {
        if (this.node()?.id === id) this.state.set('error');
      },
    });
  }

  readonly name = computed(() => {
    const n = this.node();
    return n ? this.language.bilingual(n.nameEn, n.nameAr) : '';
  });

  readonly otherName = computed(() => {
    const n = this.node();
    if (!n?.nameAr) return null;
    return this.isArabic() ? n.nameEn : n.nameAr;
  });

  readonly head = computed(() => {
    const n = this.node();
    if (!n) return null;
    this.translate.currentLang();
    const s = headSubject(n, (k, p) => this.translate.instant(k, p), (en, ar) => this.language.bilingual(en, ar));
    if (!s) return null;
    const h = n.heads.find((x) => x.role === 'substantive') ?? n.heads[0];
    const position = h?.positionNameEn && h.name ? this.language.bilingual(h.positionNameEn, h.positionNameAr) : null;
    return { ...s, userId: h?.userId ?? n.acting?.userId ?? null, position };
  });

  readonly people = computed(() => {
    this.translate.currentLang();
    return this.format.count('organization.people', this.node()?.headcount ?? 0);
  });

  readonly positions = computed(() =>
    (this.summary()?.positions ?? []).map((p) => ({ id: p.positionId, name: this.language.bilingual(p.nameEn, p.nameAr), count: this.format.number(p.count) })),
  );

  /** Committee names only with committees:view (D7): the summary returns null otherwise. */
  readonly committees = computed(() => {
    const items = this.summary()?.committees.items;
    if (!items) return null;
    this.translate.currentLang();
    return items.map((c) => ({
      id: c.id,
      name: this.language.bilingual(c.nameEn, c.nameAr),
      stage: c.stageNameEn ? this.language.bilingual(c.stageNameEn, c.stageNameAr) : '',
    }));
  });
}
