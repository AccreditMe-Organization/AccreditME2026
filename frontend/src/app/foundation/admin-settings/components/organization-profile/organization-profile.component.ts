import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TenantService } from '../../../tenant/services/tenant.service';

@Component({
  selector: 'app-organization-profile',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.organizationProfile' | translate }}</h2>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="name" class="text-sm font-medium">{{ 'adminSettings.orgName' | translate }}</label>
          <input pInputText id="name" formControlName="name" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="country" class="text-sm font-medium">{{ 'adminSettings.country' | translate }}</label>
          <input pInputText id="country" formControlName="country" maxlength="2" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="logo" class="text-sm font-medium">{{ 'adminSettings.logo' | translate }}</label>
          <input pInputText id="logo" formControlName="logo" placeholder="S3 key" />
          <p class="text-xs text-[var(--am-text-secondary)]">
            {{ 'adminSettings.logoUploadNotBuiltYet' | translate }}
          </p>
        </div>
        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>
    </div>
  `,
})
export class OrganizationProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    country: ['', [Validators.required, Validators.maxLength(2)]],
    logo: [''],
  });

  ngOnInit(): void {
    this.tenantService.getCurrent().subscribe({
      next: (tenant) => this.form.patchValue({ name: tenant.name, country: tenant.country, logo: tenant.logo ?? '' }),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.form.getRawValue();
    this.tenantService
      .update({ name: value.name!, country: value.country!, logo: value.logo || undefined })
      .subscribe({
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
