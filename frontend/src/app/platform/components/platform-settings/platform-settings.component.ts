import { Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { PlatformSettingsService } from '../../services/platform-settings.service';

const SEVERITY_OPTIONS = [
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
];

@Component({
  selector: 'app-platform-settings',
  standalone: true,
  imports: [ReactiveFormsModule, TranslatePipe, InputTextModule, SelectModule, ButtonModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <h2 class="text-xl font-semibold">{{ 'platform.platformSettings' | translate }}</h2>
      <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.announcement' | translate }}</p>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      <form [formGroup]="form" (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1">
          <label for="message" class="text-sm font-medium">{{ 'platform.announcementMessage' | translate }}</label>
          <input pInputText id="message" formControlName="message" />
        </div>
        <div class="flex flex-col gap-1">
          <label for="severity" class="text-sm font-medium">{{ 'platform.announcementSeverity' | translate }}</label>
          <p-select inputId="severity" formControlName="severity" [options]="severityOptions" optionLabel="label" optionValue="value" />
        </div>
        <div class="flex justify-end">
          <p-button [label]="'common.save' | translate" type="submit" [loading]="saving()" [disabled]="form.invalid" />
        </div>
      </form>
    </div>
  `,
})
export class PlatformSettingsComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly platformSettingsService = inject(PlatformSettingsService);

  readonly severityOptions = SEVERITY_OPTIONS;
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  readonly form = this.fb.group({
    message: ['', [Validators.required]],
    severity: ['info' as 'info' | 'warning', [Validators.required]],
  });

  ngOnInit(): void {
    this.platformSettingsService.getSettings().subscribe({
      next: (settings) => {
        if (settings.announcement) {
          this.form.patchValue({
            message: settings.announcement.message,
            severity: settings.announcement.severity,
          });
        }
      },
      error: () => this.error.set('platform.errorLoad'),
    });
  }

  onSubmit(): void {
    if (this.form.invalid) return;
    this.saving.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.form.getRawValue();
    this.platformSettingsService.updateSettings({ message: value.message!, severity: value.severity! }).subscribe({
      next: () => {
        this.saving.set(false);
        this.savedMessage.set('platform.savedSuccess');
      },
      error: () => {
        this.saving.set(false);
        this.error.set('platform.errorAction');
      },
    });
  }
}
