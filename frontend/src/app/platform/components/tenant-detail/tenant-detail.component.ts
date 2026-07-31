import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputNumberModule } from 'primeng/inputnumber';
import { MessageModule } from 'primeng/message';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { CardComponent } from '../../../shared/components/card/card.component';
import { PlatformTenantService, IPlatformTenantDetail } from '../../services/platform-tenant.service';
import { KNOWN_MODULE_KEYS } from '../../services/plan.service';

@Component({
  selector: 'app-tenant-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    TranslatePipe,
    DatePipe,
    ButtonModule,
    CheckboxModule,
    InputNumberModule,
    MessageModule,
    StatusBadgeComponent,
    CardComponent,
  ],
  template: `
    <div class="flex flex-col gap-6 max-w-3xl">
      @if (error()) {
        <p-message severity="error" [text]="error()! | translate" />
      }
      @if (savedMessage()) {
        <p-message severity="success" [text]="savedMessage()! | translate" />
      }

      @if (tenant(); as t) {
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-xl font-semibold">{{ t.name }}</h2>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ t.slug }} · {{ t.planName ?? '—' }}</p>
          </div>
          <app-status-badge variant="account" [value]="t.status" />
        </div>

        <div class="grid grid-cols-2 gap-4">
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.userCount' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.userCount }}</p>
          </app-card>
          <app-card>
            <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.createdAt' | translate }}</p>
            <p class="text-2xl font-semibold">{{ t.createdAt | date: 'mediumDate' }}</p>
          </app-card>
        </div>

        <hr />

        <h3 class="text-lg font-medium">{{ 'platform.modules' | translate }}</h3>
        <form [formGroup]="modulesForm" (ngSubmit)="onSubmitModules()" class="flex flex-col gap-3">
          <div class="grid grid-cols-3 gap-2">
            @for (key of moduleKeys; track key) {
              <div class="flex items-center gap-2">
                <p-checkbox [formControlName]="key" [binary]="true" [inputId]="key" />
                <label [for]="key" class="text-sm cursor-pointer">{{ key }}</label>
              </div>
            }
          </div>
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingModules()" />
          </div>
        </form>

        <hr />

        <h3 class="text-lg font-medium">{{ 'platform.aiCredits' | translate }}</h3>
        <form [formGroup]="aiForm" (ngSubmit)="onSubmitAiCredits()" class="flex flex-col gap-3 max-w-xs">
          <div class="flex flex-col gap-1">
            <label for="monthlyCredits" class="text-sm font-medium">{{ 'platform.monthlyCredits' | translate }}</label>
            <p-inputNumber inputId="monthlyCredits" formControlName="monthlyCredits" [min]="0" />
          </div>
          <div class="flex items-center gap-2">
            <p-checkbox formControlName="overageEnabled" [binary]="true" inputId="overageEnabled" />
            <label for="overageEnabled" class="text-sm cursor-pointer">{{ 'platform.overageEnabled' | translate }}</label>
          </div>
          <p class="text-sm text-[var(--am-text-secondary)]">
            {{ 'platform.creditsUsed' | translate }}: {{ t.ai.creditsUsed }} ·
            {{ 'platform.creditsRemaining' | translate }}: {{ t.ai.creditsRemaining }}
          </p>
          <div class="flex justify-end">
            <p-button [label]="'common.save' | translate" type="submit" [loading]="savingAi()" />
          </div>
        </form>

        <hr />

        <h3 class="text-lg font-medium">{{ 'platform.impersonate' | translate }}</h3>
        @if (t.tenantAdmins.length === 0) {
          <p class="text-sm text-[var(--am-text-secondary)]">{{ 'platform.noTenantAdmins' | translate }}</p>
        }
        <div class="flex flex-col gap-2">
          @for (admin of t.tenantAdmins; track admin.id) {
            <div class="flex items-center justify-between p-2 rounded-md border border-[var(--am-border)]">
              <span class="text-sm">{{ admin.name }} · {{ admin.email }}</span>
              <p-button
                [label]="'platform.impersonate' | translate"
                size="small"
                [text]="true"
                (onClick)="onImpersonate(t.id, admin.id)"
              />
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class TenantDetailComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly tenantId = this.route.snapshot.paramMap.get('id')!;
  readonly moduleKeys = KNOWN_MODULE_KEYS;

  readonly tenant = signal<IPlatformTenantDetail | null>(null);
  readonly error = signal<string | null>(null);
  readonly savedMessage = signal<string | null>(null);
  readonly savingModules = signal(false);
  readonly savingAi = signal(false);

  readonly modulesForm = this.fb.group(
    Object.fromEntries(this.moduleKeys.map((key) => [key, [false]])),
  );

  readonly aiForm = this.fb.group({
    monthlyCredits: [0, [Validators.required, Validators.min(0)]],
    overageEnabled: [false],
  });

  ngOnInit(): void {
    this.load();
  }

  private load(): void {
    this.platformTenantService.getTenantDetail(this.tenantId).subscribe({
      next: (tenant) => {
        this.tenant.set(tenant);
        this.modulesForm.patchValue(tenant.modules);
        this.aiForm.patchValue({
          monthlyCredits: tenant.ai.monthlyCredits,
          overageEnabled: tenant.ai.overageEnabled,
        });
      },
      error: () => this.error.set('platform.errorLoad'),
    });
  }

  onSubmitModules(): void {
    this.savingModules.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    this.platformTenantService
      .updateTenantModules(this.tenantId, this.modulesForm.getRawValue() as Record<string, boolean>)
      .subscribe({
        next: () => {
          this.savingModules.set(false);
          this.savedMessage.set('platform.savedSuccess');
          this.load();
        },
        error: () => {
          this.savingModules.set(false);
          this.error.set('platform.errorAction');
        },
      });
  }

  onSubmitAiCredits(): void {
    if (this.aiForm.invalid) return;
    this.savingAi.set(true);
    this.error.set(null);
    this.savedMessage.set(null);

    const value = this.aiForm.getRawValue();
    this.platformTenantService.allocateAiCredits(this.tenantId, value.monthlyCredits!, value.overageEnabled!).subscribe({
      next: () => {
        this.savingAi.set(false);
        this.savedMessage.set('platform.savedSuccess');
        this.load();
      },
      error: () => {
        this.savingAi.set(false);
        this.error.set('platform.errorAction');
      },
    });
  }

  onImpersonate(tenantId: string, userId: string): void {
    this.platformTenantService.startImpersonation(tenantId, userId).subscribe({
      // Full reload, not router.navigate() — the access_token cookie changed
      // server-side; AuthService/NavigationAccessService's signals need a
      // fresh APP_INITIALIZER boot to pick up the impersonated identity,
      // not a stale in-memory carryover from the platform admin's own session.
      next: () => { window.location.href = '/organization'; },
      error: () => this.error.set('platform.errorImpersonate'),
    });
  }
}
