import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { PlanService, IPlan } from '../../services/plan.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { LanguageService } from '../../../core/services/language.service';
import { AmNumberPipe } from '../../../core/formatting';
import { DataListColumn, DataListComponent } from '../../../shared/components/data-list/data-list.component';
import { DataListSource, clientSideSource } from '../../../shared/components/data-list/data-list.source';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';

/** A stored decimal price as a number for the formatting layer; null when it is not one. */
function priceOf(value: string): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A seat limit, where null is Unlimited: it sorts above every number. */
function seatsOf(value: number | null): number {
  return value === null ? Number.POSITIVE_INFINITY : value;
}

/**
 * Platform → Plans — ACC-120, on the shared list (`app-data-list`).
 *
 * `GET /platform/plans` returns every plan as one array, so the list reads it
 * once and searches, sorts and pages it in memory (`clientSideSource()`), as
 * Org positions does. A platform has a handful of plans.
 *
 * Opens sorted by monthly price, lowest first: the order a plan ladder reads.
 * Prices are the stored decimals through the formatting layer; the plan holds
 * no currency, so none is shown. Edit is the row's one action.
 */
@Component({
  selector: 'app-plan-list',
  standalone: true,
  imports: [PageHeaderComponent, RouterLink, TranslatePipe, ButtonModule, TagModule, AmNumberPipe, DataListComponent, SortHeaderComponent],
  template: `
    <div class="flex h-full flex-col gap-4">
      <app-page-header [title]="'platform.plans' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button icon="pi pi-plus" [label]="'platform.addPlan' | translate" routerLink="/platform/plans/create" />
          }
        </div>
      </app-page-header>

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [initialSort]="{ sortBy: 'monthlyPrice', sortDir: 'asc' }"
        [searchPlaceholder]="'platform.searchPlans' | translate"
        [emptyTitle]="'platform.noPlans' | translate"
        [errorMessage]="'platform.errorLoad' | translate"
        [gridSuffix]="canCreate() ? 'calc(var(--am-space-40) * 2)' : ''"
        persistKey="platformPlans"
      >
        <ng-template #listHeader let-h>
          @for (column of columns(); track column.key) {
            @if (h.visible(column.key)) {
              @if (column.sortBy) {
                <am-sort-header
                  [key]="column.key"
                  [label]="column.label"
                  [current]="h.sortBy === column.sortBy ? { key: column.key, dir: h.sortDir ?? 'asc' } : null"
                  (sort)="h.sort($event)"
                />
              } @else {
                <span role="columnheader">{{ column.label }}</span>
              }
            }
          }
          @if (canCreate()) {
            <span></span>
          }
        </ng-template>

        <ng-template #listRow let-plan let-v="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2 text-[length:var(--am-type-value-size)]"
            style="grid-template-columns: var(--am-list-cols)"
            [attr.data-plan-row]="plan.id"
          >
            @if (v('name')) {
              <span class="flex min-w-0 items-center gap-2">
                <span class="truncate font-medium" [attr.title]="nameOf(plan)" data-testid="plan-name">{{ nameOf(plan) }}</span>
                @if (!plan.isActive) {
                  <p-tag [value]="'platform.inactive' | translate" severity="secondary" />
                }
              </span>
            }
            @if (v('monthlyPrice')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="plan-monthly-price">{{ priceOf(plan.monthlyPrice) | amNumber }}</span>
            }
            @if (v('annualPrice')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="plan-annual-price">{{ priceOf(plan.annualPrice) | amNumber }}</span>
            }
            @if (v('aiCredits')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="plan-ai-credits">{{ plan.aiCreditsPerMonth | amNumber }}</span>
            }
            @if (v('maxFullUsers')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="plan-max-full-users">
                {{ plan.maxFullUsers === null ? ('platform.unlimited' | translate) : (plan.maxFullUsers | amNumber) }}
              </span>
            }
            @if (v('maxStaff')) {
              <span class="min-w-0 truncate tabular-nums" data-testid="plan-max-staff">
                {{ plan.maxStaff === null ? ('platform.unlimited' | translate) : (plan.maxStaff | amNumber) }}
              </span>
            }
            @if (canCreate()) {
              <span class="flex justify-end">
                <p-button
                  [label]="'common.edit' | translate"
                  size="small"
                  [text]="true"
                  [ariaLabel]="'platform.editPlanNamed' | translate: { plan: nameOf(plan) }"
                  [routerLink]="['/platform/plans', plan.id]"
                  data-testid="plan-edit"
                />
              </span>
            }
          </div>
        </ng-template>
      </app-data-list>
    </div>
  `,
})
export class PlanListComponent {
  private readonly planService = inject(PlanService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly translate = inject(TranslateService);
  private readonly language = inject(LanguageService);

  readonly list = viewChild.required<DataListComponent<IPlan>>('list');

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // PlatformGuard rather than a permission string — see ai-credit-pack-list.
  // Editing a plan is behind the same guard, so Edit follows it.
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());

  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly plans = signal<readonly IPlan[] | null>(null);

  protected readonly priceOf = priceOf;

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const t = (key: string): string => this.translate.instant(key);
    return [
      { key: 'name', label: t('platform.planName'), sortBy: 'name', alwaysVisible: true, width: 'minmax(0, 1.6fr)' },
      { key: 'monthlyPrice', label: t('platform.monthlyPrice'), sortBy: 'monthlyPrice', width: 'minmax(0, 1fr)' },
      { key: 'annualPrice', label: t('platform.annualPrice'), sortBy: 'annualPrice', width: 'minmax(0, 1fr)' },
      { key: 'aiCredits', label: t('platform.aiCreditsPerMonth'), sortBy: 'aiCredits', width: 'minmax(0, 1.2fr)' },
      { key: 'maxFullUsers', label: t('platform.maxFullUsers'), sortBy: 'maxFullUsers', width: 'minmax(0, 1fr)' },
      { key: 'maxStaff', label: t('platform.maxStaff'), sortBy: 'maxStaff', width: 'minmax(0, 0.9fr)' },
    ];
  });

  readonly trackById = (plan: IPlan): string => plan.id;

  /** The plan's name in the reader's language, English when it has no Arabic one. */
  nameOf(plan: IPlan): string {
    return this.language.bilingual(plan.nameEn, plan.nameAr);
  }

  private readonly slice: DataListSource<IPlan> = clientSideSource(() => this.plans() ?? [], {
    searchFields: (p) => [p.nameEn, p.nameAr],
    comparators: {
      name: (a, b) => this.nameOf(a).localeCompare(this.nameOf(b)),
      monthlyPrice: (a, b) => (priceOf(a.monthlyPrice) ?? 0) - (priceOf(b.monthlyPrice) ?? 0),
      annualPrice: (a, b) => (priceOf(a.annualPrice) ?? 0) - (priceOf(b.annualPrice) ?? 0),
      aiCredits: (a, b) => a.aiCreditsPerMonth - b.aiCreditsPerMonth,
      maxFullUsers: (a, b) => seatsOf(a.maxFullUsers) - seatsOf(b.maxFullUsers) || 0,
      maxStaff: (a, b) => seatsOf(a.maxStaff) - seatsOf(b.maxStaff) || 0,
    },
  });

  /** Fetch once (inactive plans included, as before), then slice the cache. */
  readonly source: DataListSource<IPlan> = (query) => {
    const cached = this.plans();
    const items$ = cached ? of(cached) : this.planService.listPlans(true).pipe(tap((rows) => this.plans.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };
}
