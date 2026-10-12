import { Component, OnInit, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { MessageModule } from 'primeng/message';
import { CardComponent } from '../../../../shared/components/card/card.component';
import { TenantService, ITenant } from '../../../tenant/services/tenant.service';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';

// Read-only credit display — the allocation follows the tenant's plan, or a
// platform admin's manual allocation (ACC-194). Nothing here is writable: the
// overage toggle was removed with ACC-194 (D9), because overage stays off and
// the gateway refuses at zero whatever it said.
@Component({
  selector: 'app-ai-settings',
  standalone: true,
  imports: [PageHeaderComponent, TranslatePipe, MessageModule, CardComponent],
  template: `
    <div class="flex flex-col gap-4 max-w-lg">
      <app-page-header [title]="'adminSettings.aiSettings' | translate" />

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      @if (tenant(); as t) {
        <div class="grid grid-cols-2 gap-4">
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.monthlyCredits' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.ai.monthlyCredits }}</p>
          </app-card>
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.creditsRemaining' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.ai.creditsRemaining }}</p>
          </app-card>
        </div>
        <p class="text-sm text-[var(--am-text-secondary)]">
          {{ 'platform.creditsUsed' | translate }}: {{ t.ai.creditsUsed }}
        </p>
      }
    </div>
  `,
})
export class AiSettingsComponent implements OnInit {
  private readonly tenantService = inject(TenantService);

  readonly tenant = signal<ITenant | null>(null);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.tenantService.getCurrent().subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: () => this.error.set('adminSettings.errorLoad'),
    });
  }
}
