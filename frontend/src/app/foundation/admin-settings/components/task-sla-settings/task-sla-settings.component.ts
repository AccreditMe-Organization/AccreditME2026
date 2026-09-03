import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputNumberModule } from 'primeng/inputnumber';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { TenantService, ITaskSlaSettings } from '../../../tenant/services/tenant.service';

// ACC-46 Section 2.7.c/2.7.d — one card per TaskPriority, three numeric
// fields per card. LOW->CRITICAL order matches task-form.component.ts's
// own PRIORITIES ordering, not the interface's own CRITICAL-first property
// order (that's just declaration order, not a UI convention).
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

@Component({
  selector: 'app-task-sla-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputNumberModule, ButtonModule, MessageModule, CardComponent],
  template: `
    <div class="flex flex-col gap-4">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.taskSla' | translate }}</h2>
      <p class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.taskSlaNote' | translate }}</p>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4" [formGroup]="form">
          @for (priority of priorities; track priority) {
            <app-card [formGroupName]="priority">
              <div class="flex flex-col gap-3">
                <h3 class="font-medium">{{ ('task.priority.' + priority.toLowerCase()) | translate }}</h3>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.dueAfterHours' | translate }}</label>
                  <p-inputNumber formControlName="dueAfterHours" [min]="1" [showButtons]="true" styleClass="w-full" inputStyleClass="w-full" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.managerEscalationAfterHours' | translate }}</label>
                  <p-inputNumber formControlName="managerEscalationAfterHours" [min]="0" [showButtons]="true" styleClass="w-full" inputStyleClass="w-full" />
                </div>
                <div class="flex flex-col gap-1">
                  <label class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.headEscalationAfterHours' | translate }}</label>
                  <p-inputNumber formControlName="headEscalationAfterHours" [min]="0" [showButtons]="true" styleClass="w-full" inputStyleClass="w-full" />
                </div>
              </div>
            </app-card>
          }
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
