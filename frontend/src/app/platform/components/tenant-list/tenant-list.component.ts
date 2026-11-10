import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { RouterLink } from '@angular/router';
import { of, switchMap, tap } from 'rxjs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { StatusBadgeComponent } from '../../../shared/components/status-badge/status-badge.component';
import { PlatformTenantService, IPlatformTenantSummary } from '../../services/platform-tenant.service';
import { PageHeaderComponent } from '../../../shared/components/page-header/page-header.component';
import { NavigationAccessService } from '../../../core/services/navigation-access.service';
import { AmConfirmService } from '../../../shared/components/confirm/am-confirm.service';
import { DataListColumn, DataListComponent } from '../../../shared/components/data-list/data-list.component';
import { DataListSource, clientSideSource } from '../../../shared/components/data-list/data-list.source';
import { SortHeaderComponent } from '../../../shared/components/sort-header/sort-header.component';
import { RowMenuComponent, RowMenuItem } from '../../../shared/components/row-menu/row-menu.component';
import { SHELL_PHONE_BELOW_PX } from '../../../layout/app-shell/app-shell.component';

/** A tenant's lifecycle, in the order the Status column sorts by. */
const STATUS_ORDER: Readonly<Record<IPlatformTenantSummary['status'], number>> = {
  TRIAL: 0,
  ACTIVE: 1,
  SUSPENDED: 2,
  CANCELLED: 3,
  OFFBOARDING: 4,
};

/**
 * Platform → Tenants — ACC-120, on the shared list (`app-data-list`).
 *
 * ## Read whole, sliced in memory
 *
 * `GET /platform/tenants` returns every tenant as one array: no page, no total,
 * no sort parameter. So the list reads it once and searches, sorts and pages it
 * in memory (`clientSideSource()`), as Org positions does. That is honest at
 * today's count. **Once tenants reach the low hundreds it should page on the
 * server**: the fix is the endpoint and one line here, because the list only
 * ever sees a `DataListSource`.
 *
 * Opens sorted by name, A to Z. Suspend and Reactivate are the row's ⋯ menu;
 * Suspend keeps its confirm.
 */
