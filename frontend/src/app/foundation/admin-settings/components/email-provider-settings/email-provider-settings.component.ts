import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { TextareaModule } from 'primeng/textarea';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { TenantService } from '../../../tenant/services/tenant.service';
// ACC-42 Phase 5 — OverlaySelectComponent replaces p-select on this field:
// routed-page-under-<main> context. See CLAUDE.md's PrimeNG-components-only
// exception note and overlay-select.component.ts for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

const PROVIDER_OPTIONS = [
  { label: 'Resend (cloud default)', value: 'resend' },
  { label: 'SMTP (on-premises/Exchange)', value: 'smtp' },
  { label: 'Office 365 (Microsoft Graph)', value: 'office365' },
  { label: 'SendGrid', value: 'sendgrid' },
  { label: 'AWS SES', value: 'ses' },
];

// UI only (ACC-13) — persists to Organization.emailConfig, but
// NotificationEmailProcessor keeps calling Resend directly until the
// IEmailProvider refactor (a separate follow-up ticket per CLAUDE.md's
// Email Provider section). Config is a single free-form JSON textarea,
// deliberately not typed per-provider, matching that same non-goal.
@Component({
  selector: 'app-email-provider-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, OverlaySelectComponent, TextareaModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.emailProvider' | translate }}</h2>
      <p class="text-sm text-[var(--am-text-secondary)]">{{ 'adminSettings.emailProviderNote' | translate }}</p>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="emailProvider" class="text-sm font-medium">{{ 'adminSettings.provider' | translate }}</label>
          <app-overlay-select formControlName="emailProvider" [options]="providerOptions" optionLabel="label" optionValue="value" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="config" class="text-sm font-medium">{{ 'adminSettings.providerConfig' | translate }}</label>
          <textarea pTextarea id="config" formControlName="config" rows="6" placeholder='{"apiKey": "..."}'></textarea>
        </div>
        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>
    </div>
  `,
})
export class EmailProviderSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly tenantService = inject(TenantService);

  readonly providerOptions = PROVIDER_OPTIONS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    emailProvider: this.fb.control<'resend' | 'smtp' | 'office365' | 'sendgrid' | 'ses'>('resend', { validators: Validators.required }),
    config: ['{}', [Validators.required]],
  });

  ngOnInit(): void {
    this.tenantService.getEmailConfig().subscribe({
      next: (config) => {
        if (config.emailProvider) {
          this.form.patchValue({
            emailProvider: config.emailProvider,
            config: JSON.stringify(config.config ?? {}, null, 2),
          });
        }
      },
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;

    let parsedConfig: Record<string, unknown>;
    try {
      parsedConfig = JSON.parse(this.form.getRawValue().config!);
    } catch {
      this.error.set('adminSettings.errorInvalidJson');
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    this.tenantService
      .updateEmailConfig({ emailProvider: this.form.getRawValue().emailProvider!, config: parsedConfig })
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
