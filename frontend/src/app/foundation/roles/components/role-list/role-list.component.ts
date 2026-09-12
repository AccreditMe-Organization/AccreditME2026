import {
  Component,
  TemplateRef,
  ViewChild,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService } from 'primeng/api';
import { RoleService, RoleDto } from '../../services/role.service';
import { RoleFormComponent } from '../role-form/role-form.component';
import { EditDialogComponent } from '../../../../shared/components/edit-dialog/edit-dialog.component';
import {
  DataListComponent,
  DataListSortOption,
} from '../../../../shared/components/data-list/data-list.component';
import { DataListSource } from '../../../../shared/components/data-list/data-list.source';
import { StatusChipComponent } from '../../../../shared/components/status-chip/status-chip.component';
import { extractErrorMessage } from '../../../../shared/utils/http-error.util';

@Component({
  selector: 'app-role-list',
  standalone: true,
  imports: [
    TranslatePipe,
    ButtonModule,
    TooltipModule,
    DataListComponent,
    StatusChipComponent,
    RoleFormComponent,
    EditDialogComponent,
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

      <!-- ACC-78 — the shared list pattern. -->
      <div class="rounded-lg border border-[var(--am-border)] bg-[var(--am-card)] overflow-hidden">
        <app-data-list
          #list
          [source]="source"
          [trackBy]="trackById"
          [sortOptions]="sortOptions()"
          [searchPlaceholder]="'roles.searchPlaceholder' | translate"
          [emptyTitle]="'roles.noRoles' | translate"
          persistKey="roles"
          [urlSync]="true"
        >
          <ng-template #listRow let-role>
            <div
              class="grid items-center gap-3 px-3 py-2 border-b border-[var(--am-border)]"
              style="grid-template-columns: 1fr auto"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-2 min-w-0">
                  <!-- BILINGUAL NAMES AS A TWO-LINE CELL, settling the two
                       conventions the UX review found. Both names always,
                       rather than one chosen by language: a role's Arabic name
                       is what an Arabic-speaking admin knows it by, and an
                       English session should still show it. -->
                  <span
                    class="text-[13px] font-medium truncate"
                    [pTooltip]="role.key ?? ''"
                    [tooltipDisabled]="!role.key"
                  >
                    {{ role.nameEn }}
                  </span>
                  @if (role.isSystem) {
                    <span
                      class="text-[10.5px] font-semibold px-1.5 py-px rounded shrink-0"
                      style="color: var(--am-blue-primary);
                             background: color-mix(in srgb, var(--am-blue-primary) 12%, transparent)"
                    >
                      {{ 'roles.systemBadge' | translate }}
                    </span>
                  }
                  @if (!role.isActive) {
                    <app-status-chip variant="account" value="CANCELLED" />
                  }
                </div>
                <div
                  dir="rtl"
                  style="unicode-bidi: isolate"
                  class="text-[11.5px] text-[var(--am-text-secondary)] truncate text-start"
                >
                  {{ role.nameAr }}
                </div>
              </div>

              <div class="flex items-center gap-2 shrink-0">
                <!-- ACC-74 — permissionCount, not permissions?.length. The list
                     deliberately does not carry the permission array; binding
                     to it rendered 0 for every role, always. -->
                <span
                  dir="ltr"
                  style="unicode-bidi: isolate; font-variant-numeric: tabular-nums"
                  class="hidden @min-[520px]/datalist:block text-xs text-[var(--am-text-secondary)] w-[110px]"
                >
                  {{ 'roles.permissionCount' | translate: { count: role.permissionCount ?? 0 } }}
                </span>
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
            </div>
          </ng-template>
        </app-data-list>
      </div>

      <ng-template #formTpl>
        <app-role-form
          [role]="editingRole()"
          (saved)="onSaved($event)"
          (cancelled)="showFormDialog.set(false)"
        />
      </ng-template>
      <app-edit-dialog
        [visible]="showFormDialog()"
        (visibleChange)="showFormDialog.set($event)"
        [header]="(editingRole() ? 'roles.editRole' : 'roles.addRole') | translate"
        [content]="formTpl"
        width="520px"
      />

    </div>
  `,
})
export class RoleListComponent {
  @ViewChild('formTpl', { read: TemplateRef, static: true }) formTpl!: TemplateRef<unknown>;

  private readonly roleService = inject(RoleService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmationService = inject(ConfirmationService);
  private readonly translate = inject(TranslateService);

  readonly error = signal<string | null>(null);
  readonly list = viewChild.required<DataListComponent<RoleDto>>('list');

  // ACC-78 — the client-side PLATFORM_ADMIN filter is GONE, not moved. The
  // backend now excludes it in the WHERE clause, because a post-query filter
  // and a database-side count cannot agree once the endpoint paginates: the
  // page would come back one row short and the total would include a role this
  // tenant can never see. Filtering again here would be harmless but would
  // hide that the real fix is server-side.

  // Arrow property, not a method: DataListComponent reads this as a signal
  // input, so a bound method would be a new reference each change detection
  // and refetch in a loop.
  readonly source: DataListSource<RoleDto> = (query) =>
    this.roleService.listRoles({
      search: query.search,
      page: query.page,
      pageSize: query.pageSize,
      sortBy: query.sortBy,
      sortDir: query.sortDir,
    });

  readonly trackById = (role: RoleDto): string => role.id;

  // BOTH bilingual names are offered, matching the backend whitelist. An
  // Arabic reader sorting "by name" should sort by the name they are reading,
  // not its English counterpart.
  readonly sortOptions = computed<DataListSortOption[]>(() => {
    this.translate.currentLang();
    return [
      { column: 'nameEn', label: this.translate.instant('roles.nameEn') },
      { column: 'nameAr', label: this.translate.instant('roles.nameAr') },
      { column: 'key', label: this.translate.instant('roles.roleType') },
    ];
  });

  readonly showFormDialog = signal(false);
  readonly editingRole = signal<RoleDto | null>(null);
  private wasCreating = false;

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
    this.list().reload();
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
          next: () => this.list().reload(),
          error: (err: unknown) =>
            this.error.set(extractErrorMessage(err, 'Deactivate failed')),
        });
      },
    });
  }

  onActivate(role: RoleDto): void {
    this.roleService.activateRole(role.id).subscribe({
      next: () => this.list().reload(),
      error: (err: unknown) =>
        this.error.set(extractErrorMessage(err, 'Activate failed')),
    });
  }

}