@Component({
  selector: 'app-tenant-list',
  standalone: true,
  imports: [
    PageHeaderComponent,
    RouterLink,
    TranslatePipe,
    ButtonModule,
    MessageModule,
    StatusBadgeComponent,
    DataListComponent,
    SortHeaderComponent,
    RowMenuComponent,
  ],
  template: `
    <div class="flex h-full flex-col gap-4">
      <app-page-header [title]="'platform.tenants' | translate">
        <div pageActions>
          @if (canCreate()) {
            <p-button
              icon="pi pi-plus"
              [label]="'platform.createTenant' | translate"
              routerLink="/platform/tenants/create"
            />
          }
        </div>
      </app-page-header>

      <!-- A row action's failure. The list's own load error and Retry belong to
           app-data-list. -->
      @if (actionError()) {
        <p-message severity="error" [text]="actionError()! | translate" data-testid="tenant-action-error" />
      }

      <app-data-list
        #list
        variant="page"
        [source]="source"
        [trackBy]="trackById"
        [columns]="columns()"
        [initialSort]="{ sortBy: 'name', sortDir: 'asc' }"
        [searchPlaceholder]="'platform.searchTenants' | translate"
        [emptyTitle]="'platform.noTenants' | translate"
        [errorMessage]="'platform.errorLoad' | translate"
        [gridSuffix]="canManage() ? 'var(--am-space-40)' : ''"
        persistKey="platformTenants"
      >
        <ng-template #listHeader let-h>
          @for (column of columns(); track column.key) {
            @if (h.visible(column.key)) {
              @if (column.sortBy) {
                <am-sort-header
                  [key]="column.key"
                  [label]="column.label"
                  [current]="h.sortBy === column.sortBy ? { key: column.key, dir: h.sortDir ?? 'asc' } : null"
                  (sort)="h.sort($event)"
                />
              } @else {
                <span role="columnheader">{{ column.label }}</span>
              }
            }
          }
          @if (canManage()) {
            <span></span>
          }
        </ng-template>

        <ng-template #listRow let-tenant let-v="visible">
          <div
            class="grid items-center gap-3 border-b border-[var(--am-border)] px-3 py-2"
            style="grid-template-columns: var(--am-list-cols)"
            [attr.data-tenant-row]="tenant.id"
          >
            @if (v('name')) {
              <div class="min-w-0">
                <a
                  class="block truncate text-[length:var(--am-type-value-size)] font-medium text-[var(--am-primary-700)] no-underline hover:underline"
                  [routerLink]="['/platform/tenants', tenant.id]"
                  [attr.title]="tenant.name"
                  data-testid="tenant-name"
                  >{{ tenant.name }}</a
                >
                @if (phone()) {
                  <span
                    class="block truncate text-[length:var(--am-type-meta-size)] text-[var(--am-ink-500)]"
                    [attr.title]="phoneMeta(tenant)"
                    data-testid="tenant-phone-meta"
                    >{{ phoneMeta(tenant) }}</span
                  >
                }
              </div>
            }
            @if (!phone() && v('slug')) {
              <span class="min-w-0 truncate text-[length:var(--am-type-value-size)]" dir="ltr" [attr.title]="tenant.slug" data-testid="tenant-slug">{{
                tenant.slug
              }}</span>
            }
            @if (v('status')) {
              <span class="min-w-0"><app-status-badge variant="account" [value]="tenant.status" /></span>
            }
            @if (!phone() && v('plan')) {
              <span class="min-w-0 truncate text-[length:var(--am-type-value-size)]" [attr.title]="tenant.planName ?? null" data-testid="tenant-plan">{{
                tenant.planName ?? '—'
              }}</span>
            }
            @if (canManage()) {
              <span class="flex justify-end">
                <am-row-menu
                  [groups]="[menuFor(tenant)]"
                  [label]="'list.actionsFor' | translate: { name: tenant.name }"
                  (picked)="pick(tenant, $event)"
                />
              </span>
            }
          </div>
        </ng-template>
      </app-data-list>
    </div>
  `,
})
export class TenantListComponent {
  private readonly platformTenantService = inject(PlatformTenantService);
  private readonly amConfirm = inject(AmConfirmService);
  private readonly translate = inject(TranslateService);
  private readonly navigationAccess = inject(NavigationAccessService);
  private readonly document = inject(DOCUMENT);

  readonly list = viewChild.required<DataListComponent<IPlatformTenantSummary>>('list');

  // ACC-118 — found by check:create-gating, not by the ticket's own list of
  // ten. Hidden, not disabled, same as every other page-header create action.
  // POST /platform/tenants carries no @Permissions(); it is @UseGuards(TenantGuard,
  // PlatformGuard), which isPlatformAdmin() mirrors (platform-tenant.controller.ts).
  readonly canCreate = computed(() => this.navigationAccess.isPlatformAdmin());
  // Suspend and Reactivate are behind the same PlatformGuard.
  readonly canManage = this.canCreate;

  /** null means NOT LOADED — distinct from loaded-and-empty. */
  readonly tenants = signal<readonly IPlatformTenantSummary[] | null>(null);
  readonly actionError = signal<string | null>(null);

  /** ACC-232's phone width: the name cell carries the slug and the plan. */
  readonly phone = signal(false);

