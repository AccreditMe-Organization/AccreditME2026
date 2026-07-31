import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PlanService, IPlanModule, KNOWN_MODULE_KEYS, PlanModuleAccessLevel } from '../../services/plan.service';

const ACCESS_LEVEL_OPTIONS = [
  { label: 'FULL', value: 'FULL' },
  { label: 'READ_ONLY', value: 'READ_ONLY' },
  { label: 'NONE', value: 'NONE' },
];

@Component({
  selector: 'app-plan-form',
  standalone: true,
  imports: [ReactiveFormsModule, FormsModule, TranslatePipe, InputTextModule, InputNumberModule, CheckboxModule, SelectModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-6 max-w-2xl">
      <h2 class="text-xl font-semibold">
        {{ (isEditing() ? 'platform.editPlan' : 'platform.addPlan') | translate }}
      </h2>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="name" class="text-sm font-medium">{{ 'platform.planKey' | translate }}</label>
          <input pInputText id="name" formControlName="name" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="nameEn" class="text-sm font-medium">{{ 'platform.planNameEn' | translate }}</label>
          <input pInputText id="nameEn" formControlName="nameEn" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="nameAr" class="text-sm font-medium">{{ 'platform.planNameAr' | translate }}</label>
          <input pInputText id="nameAr" formControlName="nameAr" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="monthlyPrice" class="text-sm font-medium">{{ 'platform.monthlyPrice' | translate }}</label>
          <input pInputText id="monthlyPrice" formControlName="monthlyPrice" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="annualPrice" class="text-sm font-medium">{{ 'platform.annualPrice' | translate }}</label>
          <input pInputText id="annualPrice" formControlName="annualPrice" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="maxStorageGb" class="text-sm font-medium">{{ 'platform.maxStorageGb' | translate }}</label>
          <p-inputNumber inputId="maxStorageGb" formControlName="maxStorageGb" [min]="1" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="aiCreditsPerMonth" class="text-sm font-medium">{{ 'platform.aiCreditsPerMonth' | translate }}</label>
          <p-inputNumber inputId="aiCreditsPerMonth" formControlName="aiCreditsPerMonth" [min]="0" />
        </div>
        <div class="flex items-center gap-2">
          <p-checkbox formControlName="isPublic" [binary]="true" inputId="isPublic" />
          <label for="isPublic" class="text-sm cursor-pointer">{{ 'platform.isPublic' | translate }}</label>
        </div>

        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>

      @if (isEditing()) {
        <hr />
        <h3 class="text-lg font-medium">{{ 'platform.planModules' | translate }}</h3>
        <div class="flex flex-col gap-2">
          @for (key of moduleKeys; track key) {
            <div class="flex items-center justify-between gap-3 p-2 rounded-md border border-[var(--am-border)]">
              <span class="text-sm">{{ key }}</span>
              <p-select
                [options]="accessLevelOptions"
                optionLabel="label"
                optionValue="value"
                [ngModel]="accessLevelFor(key)"
                (ngModelChange)="onAccessLevelChange(key, $event)"
                [ngModelOptions]="{ standalone: true }"
                styleClass="w-40"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class PlanFormComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly planService = inject(PlanService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly planId = this.route.snapshot.paramMap.get('id');
  readonly moduleKeys = KNOWN_MODULE_KEYS;
  readonly accessLevelOptions = ACCESS_LEVEL_OPTIONS;

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly planModules = signal<IPlanModule[]>([]);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    nameEn: ['', [Validators.required]],
    nameAr: ['', [Validators.required]],
    monthlyPrice: ['0', [Validators.required]],
    annualPrice: ['0', [Validators.required]],
    maxStorageGb: [10, [Validators.required, Validators.min(1)]],
    aiCreditsPerMonth: [0, [Validators.required, Validators.min(0)]],
    isPublic: [true],
  });

  isEditing(): boolean {
    return !!this.planId;
  }

  ngOnInit(): void {
    if (this.planId) {
      this.planService.getPlanById(this.planId).subscribe({
        next: (plan) => {
          this.form.patchValue(plan);
          this.planModules.set(plan.planModules ?? []);
        },
        error: () => this.error.set('platform.errorLoad'),
      });
    }
  }

  accessLevelFor(moduleKey: string): PlanModuleAccessLevel {
    return this.planModules().find((m) => m.moduleKey === moduleKey)?.accessLevel ?? 'NONE';
  }

  onAccessLevelChange(moduleKey: string, accessLevel: PlanModuleAccessLevel): void {
    if (!this.planId) return;
    this.planService.upsertPlanModule(this.planId, moduleKey, accessLevel).subscribe({
      next: (updated) => {
        const others = this.planModules().filter((m) => m.moduleKey !== moduleKey);
        this.planModules.set([...others, updated]);
        this.savedMessage.set('platform.savedSuccess');
      },
      error: () => this.error.set('platform.errorAction'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.form.getRawValue();
    const dto = {
      name: value.name!,
      nameEn: value.nameEn!,
      nameAr: value.nameAr!,
      monthlyPrice: value.monthlyPrice!,
      annualPrice: value.annualPrice!,
      maxStorageGb: value.maxStorageGb!,
      aiCreditsPerMonth: value.aiCreditsPerMonth!,
      isPublic: value.isPublic!,
    };
    const request$ = this.planId ? this.planService.updatePlan(this.planId, dto) : this.planService.createPlan(dto);

    request$.subscribe({
      next: (plan) => {
        this.saving.set(false);
        this.savedMessage.set('platform.savedSuccess');
        if (!this.planId) {
          void this.router.navigate(['/platform/plans', plan.id]);
        }
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.error.set(err?.error?.message ?? 'platform.errorAction');
      },
    });
  }
}
