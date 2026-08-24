import { Component, Input, OnChanges, inject, signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { RoleService, RoleDto } from '../../services/role.service';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';
// ACC-42 Phase 5 — OverlaySelectComponent replaces p-select on this field:
// routed-page-under-<main> context, and the first real consumer binding via
// [(ngModel)] rather than formControlName (plan §5.5). See CLAUDE.md's
// PrimeNG-components-only exception note and overlay-select.component.ts
// for the full mechanism.
import { OverlaySelectComponent } from '../../../../shared/components/overlay-select/overlay-select.component';

@Component({
  selector: 'app-user-role-assignment',
  standalone: true,
  imports: [FormsModule, TranslatePipe, ButtonModule, OverlaySelectComponent, TooltipModule],
  template: `
    <div class="flex flex-col gap-4">
      <h3 class="font-semibold text-sm">{{ 'roles.assignedUsers' | translate }}</h3>

      @if (error()) {
        <p class="text-red-500 text-sm">{{ error() | translate }}</p>
      }

      <ul class="flex flex-col gap-2">
        @for (role of assignedRoles(); track role.id) {
          <li class="flex items-center justify-between gap-3">
            <span>{{ role.nameEn }}</span>
            <p-button
              icon="pi pi-times"
              [text]="true"
              size="small"
              severity="danger"
              [pTooltip]="'roles.removeRole' | translate"
              (onClick)="onRemove(role)"
            />
          </li>
        }
        @if (assignedRoles().length === 0 && !loading()) {
          <li class="text-sm text-[var(--am-text-secondary)]">{{ 'roles.noRoles' | translate }}</li>
        }
      </ul>

      <div class="flex items-center gap-3">
        <app-overlay-select
          [options]="assignableRoles()"
          optionLabel="nameEn"
          optionValue="id"
          [(ngModel)]="selectedRoleId"
          [placeholder]="'roles.assignRole' | translate"
          class="grow"
        />
        <p-button
          [label]="'roles.assignRole' | translate"
          [disabled]="!selectedRoleId"
          (onClick)="onAssign()"
        />
      </div>
    </div>
  `,
})
export class UserRoleAssignmentComponent implements OnChanges {
  @Input({ required: true }) userId!: string;

  private readonly roleService = inject(RoleService);
  private readonly confirmationService = inject(ConfirmationService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly assignedRoles = signal<RoleDto[]>([]);
  readonly allRoles = signal<RoleDto[]>([]);
  selectedRoleId: string | null = null;

  get assignableRoles(): () => RoleDto[] {
    return () => {
      const assignedIds = new Set(this.assignedRoles().map((r) => r.id));
      return this.allRoles().filter(
        (r) => r.isActive && r.key !== 'PLATFORM_ADMIN' && !assignedIds.has(r.id),
      );
    };
  }

  ngOnChanges(): void {
    if (this.userId) this.load();
  }

  onAssign(): void {
    if (!this.selectedRoleId) return;
    this.roleService.assignRoleToUser(this.userId, this.selectedRoleId).subscribe({
      next: () => {
        this.selectedRoleId = null;
        this.load();
      },
      error: (err: unknown) => this.error.set(extractErrorMessage(err, 'Assign failed')),
    });
  }

  onRemove(role: RoleDto): void {
    this.confirmationService.confirm({
      message: 'Remove this role assignment?',
      header: 'Confirm',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { severity: 'danger' },
      accept: () => {
        this.roleService.removeRoleFromUser(this.userId, role.id).subscribe({
          next: () => this.load(),
          error: (err: unknown) => this.error.set(extractErrorMessage(err, 'Remove failed')),
        });
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.roleService.getUserRoles(this.userId).subscribe({
      next: (roles) => {
        this.assignedRoles.set(roles);
        this.loading.set(false);
        this.loadAllRoles();
      },
      error: () => {
        this.error.set('roles.errorLoad');
        this.loading.set(false);
      },
    });
  }

  private loadAllRoles(): void {
    this.roleService.listRoles().subscribe({
      next: (roles) => this.allRoles.set(roles),
      error: () => this.error.set('roles.errorLoad'),
    });
  }
}
