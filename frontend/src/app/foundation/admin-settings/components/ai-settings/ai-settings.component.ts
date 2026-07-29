import { Component, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';
import { TenantService, ITenant } from '../../../tenant/services/tenant.service';

// Read-only credit display — a Platform Admin sets the allocation via the
// Super Admin Portal, not the tenant admin. The only write action here is
// overageEnabled, which IS tenant-controllable per CLAUDE.md's
// Organization.settings.ai.overageEnabled field.
@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [FormsModule, TranslatePipe, CheckboxModule, MessageModule],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <h2 class="text-xl font-semibold">{{ 'adminSettings.aiSettings' | translate }}</h2>

      @if (error()) {
        <p-message severity="error" [text]="error()!" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()!" />
      }

      @if (tenant(); as t) {
        <div class="grid grid-cols-2 gap-4">
          <div class="p-4 rounded-md bg-[var(--am-card)] border border-[var(--am-border)]">
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.monthlyCredits' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.ai.monthlyCredits }}</p>
          </div>
          <div class="p-4 rounded-md bg-[var(--am-card)] border border-[var(--am-border)]">
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.creditsRemaining' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.ai.creditsRemaining }}</p>
          </div>
        </div>
        <p class="text-sm text-[var(--am-text-secondary)]">
          {{ 'platform.creditsUsed' | translate }}: {{ t.ai.creditsUsed }}
        </p>

        <div class="flex items-center gap-2">
          <p-checkbox
            [ngModel]="t.ai.overageEnabled"
            [binary]="true"
            inputId="overageEnabled"
            (ngModelChange)="onToggleOverage($event)"
          />
          <label for="overageEnabled" class="text-sm cursor-pointer">{{ 'platform.overageEnabled' | translate }}</label>
        </div>
      }
    </div>
  `,
})
export class AiSettingsComponent implements OnInit {
  private readonly tenantService = inject(TenantService);

  readonly tenant = signal<ITenant | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.tenantService.getCurrent().subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }

  onToggleOverage(overageEnabled: boolean): void {
    this.error.set(null);
    this.savedMessage.set(null);
    this.tenantService.updateAiOverageSetting(overageEnabled).subscribe({
      next: () => {
        this.savedMessage.set('adminSettings.savedSuccess');
        this.load();
      },
      error: () => this.error.set('adminSettings.errorSave'),
    });
  }
}
