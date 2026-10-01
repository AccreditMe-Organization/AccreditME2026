import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TenantService } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../../core/services/navigation-access.service';

@Component({
  selector: 'app-organization-profile',
  standalone: true,
  imports: [PageHeaderComponent, ReactiveFormsModule, TranslatePipe, InputTextModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <app-page-header [title]="'adminSettings.organizationProfile' | translate" />

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <!-- ACC-123 — the route is gated on tenant:view (ADMIN_SETTINGS_ROUTES),
           but SAVING is PATCH /tenant, which enforces TENANT_PERMISSIONS.UPDATE
           (tenant.controller.ts). Those are not the same permission, and before
           this the whole form rendered editable with a live Save to anyone who
           could open the page — found by standing on it as READ_ONLY_ADMIN.

           Disabled inputs plus a sentence, the same shape working-calendar
           already uses for its own org:manage split. -->
      @if (!canEdit()) {
        <p class="text-sm text-[var(--am-text-secondary)]">
          {{ 'adminSettings.profileReadOnly' | translate }}
        </p>
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
        @if (canEdit()) {
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
          </div>
        }
      </form>
    </div>
  `,
})
export class OrganizationProfileComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);
  private readonly navigationAccess = inject(NavigationAccessService);

  readonly canEdit = computed(() => this.navigationAccess.hasPermission('tenant:update'));

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    name: ['', [Validators.required]],
    country: ['', [Validators.required, Validators.maxLength(2)]],
    logo: [''],
  });

  ngOnInit(): void {
    // Disabling the CONTROLS rather than only hiding Save: a form that accepts
    // typing and then has nowhere to send it is the defect in a quieter form.
    if (!this.canEdit()) this.form.disable();

    this.tenantService.getCurrent().subscribe({
      next: (tenant) => this.form.patchValue({ name: tenant.name, country: tenant.country, logo: tenant.logo ?? '' }),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    // FIRST, before any state is set: a disabled control is excluded from
    // validation, so form.invalid is false on a read-only form and would not
    // stop anything. Setting saving() before this check left the spinner on.
    if (!this.canEdit()) return;
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