  constructor() {
    const media = this.document.defaultView?.matchMedia?.(`(max-width: ${SHELL_PHONE_BELOW_PX - 0.02}px)`);
    if (media) {
      this.phone.set(media.matches);
      const onChange = (e: MediaQueryListEvent): void => this.phone.set(e.matches);
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
  }

  readonly columns = computed<DataListColumn[]>(() => {
    this.translate.currentLang();
    const t = (key: string): string => this.translate.instant(key);
    const name: DataListColumn = { key: 'name', label: t('platform.tenantName'), sortBy: 'name', alwaysVisible: true, width: 'minmax(0, 2fr)' };
    const status: DataListColumn = { key: 'status', label: t('platform.status'), sortBy: 'status', width: 'calc(var(--am-space-40) * 3)' };
    if (this.phone()) {
      return [{ ...name, width: 'minmax(0, 1fr)' }, { ...status, alwaysVisible: true, width: 'calc(var(--am-space-40) * 2.5)' }];
    }
    return [
      name,
      { key: 'slug', label: t('platform.slug'), sortBy: 'slug', width: 'minmax(0, 1.2fr)' },
      status,
      { key: 'plan', label: t('platform.plan'), sortBy: 'plan', width: 'minmax(0, 1fr)' },
    ];
  });

  readonly trackById = (tenant: IPlatformTenantSummary): string => tenant.id;

  private readonly slice: DataListSource<IPlatformTenantSummary> = clientSideSource(() => this.tenants() ?? [], {
    searchFields: (t) => [t.name, t.slug, t.planName],
    comparators: {
      name: (a, b) => a.name.localeCompare(b.name),
      slug: (a, b) => a.slug.localeCompare(b.slug),
      status: (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
      plan: (a, b) => (a.planName ?? '').localeCompare(b.planName ?? ''),
    },
    // A tenant with no plan sorts last, both ways (ACC-160's rule).
    nullsLast: { plan: (t) => t.planName },
  });

  /**
   * Fetch once, then slice the cache (Org positions' shape). A search, sort or
   * page answers from memory; a write invalidates the cache and reloads.
   */
  readonly source: DataListSource<IPlatformTenantSummary> = (query) => {
    const cached = this.tenants();
    const items$ = cached ? of(cached) : this.platformTenantService.listTenants().pipe(tap((rows) => this.tenants.set(rows)));
    return items$.pipe(switchMap(() => this.slice(query)));
  };

  /** The phone row's second line: slug · plan. */
  phoneMeta(tenant: IPlatformTenantSummary): string {
    return [tenant.slug, tenant.planName].filter(Boolean).join(' · ');
  }

  menuFor(tenant: IPlatformTenantSummary): RowMenuItem[] {
    return tenant.status !== 'SUSPENDED'
      ? [{ id: 'suspend', label: this.translate.instant('platform.suspend'), danger: true }]
      : [{ id: 'reactivate', label: this.translate.instant('platform.reactivate') }];
  }

  pick(tenant: IPlatformTenantSummary, id: string): void {
    if (id === 'suspend') this.onSuspend(tenant);
    else if (id === 'reactivate') this.onReactivate(tenant);
  }

  onSuspend(tenant: IPlatformTenantSummary): void {
    this.amConfirm.ask({
      tone: 'destructive',
      // platform-tenant.service.ts suspendTenant() sets SUSPENDED; the guard,
      // sign-in, refresh and invitations all refuse a closed organisation.
      message: this.translate.instant('platform.suspendConfirm'),
      header: this.translate.instant('platform.suspendHeader', { name: tenant.name }),
      acceptLabel: this.translate.instant('platform.suspend'),
      accept: () => {
        this.actionError.set(null);
        this.platformTenantService.suspendTenant(tenant.id).subscribe({
          next: () => this.reload(),
          error: () => this.actionError.set('platform.errorAction'),
        });
      },
    });
  }

  onReactivate(tenant: IPlatformTenantSummary): void {
    this.actionError.set(null);
    this.platformTenantService.reactivateTenant(tenant.id).subscribe({
      next: () => this.reload(),
      error: () => this.actionError.set('platform.errorAction'),
    });
  }

  /** Invalidate, then let the LIST refetch through `source`. */
  private reload(): void {
    this.tenants.set(null);
    this.list().reload();
  }
}
