import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { PlanService, IPlan } from '../../services/plan.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';

@Component({
  selector: 'app-plan-list',
  standalone: true,
  imports: [PageHeaderComponent, RouterLink, TranslatePipe, TableModule, ButtonModule, TagModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4">
      <app-page-header [title]="'platform.plans' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button icon="pi pi-plus" [label]="'platform.addPlan' | translate" routerLink="/platform/plans/create" />
          }
        </div>
      </app-page-header>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      <p-table [value]="plans()" [loading]="loading()" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'platform.planName' | translate }}</th>
            <th>{{ 'platform.monthlyPrice' | translate }}</th>
            <th>{{ 'platform.annualPrice' | translate }}</th>
            <th>{{ 'platform.aiCreditsPerMonth' | translate }}</th>
            <th></th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-plan>
          <tr>
            <td>{{ plan.nameEn }}</td>
            <td>{{ plan.monthlyPrice }}</td>
            <td>{{ plan.annualPrice }}</td>
            <td>{{ plan.aiCreditsPerMonth }}</td>
            <td>
              @if (!plan.isActive) {
                <p-tag [value]="'platform.inactive' | translate" severity="secondary" />
              }
            </td>
            <td>
              <p-button
                icon="pi pi-pencil"
                [text]="true"
                size="small"
                [routerLink]="['/platform/plans', plan.id]"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-4 text-[var(--am-text-secondary)]">{{ 'platform.noPlans' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class PlanListComponent implements OnInit {
  private readonly planService = inject(PlanService);
  private readonly navigationAccess = inject(NavigationAccessService);

  // ACC-118 — the create action is HIDDEN, not disabled, for a caller who
  // cannot use it: a disabled button still announces an action that is not
  // theirs. Same mechanism as committee-detail.component.ts's canEdit /
  // canAddMember, deliberately rather than a second one.
  // PlatformGuard rather than a permission string — see ai-credit-pack-list.
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());

  readonly plans = signal<IPlan[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.loading.set(true);
    this.planService.listPlans(true).subscribe({
      next: (plans) => {
        this.plans.set(plans);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('platform.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
