import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { DialogModule } from 'primeng/dialog';
import { ConfirmationService } from 'primeng/api';
import { RoleService, RoleDto } from '../../services/role.service';
import { RoleFormComponent } from '../role-form/role-form.component';

@Component({
  selector: 'app-role-list',
  standalone: true,
  imports: [
    TranslatePipe,
    TableModule,
    ButtonModule,
    TagModule,
    TooltipModule,
    DialogModule,
    RoleFormComponent,
  ],
  template: `
    <div class="flex flex-col h-full gap-4">

      <div class="flex items-center justify-between">
        <h2 class="text-xl font-semibold">{{ 'roles.title' | translate }}</h2>
        <p-button
          icon="pi pi-plus"
          [label]="'roles.addRole' | translate"
          (onClick)="openAdd()"
        />
      </div>

      @if (error()) {
        <p class="text-red-500">{{ error() | translate }}</p>
      }

      <p-table
        [value]="visibleRoles()"
        [loading]="loading()"
        scrollable
        scrollHeight="flex"
        styleClass="w-full"
      >
        <ng-template pTemplate="header">
          <tr>
            <th style="width: 25%">{{ 'roles.nameEn' | translate }}</th>
            <th style="width: 20%">{{ 'roles.nameAr' | translate }}</th>
            <th style="width: 12%">{{ 'roles.roleType' | translate }}</th>
            <th style="width: 12%">{{ 'roles.isActive' | translate }}</th>
            <th style="width: 16%">{{ 'roles.permissionCount' | translate: { count: 0 } }}</th>
            <th style="width: 15%"></th>
          </tr>
        </ng-template>

        <ng-template pTemplate="body" let-role>
          <tr>
            <td>
              <span [pTooltip]="role.key ?? ''" [tooltipDisabled]="!role.key">
                {{ role.nameEn }}
              </span>
            </td>
            <td dir="rtl">{{ role.nameAr }}</td>
            <td>
              <p-tag
                [value]="(role.isSystem ? 'roles.systemBadge' : 'roles.customBadge') | translate"
                [severity]="role.isSystem ? 'info' : 'secondary'"
              />
            </td>
            <td>
              <p-tag
                [value]="(role.isActive ? 'common.active' : 'common.inactive') | translate"
                [severity]="role.isActive ? 'success' : 'secondary'"
              />
            </td>
            <td>{{ (role.permissions?.length ?? 0) }}</td>
            <td>
              <div class="flex gap-1 justify-end">
                <p-button
                  icon="pi pi-lock"
                  [text]="true"
                  size="small"
                  [pTooltip]="'roles.managePermissions' | translate"
                  (onClick)="openPermissions(role)"
                />
                <p-button
                  icon="pi pi-pencil"
                  [text]="true"
                  size="small"
                  [pTooltip]="'roles.editRole' | translate"
                  (onClick)="openEdit(role)"
                />
                @if (role.isActive) {
                  <p-button
                    icon="pi pi-ban"
                    [text]="true"
                    size="small"
                    severity="danger"
                    [pTooltip]="'roles.deactivateRole' | translate"
                    (onClick)="onDeactivate(role)"
                  />
                } @else {
                  <p-button
                    icon="pi pi-check"
                    [text]="true"
                    size="small"
                    severity="success"
                    [pTooltip]="'roles.activateRole' | translate"
                    (onClick)="onActivate(role)"
                  />
                }
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template pTemplate="emptymessage">
          <tr>
            <td colspan="6" class="text-center py-8 text-[var(--am-text-secondary)]">
              {{ 'roles.noRoles' | translate }}
            </td>
          </tr>
        </ng-template>
      </p-table>

      <p-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingRole() ? 'roles.editRole' : 'roles.addRole') | translate"
        [modal]="true"
        [style]="{ width: '520px' }"
      >
        <app-role-form
          [role]="editingRole()"
          (saved)="onSaved($event)"
          (cancelled)="showFormDialog.set(false)"
        />
      </p-dialog>

    </div>
  `,
})
export class RoleListComponent implements OnInit {
  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly roles = signal<RoleDto[]>([]);
  readonly error = signal<string | null>(null);

  // PLATFORM_ADMIN is seeded into every tenant for Step 12's impersonation flow
  // but must never appear in the tenant-facing role picker — see plan Business Rules.
  readonly visibleRoles = computed(() =>
    this.roles().filter((r) => r.key !== 'PLATFORM_ADMIN'),
  );

  readonly showFormDialog = signal(false);
  readonly editingRole = signal<RoleDto | null>(null);
  private wasCreating = false;

  ngOnInit(): void {
    this.loadRoles();
  }

  openAdd(): void {
    this.editingRole.set(null);
    this.wasCreating = true;
    this.showFormDialog.set(true);
  }

  openEdit(role: RoleDto): void {
    this.editingRole.set(role);
    this.wasCreating = false;
    this.showFormDialog.set(true);
  }

  openPermissions(role: RoleDto): void {
    void this.router.navigate([role.id, 'permissions'], { relativeTo: this.route });
  }

  onSaved(role: RoleDto): void {
    this.showFormDialog.set(false);
    const wasCreating = this.wasCreating;
    this.loadRoles();
    // New roles start with zero permissions — send the admin straight into the
    // matrix to assign some, per plan Commit 8 UI notes.
    if (wasCreating) {
      void this.router.navigate([role.id, 'permissions'], { relativeTo: this.route });
    }
  }

  displayLabel(role: RoleDto): string {
    return role.nameAr || role.nameEn;
  }

  onDeactivate(role: RoleDto): void {
    const label = this.displayLabel(role);
    this.confirmationService.confirm({
      message: `Deactivate role "${label}"? This will immediately revoke permissions for all users assigned to this role.`,
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.roleService.deactivateRole(role.id).subscribe({
          next: () => this.loadRoles(),
          error: (err: { error?: { message?: string } }) =>
            this.error.set(err?.error?.message ?? 'Deactivate failed'),
        });
      },
    });
  }

  onActivate(role: RoleDto): void {
    this.roleService.activateRole(role.id).subscribe({
      next: () => this.loadRoles(),
      error: (err: { error?: { message?: string } }) =>
        this.error.set(err?.error?.message ?? 'Activate failed'),
    });
  }

  private loadRoles(): void {
    this.loading.set(true);
    this.error.set(null);
    this.roleService.listRoles().subscribe({
      next: (roles) => {
        this.roles.set(roles);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('roles.errorLoad');
        this.loading.set(false);
      },
    });
  }
}
