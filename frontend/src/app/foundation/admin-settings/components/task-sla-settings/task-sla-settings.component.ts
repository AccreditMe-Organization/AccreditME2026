import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TenantService, ITaskSlaSettings } from '../../../tenant/services/tenant.service';

// ACC-46 Section 2.7.c/2.7.d — one row per TaskPriority, three numeric
// columns per row. LOW->CRITICAL row order matches task-form.component.ts's
// own PRIORITIES ordering, not the interface's own CRITICAL-first property
// order (that's just declaration order, not a UI convention).
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

@Component({
  selector: 'app-task-sla-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputNumberModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-3xl">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.taskSla' | translate }}</h2>
      <p class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.taskSlaNote' | translate }}</p>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="text-left text-[var(--am-text-secondary)]">
                <th class="pb-2 pe-4 font-medium">{{ 'task.priority.title' | translate }}</th>
                <th class="pb-2 pe-4 font-medium">{{ 'adminSettings.dueAfterHours' | translate }}</th>
                <th class="pb-2 pe-4 font-medium">{{ 'adminSettings.managerEscalationAfterHours' | translate }}</th>
                <th class="pb-2 font-medium">{{ 'adminSettings.headEscalationAfterHours' | translate }}</th>
              </tr>
            </thead>
            <tbody [formGroup]="form">
              @for (priority of priorities; track priority) {
                <tr [formGroupName]="priority">
                  <td class="py-2 pe-4 font-medium">{{ ('task.priority.' + priority.toLowerCase()) | translate }}</td>
                  <td class="py-2 pe-4">
                    <p-inputNumber formControlName="dueAfterHours" [min]="1" [showButtons]="true" />
                  </td>
                  <td class="py-2 pe-4">
                    <p-inputNumber formControlName="managerEscalationAfterHours" [min]="0" [showButtons]="true" />
                  </td>
                  <td class="py-2">
                    <p-inputNumber formControlName="headEscalationAfterHours" [min]="0" [showButtons]="true" />
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>
    </div>
  `,
})
export class TaskSlaSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);

  readonly priorities = PRIORITIES;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  private buildTierGroup() {
    return this.fb.group({
      dueAfterHours: [1, [Validators.required, Validators.min(1)]],
      managerEscalationAfterHours: [0, [Validators.required, Validators.min(0)]],
      headEscalationAfterHours: [0, [Validators.required, Validators.min(0)]],
    });
  }

  readonly form = this.fb.group({
    LOW: this.buildTierGroup(),
    MEDIUM: this.buildTierGroup(),
    HIGH: this.buildTierGroup(),
    CRITICAL: this.buildTierGroup(),
  });

  ngOnInit(): void {
    this.tenantService.getTaskSla().subscribe({
      next: (settings) => this.form.patchValue(settings),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const dto = this.form.getRawValue() as ITaskSlaSettings;
    this.tenantService.updateTaskSla(dto).subscribe({
      next: () => {
        this.saving.set(false);
        this.savedMessage.set('adminSettings.savedSuccess');
      },
      error: () => {
        this.saving.set(false);
        this.error.set('adminSettings.errorSave');
      },
    });
  }
}
