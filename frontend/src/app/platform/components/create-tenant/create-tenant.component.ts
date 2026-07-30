import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PlatformTenantService } from '../../services/platform-tenant.service';
import { PlanService, IPlan } from '../../services/plan.service';

@Component({
  selector: 'app-create-tenant',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, SelectModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <h2 class="text-xl font-semibold">{{ 'platform.createTenant' | translate }}</h2>

      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="name" class="text-sm font-medium">{{ 'platform.tenantName' | translate }}</label>
          <input pInputText id="name" formControlName="name" />
        </div>

        <div class="flex flex-col gap-1">
          <label for="slug" class="text-sm font-medium">{{ 'platform.slug' | translate }}</label>
          <input pInputText id="slug" formControlName="slug" placeholder="acme" />
        </div>

        <div class="flex flex-col gap-1">
          <label for="country" class="text-sm font-medium">{{ 'platform.country' | translate }}</label>
          <input pInputText id="country" formControlName="country" placeholder="SA" maxlength="2" />
        </div>

        <div class="flex flex-col gap-1">
          <label for="planId" class="text-sm font-medium">{{ 'platform.plan' | translate }}</label>
          <p-select
            inputId="planId"
            formControlName="planId"
            [options]="plans()"
            optionLabel="nameEn"
            optionValue="id"
            [showClear]="true"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="adminName" class="text-sm font-medium">{{ 'platform.adminName' | translate }}</label>
          <input pInputText id="adminName" formControlName="adminName" />
        </div>

        <div class="flex flex-col gap-1">
          <label for="adminEmail" class="text-sm font-medium">{{ 'platform.adminEmail' | translate }}</label>
          <input pInputText id="adminEmail" type="email" formControlName="adminEmail" />
        </div>

        <div class="flex justify-end">
          <p-button
            [label]="'common.create' | translate"
            type="submit"
            [loading]="submitting()"
            [disabled]="form.invalid"
          />
        </div>
      </form>
    </div>
  `,
})
export class CreateTenantComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly planService = inject(PlanService);
  private readonly router = inject(Router);

  readonly plans = signal<IPlan[]>([]);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]+$/)]],
    country: ['', [Validators.required, Validators.maxLength(2)]],
    planId: [null as string | null],
    adminName: ['', [Validators.required]],
    adminEmail: ['', [Validators.required, Validators.email]],
  });

  ngOnInit(): void {
    this.planService.listPlans().subscribe({ next: (plans) => this.plans.set(plans) });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.submitting.set(true);
    this.error.set(null);

    const value = this.form.getRawValue();
    this.platformTenantService
      .createTenant({
        name: value.name!,
        slug: value.slug!,
        country: value.country!,
        planId: value.planId ?? undefined,
        adminName: value.adminName!,
        adminEmail: value.adminEmail!,
      })
      .subscribe({
        next: (tenant) => {
          this.submitting.set(false);
          void this.router.navigate(['/platform/tenants', tenant.id]);
        },
        // Duplicate slug surfaces here as a 409 ConflictException from the
        // backend — simplest submit-time surface, per step plan Section 12
        // Pending Discussion #4 (no async slug-uniqueness validator).
        error: (err: { error?: { message?: string } }) => {
          this.submitting.set(false);
          this.error.set(err?.error?.message ?? 'platform.errorCreateTenant');
        },
      });
  }
}
