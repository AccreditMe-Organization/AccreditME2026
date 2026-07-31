import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { PlanService, IPlan } from '../../services/plan.service';

@Component({
  selector: 'app-plan-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, TableModule, ButtonModule, TagModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'platform.plans' | translate }}</h2>
        <p-button icon="pi pi-plus" [label]="'platform.addPlan' | translate" routerLink="/platform/plans/create" />
      </div>

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
