import { Component, OnInit, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ConfirmationService } from 'primeng/api';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { PlatformTenantService, IPlatformTenantSummary } from '../../services/platform-tenant.service';

@Component({
  selector: 'app-tenant-list',
  standalone: true,
  imports: [RouterLink, TranslatePipe, TableModule, ButtonModule, MessageModule, StatusBadgeComponent],
  template: `
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'platform.tenants' | translate }}</h2>
        <p-button
          icon="pi pi-plus"
          [label]="'platform.createTenant' | translate"
          routerLink="/platform/tenants/create"
        />
      </div>

      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }

      <p-table [value]="tenants()" [loading]="loading()" styleClass="w-full" scrollable scrollHeight="flex">
        <ng-template pTemplate="header">
          <tr>
            <th>{{ 'platform.tenantName' | translate }}</th>
            <th>{{ 'platform.slug' | translate }}</th>
            <th>{{ 'platform.status' | translate }}</th>
            <th>{{ 'platform.plan' | translate }}</th>
            <th></th>
          </tr>
        </ng-template>
        <ng-template pTemplate="body" let-tenant>
          <tr>
            <td>
              <a [routerLink]="['/platform/tenants', tenant.id]" class="text-[var(--am-blue-primary)] hover:underline">
                {{ tenant.name }}
              </a>
            </td>
            <td>{{ tenant.slug }}</td>
            <td><app-status-badge variant="account" [value]="tenant.status" /></td>
            <td>{{ tenant.planName ?? '—' }}</td>
            <td>
              <div class="flex gap-1 justify-end">
                @if (tenant.status !== 'SUSPENDED') {
                  <p-button
                    [label]="'platform.suspend' | translate"
                    severity="danger"
                    [text]="true"
                    size="small"
                    (onClick)="onSuspend(tenant)"
                  />
                } @else {
                  <p-button
                    [label]="'platform.reactivate' | translate"
                    severity="success"
                    [text]="true"
                    size="small"
                    (onClick)="onReactivate(tenant)"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>
        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="5" class="text-center py-4 text-[var(--am-text-secondary)]">
              {{ 'platform.noTenants' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class TenantListComponent implements OnInit {
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translateService = inject(TranslateService);
  private readonly router = inject(Router);

  readonly tenants = signal<IPlatformTenantSummary[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.platformTenantService.listTenants().subscribe({
      next: (tenants) => {
        this.tenants.set(tenants);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('platform.errorLoad');
        this.loading.set(false);
      },
    });
  }

  onSuspend(tenant: IPlatformTenantSummary): void {
    this.confirmationService.confirm({
      message: this.translateService.instant('platform.suspendConfirm', { name: tenant.name }),
      header: this.translateService.instant('common.confirm'),
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.platformTenantService.suspendTenant(tenant.id).subscribe({
          next: () => this.load(),
          error: () => this.error.set('platform.errorAction'),
        });
      },
    });
  }

  onReactivate(tenant: IPlatformTenantSummary): void {
    this.platformTenantService.reactivateTenant(tenant.id).subscribe({
      next: () => this.load(),
      error: () => this.error.set('platform.errorAction'),
    });
  }
}
