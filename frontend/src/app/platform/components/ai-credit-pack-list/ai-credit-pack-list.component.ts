import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { DialogModule } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { PlanService, IAiCreditPack } from '../../services/plan.service';

@Component({
  selector: 'app-ai-credit-pack-list',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, TableModule, ButtonModule, InputTextModule, InputNumberModule, DialogModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'platform.aiCreditPacks' | translate }}</h2>
        <p-button icon="pi pi-plus" [label]="'platform.addAiCreditPack' | translate" (onClick)="openAdd()" />
      </div>

      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }

      <p-table [value]="packs()" [loading]="loading()" styleClass="w-full">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'platform.packName' | translate }}</th>
            <th>{{ 'platform.credits' | translate }}</th>
            <th>{{ 'platform.price' | translate }}</th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-pack>
          <tr>
            <td>{{ pack.name }}</td>
            <td>{{ pack.credits }}</td>
            <td>{{ pack.price }}</td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="3" class="text-center py-4 text-surface-400">{{ 'platform.noAiCreditPacks' | translate }}</td>
          </tr>
        </ng-template>
      </p-table>

      <p-dialog [visible]="showAddDialog()" (visibleChange)="showAddDialog.set($event)" [header]="'platform.addAiCreditPack' | translate" [modal]="true" [style]="{ width: '420px' }">
        <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
          <div class="flex flex-col gap-1">
            <label for="name" class="text-sm font-medium">{{ 'platform.packName' | translate }}</label>
            <input pInputText id="name" formControlName="name" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="credits" class="text-sm font-medium">{{ 'platform.credits' | translate }}</label>
            <p-inputNumber inputId="credits" formControlName="credits" [min]="1" />
          </div>
          <div class="flex flex-col gap-1">
            <label for="price" class="text-sm font-medium">{{ 'platform.price' | translate }}</label>
            <input pInputText id="price" formControlName="price" />
          </div>
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
          </div>
        </form>
      </p-dialog>
    </div>
  `,
})
export class AiCreditPackListComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);

  readonly packs = signal<IAiCreditPack[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly showAddDialog = signal(false);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    credits: [100, [Validators.required, Validators.min(1)]],
    price: ['0', [Validators.required]],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.planService.listAiCreditPacks(true).subscribe({
      next: (packs) => {
        this.packs.set(packs);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('platform.errorLoad');
        this.loading.set(false);
      },
    });
  }

  openAdd(): void {
    this.form.reset({ name: '', credits: 100, price: '0' });
    this.showAddDialog.set(true);
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    const value = this.form.getRawValue();

    this.planService.createAiCreditPack({ name: value.name!, credits: value.credits!, price: value.price! }).subscribe({
      next: () => {
        this.saving.set(false);
        this.showAddDialog.set(false);
        this.load();
      },
      error: () => {
        this.saving.set(false);
        this.error.set('platform.errorAction');
      },
    });
  }
}
