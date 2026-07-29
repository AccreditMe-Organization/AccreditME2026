import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { PlanService, IAiFeatureCost } from '../../services/plan.service';

@Component({
  selector: 'app-ai-feature-cost-list',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, TableModule, ButtonModule, InputTextModule, InputNumberModule, DialogModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'platform.aiFeatureCosts' | translate }}</h2>
        <p-button icon="pi pi-plus" [label]="'platform.addAiFeatureCost' | translate" (onClick)="openAdd()" />
      </div>

      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }

      <p-table [value]="costs()" [loading]="loading()" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'platform.featureKey' | translate }}</th>
            <th>{{ 'platform.creditCost' | translate }}</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-cost>
          <tr>
            <td>{{ cost.featureKey }}</td>
            <td>{{ cost.creditCost }}</td>
            <td>
              <p-button icon="pi pi-pencil" [text]="true" size="small" (onClick)="openEdit(cost)" />
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="3" class="text-center py-4 text-surface-400">{{ 'platform.noAiFeatureCosts' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>

      <p-dialog [visible]="showDialog()" (visibleChange)="showDialog.set($event)" [header]="'platform.addAiFeatureCost' | translate" [modal]="true" [style]="{ width: '420px' }">
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label for="featureKey" class="text-sm font-medium">{{ 'platform.featureKey' | translate }}</label>
            <input pInputText id="featureKey" formControlName="featureKey" [readonly]="!!editingKey()" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="creditCost" class="text-sm font-medium">{{ 'platform.creditCost' | translate }}</label>
            <p-inputNumber inputId="creditCost" formControlName="creditCost" [min]="0" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="description" class="text-sm font-medium">{{ 'common.description' | translate }}</label>
            <input pInputText id="description" formControlName="description" />
          </div>
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
          </div>
        </form>
      </p-dialog>
    </div>
  `,
})
export class AiFeatureCostListComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);

  readonly costs = signal<IAiFeatureCost[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showDialog = signal(false);
  readonly editingKey = signal<string | null>(null);

  readonly form = this.fb.group({
    featureKey: ['', [Validators.required]],
    creditCost: [1, [Validators.required, Validators.min(0)]],
    description: [''],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.planService.listAiFeatureCosts().subscribe({
      next: (costs) => {
        this.costs.set(costs);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('platform.errorLoad');
        this.loading.set(false);
      },
    });
  }

  openAdd(): void {
    this.editingKey.set(null);
    this.form.reset({ featureKey: '', creditCost: 1, description: '' });
    this.showDialog.set(true);
  }

  openEdit(cost: IAiFeatureCost): void {
    this.editingKey.set(cost.featureKey);
    this.form.reset({ featureKey: cost.featureKey, creditCost: cost.creditCost, description: cost.description ?? '' });
    this.showDialog.set(true);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const value = this.form.getRawValue();

    this.planService
      .upsertAiFeatureCost({ featureKey: value.featureKey!, creditCost: value.creditCost!, description: value.description ?? undefined })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.showDialog.set(false);
          this.load();
        },
        error: () => {
          this.saving.set(false);
          this.error.set('platform.errorAction');
        },
      });
  }
}
