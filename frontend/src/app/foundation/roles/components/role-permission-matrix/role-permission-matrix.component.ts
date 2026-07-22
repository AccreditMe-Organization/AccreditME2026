import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { TagModule } from 'primeng/tag';
import { MessageModule } from 'primeng/message';
import { RoleService, RoleDto, PermissionDto } from '../../services/role.service';

interface ModuleGroup {
  module: string;
  permissions: PermissionDto[];
}

// System roles whose permission set gates every user assigned to them —
// editing these deserves an extra warning in the UI. See plan Business Rules.
const HIGH_IMPACT_ROLE_KEYS = new Set(['TENANT_ADMIN', 'PLATFORM_ADMIN']);

@Component({
  selector: 'app-role-permission-matrix',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ButtonModule, CheckboxModule, TagModule, MessageModule],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center gap-3">
        <p-button icon="pi pi-arrow-left" [text]="true" size="small" (onClick)="goBack()" />
        @if (role()) {
          <h2 class="text-xl font-semibold me-auto">
            {{ role()!.nameEn }} — {{ 'roles.permissionMatrix' | translate }}
          </h2>
          @if (role()!.isSystem) {
            <p-tag [value]="'roles.systemBadge' | translate" severity="info" />
          }
        }
      </div>

      <p class="text-sm text-surface-400">{{ 'roles.permissionMatrixHint' | translate }}</p>

      @if (isHighImpact()) {
        <p-message severity="warn" [text]="'roles.adminRoleWarning' | translate" />
      }

      @if (error()) {
        <p class="text-red-500">{{ error() }}</p>
      }

      @if (loading()) {
        <p class="text-sm text-surface-400">{{ 'common.loading' | translate }}</p>
      } @else if (groups().length === 0) {
        <p class="text-sm text-surface-400">{{ 'roles.noPermissions' | translate }}</p>
      } @else {
        <div class="flex flex-col gap-5 overflow-y-auto">
          @for (group of groups(); track group.module) {
            <div class="flex flex-col gap-2 border-b border-surface-200 pb-3">
              <span class="font-semibold text-sm uppercase tracking-wide text-surface-500">
                {{ group.module }}
              </span>
              <div class="flex flex-wrap gap-4">
                @for (perm of group.permissions; track perm.id) {
                  <div class="flex items-center gap-2">
                    <p-checkbox
                      [binary]="true"
                      [inputId]="perm.id"
                      [ngModel]="isChecked(perm)"
                      (ngModelChange)="toggle(perm)"
                    />
                    <label [for]="perm.id" class="text-sm cursor-pointer">{{ perm.action }}</label>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      }

      @if (saveError()) {
        <p class="text-red-500 text-sm">{{ saveError() }}</p>
      }

      <div class="flex gap-3 justify-end">
        <p-button
          [label]="'common.cancel' | translate"
          severity="secondary"
          [text]="true"
          (onClick)="goBack()"
        />
        <p-button
          [label]="'common.save' | translate"
          [loading]="saving()"
          (onClick)="onSave()"
        />
      </div>

    </div>
  `,
})
export class RolePermissionMatrixComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private roleId = '';

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);

  readonly role = signal<RoleDto | null>(null);
  readonly allPermissions = signal<PermissionDto[]>([]);
  readonly selectedKeys = signal<Set<string>>(new Set());

  readonly isHighImpact = computed(() => {
    const key = this.role()?.key;
    return !!key && HIGH_IMPACT_ROLE_KEYS.has(key);
  });

  readonly groups = computed<ModuleGroup[]>(() => {
    const byModule = new Map<string, PermissionDto[]>();
    for (const perm of this.allPermissions()) {
      const list = byModule.get(perm.module) ?? [];
      list.push(perm);
      byModule.set(perm.module, list);
    }
    return Array.from(byModule.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([module, permissions]) => ({ module, permissions }));
  });

  ngOnInit(): void {
    this.roleId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  isChecked(perm: PermissionDto): boolean {
    return this.selectedKeys().has(this.keyOf(perm));
  }

  toggle(perm: PermissionDto): void {
    const key = this.keyOf(perm);
    const next = new Set(this.selectedKeys());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.selectedKeys.set(next);
  }

  onSave(): void {
    this.saving.set(true);
    this.saveError.set(null);
    this.roleService.assignPermissions(this.roleId, Array.from(this.selectedKeys())).subscribe({
      next: () => {
        this.saving.set(false);
        this.goBack();
      },
      error: (err: { error?: { message?: string } }) => {
        this.saveError.set(err?.error?.message ?? 'Save failed');
        this.saving.set(false);
      },
    });
  }

  goBack(): void {
    void this.router.navigate(['..', '..'], { relativeTo: this.route });
  }

  private keyOf(perm: PermissionDto): string {
    return `${perm.module}:${perm.action}`;
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.roleService.getRole(this.roleId).subscribe({
      next: (role) => {
        // PLATFORM_ADMIN is seeded for Step 12's impersonation flow but must
        // never be editable from the tenant-facing UI — see plan Business Rules.
        if (role.key === 'PLATFORM_ADMIN') {
          void this.router.navigate(['../'], { relativeTo: this.route });
          return;
        }
        this.role.set(role);
        this.selectedKeys.set(new Set(role.permissions ?? []));
        this.loadPermissions();
      },
      error: () => {
        this.error.set('roles.errorLoad');
        this.loading.set(false);
      },
    });
  }

  private loadPermissions(): void {
    this.roleService.listAllPermissions().subscribe({
      next: (permissions) => {
        this.allPermissions.set(permissions);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('roles.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
